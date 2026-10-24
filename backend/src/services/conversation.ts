import { sql } from "../db.js";
import { config } from "../config.js";
import { ChatMessage, generateReply } from "../ai/router.js";
import { kirimApi } from "./kirim.js";
import { BAILEYS_PHONE_ID, channelMarkRead, channelSendText, humanDelay, SendResult } from "./channel.js";
import { getSettings, Settings } from "./settings.js";
import { queue, redis } from "../queue.js";

type InboundMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  button?: { text: string };
  location?: { latitude: number; longitude: number; name?: string };
};

function extractBody(m: InboundMessage): string | null {
  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "button":
      return m.button?.text ?? null;
    case "image":
      return m.image?.caption ?? null;
    case "video":
      return m.video?.caption ?? null;
    case "document":
      return m.document?.caption ?? m.document?.filename ?? null;
    case "location":
      return m.location ? `[lokasi] ${m.location.name ?? ""} ${m.location.latitude},${m.location.longitude}`.trim() : null;
    default:
      return null;
  }
}

export function isHumanMode(conv: any) {
  if (conv.mode !== "human") return false;
  return !conv.human_until || new Date(conv.human_until).getTime() > Date.now();
}

/** Proses payload webhook message.received (format Meta Cloud API passthrough). */
export async function handleInbound(payload: any, event: "message.received" | "message.status") {
  const s = await getSettings();
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId: string = value?.metadata?.phone_number_id ?? payload?.kirim?.phone_number_id ?? "";
      const names = new Map<string, string>();
      for (const c of value?.contacts ?? []) if (c?.wa_id) names.set(c.wa_id, c?.profile?.name ?? null);

      const inbound = event === "message.received" ? ((value?.messages ?? []) as InboundMessage[]) : [];
      for (const m of inbound) {
        await handleOneMessage(m, phoneNumberId, names.get(m.from) ?? null, payload?.kirim ?? {}, s);
      }
      for (const st of value?.statuses ?? []) await handleStatus(st);
    }
  }
}

async function handleOneMessage(m: InboundMessage, phoneNumberId: string, name: string | null, kirim: any, s: Settings) {
  const mediaUrl: string | null = kirim?.media_url ?? null;
  const [contact] = await sql`
    INSERT INTO contacts (wa_id, name) VALUES (${m.from}, ${name})
    ON CONFLICT (wa_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
    RETURNING *`;
  // percakapan yang dibuat dari event tanpa phone_number_id (mis. message.sent) dipakai ulang
  await sql`UPDATE conversations SET phone_number_id = ${phoneNumberId}
            WHERE contact_id = ${contact.id} AND phone_number_id = '' AND ${phoneNumberId} <> ''
              AND NOT EXISTS (SELECT 1 FROM conversations x WHERE x.contact_id = ${contact.id} AND x.phone_number_id = ${phoneNumberId})`;
  const [conv] = await sql`
    INSERT INTO conversations (contact_id, phone_number_id, mode)
    VALUES (${contact.id}, ${phoneNumberId}, ${s.default_mode})
    ON CONFLICT (contact_id, phone_number_id) DO UPDATE SET contact_id = EXCLUDED.contact_id
    RETURNING *`;
  if (kirim?.conversation_id && conv.kirim_conversation_id !== kirim.conversation_id) {
    await sql`UPDATE conversations SET kirim_conversation_id = ${kirim.conversation_id} WHERE id = ${conv.id}`;
  }

  const body = extractBody(m);
  const [msg] = await sql`
    INSERT INTO messages (conversation_id, direction, sender, type, body, media_url, wamid, status)
    VALUES (${conv.id}, 'in', 'customer', ${m.type}, ${body}, ${mediaUrl}, ${m.id}, 'received')
    ON CONFLICT (wamid) WHERE direction = 'in' AND wamid IS NOT NULL DO NOTHING
    RETURNING *`;
  if (!msg) return; // duplikat (webhook retry) -> abaikan

  const preview = body ?? `[${m.type}]`;
  await sql`UPDATE conversations SET unread = unread + 1, last_message_at = now(), last_inbound_at = now(),
            last_preview = ${preview.slice(0, 200)} WHERE id = ${conv.id}`;

  // kembalikan ke mode AI jika masa human-takeover sudah habis
  if (conv.mode === "human" && !isHumanMode(conv)) {
    await sql`UPDATE conversations SET mode = 'ai', human_until = NULL WHERE id = ${conv.id}`;
    conv.mode = "ai";
  }

  if (!s.bot_enabled || isHumanMode(conv)) return;

  // handoff ke admin berdasarkan keyword
  const lower = (body ?? "").toLowerCase().trim();
  const keywords = (s.handoff_keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const words = lower.split(/\s+/);
  // keyword persis, atau terkandung dalam pesan pendek (<= 4 kata) seperti "mau bicara admin"
  if (lower && keywords.some((k) => lower === k || (words.length <= 4 && words.includes(k)))) {
    await setHuman(conv.id, s);
    await sendAndStore(conv.id, contact.wa_id, phoneNumberId, s.handoff_reply, "system");
    return;
  }

  if (!body) {
    if (s.reply_to_non_text) await sendAndStore(conv.id, contact.wa_id, phoneNumberId, s.reply_to_non_text, "system");
    return;
  }

  // debounce: pelanggan sering kirim beberapa pesan beruntun; balas sekali setelah jeda
  await redis.set(`latest:${conv.id}`, String(msg.id), "EX", 3600);
  await queue.add("reply", { conversationId: conv.id, messageId: Number(msg.id) }, { delay: Math.max(0, s.reply_debounce_ms), jobId: `reply-${msg.id}` });
}

export async function handleStatus(st: any) {
  if (!st?.id) return;
  const error = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title ?? st.errors[0].message ?? ""}` : null;
  // event bisa datang tidak berurutan: jangan turunkan status (read -> delivered)
  await sql`UPDATE messages SET status = ${st.status}, error = COALESCE(${error}, error)
            WHERE direction = 'out' AND (wamid = ${st.id} OR kirim_msg_id = ${st.id})
              AND (${st.status} = 'failed' OR array_position(ARRAY['pending','queued','sent','delivered','read'], status)
                   IS NULL OR array_position(ARRAY['pending','queued','sent','delivered','read'], status)
                   < array_position(ARRAY['pending','queued','sent','delivered','read'], ${st.status}::text))`;
}

async function setHuman(conversationId: number, s: Settings, needsAttention = true) {
  const minutes = Number(s.human_auto_resume_minutes) || 0;
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await sql`UPDATE conversations SET mode = 'human', human_until = ${until},
            needs_attention = ${needsAttention} WHERE id = ${conversationId}`;
}

/** Admin mengambil alih chat (dari admin panel): AI berhenti membalas di chat ini. */
export async function takeover(conversationId: number) {
  const s = await getSettings();
  await setHuman(conversationId, s, false);
  // batalkan balasan AI yang sedang menunggu debounce
  await redis.set(`latest:${conversationId}`, "takeover", "EX", 3600);
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
// nomor -> digit saja; alamat LID WhatsApp (tanpa nomor) disimpan utuh "xxx@lid"
const normWaId = (v: unknown) => (String(v ?? "").endsWith("@lid") ? String(v) : digits(v));

/**
 * message.sent: pesan keluar yang diterima Meta. Jika bukan kiriman bot/admin panel ini
 * (mis. agen membalas dari inbox Kirimdev), catat sebagai pesan admin dan hentikan AI di chat itu.
 */
export async function handleMessageSent(payload: any) {
  const s = await getSettings();

  // bentuk native Kirimdev ({data:{message}} / {data}) atau passthrough Meta (entry/changes)
  const metaMsg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const m = payload?.data?.message ?? payload?.message ?? (payload?.data?.object === "message" ? payload.data : null) ?? metaMsg;
  if (!m) {
    console.warn("[message.sent] format tidak dikenali, keys:", Object.keys(payload ?? {}).join(","));
    return { skipped: "unknown format" };
  }
  // format asli Kirimdev: {type:"message.sent", data:{meta, contact, from_me, message:{id:"msg_..", provider_id:"wamid..",
  //   to, body, type, source:"api"|..., status}, conversation:{id}}}
  const kirimId: string | null = m.id?.startsWith?.("msg_") ? m.id : (payload?.kirim?.message_id ?? null);
  const wamid: string | null = m.provider_id ?? m.message_id ?? m.wamid ?? (m.id?.startsWith?.("wamid.") ? m.id : null);
  const waId = normWaId(m.to ?? m.recipient_id ?? payload?.data?.contact?.phone_number ?? payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id);
  if (!waId) return { skipped: "no recipient" };

  // kiriman bot / admin panel sendiri -> abaikan, tapi simpan wamid-nya supaya event message.status bisa dicocokkan
  const [own] = await sql`SELECT id FROM messages WHERE direction = 'out'
    AND ((${kirimId}::text IS NOT NULL AND kirim_msg_id = ${kirimId}) OR (${wamid}::text IS NOT NULL AND wamid = ${wamid})) LIMIT 1`;
  if (own) {
    if (wamid) await sql`UPDATE messages SET wamid = COALESCE(wamid, ${wamid}) WHERE id = ${own.id}`;
    return { skipped: "own message" };
  }
  if (!s.sync_kirim_agent) return { skipped: "sync off" };

  const body: string | null = m.body ?? m.content ?? m.text?.body ?? m.caption ?? m.image?.caption ?? null;
  const phoneNumberId =
    payload?.data?.meta?.phone_number_id ?? payload?.kirim?.phone_number_id ?? payload?.data?.phone_number_id ??
    m.phone_number_id ?? payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? config.kirim.phoneId;
  const [contact] = await sql`INSERT INTO contacts (wa_id, name) VALUES (${waId}, ${payload?.data?.contact?.name ?? null})
    ON CONFLICT (wa_id) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name) RETURNING *`;
  const [conv] = await sql`INSERT INTO conversations (contact_id, phone_number_id, mode)
    VALUES (${contact.id}, ${phoneNumberId}, 'human')
    ON CONFLICT (contact_id, phone_number_id) DO UPDATE SET contact_id = EXCLUDED.contact_id RETURNING *`;
  const kirimConv = payload?.data?.conversation?.id ?? m.conversation_id ?? null;
  if (kirimConv) await sql`UPDATE conversations SET kirim_conversation_id = ${kirimConv} WHERE id = ${conv.id}`;

  await sql`INSERT INTO messages (conversation_id, direction, sender, type, body, media_url, wamid, kirim_msg_id, status, source)
    VALUES (${conv.id}, 'out', 'admin', ${m.type ?? "text"}, ${body}, ${m.media_url ?? null}, ${wamid}, ${kirimId}, ${m.status ?? "sent"}, ${phoneNumberId === BAILEYS_PHONE_ID ? "phone" : "kirimdev"})`;
  await sql`UPDATE conversations SET last_message_at = now(), last_preview = ${(body ?? `[${m.type ?? "pesan"}]`).slice(0, 200)},
            unread = 0 WHERE id = ${conv.id}`;
  await takeover(conv.id);
  return { takeover: conv.id };
}

async function findConvByKirimId(kirimConvId: string, phoneNumberId?: string) {
  const [conv] = await sql`SELECT * FROM conversations WHERE kirim_conversation_id = ${kirimConvId} LIMIT 1`;
  if (conv) return conv;
  // belum pernah terpetakan: ambil kontaknya dari API Kirimdev
  try {
    const r: any = await kirimApi.conversation(kirimConvId, phoneNumberId);
    const waId = digits(r?.data?.contact?.phone_number);
    if (!waId) return null;
    const [c] = await sql`SELECT c.* FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
      WHERE ct.wa_id = ${waId} ORDER BY c.last_message_at DESC LIMIT 1`;
    if (c) await sql`UPDATE conversations SET kirim_conversation_id = ${kirimConvId} WHERE id = ${c.id}`;
    return c ?? null;
  } catch (e: any) {
    console.warn("[kirim] lookup conversation gagal:", e.message);
    return null;
  }
}

/** conversation.assigned -> AI berhenti ; conversation.closed -> AI aktif lagi */
export async function handleConversationEvent(event: string, payload: any) {
  const s = await getSettings();
  if (!s.sync_kirim_agent) return { skipped: "sync off" };
  const kc = payload?.data?.conversation;
  if (!kc?.id) return { skipped: "no conversation" };
  const conv = await findConvByKirimId(kc.id, kc.phone_number_id);
  if (!conv) return { skipped: "conversation not found" };
  if (event === "conversation.assigned") {
    if (payload?.data?.assignee?.user_id) await takeover(conv.id);
    return { takeover: conv.id };
  }
  await sql`UPDATE conversations SET mode = 'ai', human_until = NULL, needs_attention = false WHERE id = ${conv.id}`;
  return { resumed: conv.id };
}

export async function sendAndStore(
  conversationId: number,
  to: string,
  phoneNumberId: string,
  text: string,
  sender: "ai" | "admin" | "system",
  modelUsed: string | null = null,
) {
  let results: SendResult[];
  try {
    // balasan otomatis (AI/sistem) diberi jeda mengetik; pesan admin dikirim langsung
    const s = sender === "admin" ? null : await getSettings();
    results = await channelSendText(phoneNumberId, to, text, {
      delayMs: s ? humanDelay(text, s.human_delay_min_ms, s.human_delay_max_ms) : 0,
    });
  } catch (e: any) {
    const [row] = await sql`
      INSERT INTO messages (conversation_id, direction, sender, type, body, status, error, model_used)
      VALUES (${conversationId}, 'out', ${sender}, 'text', ${text}, 'failed', ${String(e?.message ?? e).slice(0, 500)}, ${modelUsed})
      RETURNING *`;
    throw Object.assign(e, { stored: row });
  }
  const first = results[0];
  const [row] = await sql`
    INSERT INTO messages (conversation_id, direction, sender, type, body, wamid, kirim_msg_id, status, model_used)
    VALUES (${conversationId}, 'out', ${sender}, 'text', ${text}, ${first?.message_id ?? null}, ${first?.id ?? null},
            ${first?.status ?? "pending"}, ${modelUsed})
    RETURNING *`;
  await sql`UPDATE conversations SET last_message_at = now(), last_preview = ${text.slice(0, 200)} WHERE id = ${conversationId}`;
  return row;
}

function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export async function buildSystemPrompt(promptId: number | null, customerName: string | null) {
  const s = await getSettings();
  const [p] = promptId
    ? await sql`SELECT * FROM prompts WHERE id = ${promptId}`
    : await sql`SELECT * FROM prompts WHERE is_default LIMIT 1`;
  const base = p?.content ?? "Kamu adalah asisten AI yang ramah. Jawab singkat dalam Bahasa Indonesia.";
  const vars = {
    bot_name: s.bot_name,
    business_name: s.business_name,
    business_info: s.business_info,
    customer_name: customerName || "Kak",
    date: new Date().toLocaleDateString("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }),
  };
  let out = fillTemplate(base, vars);
  // pastikan info bisnis selalu tersedia walau prompt tidak memakai {business_info}
  if (!base.includes("{business_info}") && s.business_info) out += `\n\nInformasi Bisnis:\n${s.business_info}`;
  return out;
}

/** Job "reply": generate jawaban AI dan kirim ke WhatsApp. */
export async function processReply(conversationId: number, messageId: number) {
  const latest = await redis.get(`latest:${conversationId}`);
  if (latest && latest !== String(messageId)) return { skipped: "newer message pending" };

  const s = await getSettings();
  const [conv] = await sql`
    SELECT c.*, ct.wa_id, ct.name AS contact_name FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ${conversationId}`;
  if (!conv || !s.bot_enabled || isHumanMode(conv)) return { skipped: "bot off / human mode" };

  // jangan balas dua kali jika sudah ada balasan setelah pesan ini
  const [already] = await sql`SELECT 1 FROM messages WHERE conversation_id = ${conversationId} AND direction = 'out' AND id > ${messageId} LIMIT 1`;
  if (already) return { skipped: "already replied" };

  const [lastIn] = await sql`SELECT wamid FROM messages WHERE id = ${messageId}`;
  if (s.mark_as_read && lastIn?.wamid) {
    await channelMarkRead(conv.phone_number_id, conv.wa_id, lastIn.wamid, s.typing_indicator).catch((e) => console.warn("[wa] markRead:", e.message));
  }

  const limit = Math.max(2, Math.min(50, Number(s.history_limit) || 12));
  const history = (
    await sql`SELECT direction, body FROM messages WHERE conversation_id = ${conversationId} AND body IS NOT NULL
              AND (status IS NULL OR status <> 'failed') ORDER BY id DESC LIMIT ${limit}`
  ).reverse();

  // gabungkan pesan berurutan dengan role yang sama (beberapa provider mewajibkan role bergantian)
  const msgs: ChatMessage[] = [];
  for (const h of history) {
    const role = h.direction === "in" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += `\n${h.body}`;
    else msgs.push({ role, content: h.body });
  }
  while (msgs.length && msgs[0].role === "assistant") msgs.shift();

  const system = await buildSystemPrompt(conv.prompt_id, conv.contact_name);

  let text: string;
  let modelUsed: string | null = null;
  try {
    const r = await generateReply([{ role: "system", content: system }, ...msgs], { conversationId });
    text = r.text;
    modelUsed = `${r.provider}/${r.model}`;
  } catch (e: any) {
    console.error(`[reply] conv ${conversationId}:`, e.message);
    await sql`UPDATE conversations SET needs_attention = true WHERE id = ${conversationId}`;
    if (s.fallback_message) await sendAndStore(conversationId, conv.wa_id, conv.phone_number_id, s.fallback_message, "system");
    return { failed: true };
  }

  // jika sementara itu pelanggan mengirim pesan baru / admin mengambil alih, jangan kirim
  // (dicek SEBELUM memproses [HANDOFF], karena handoff sendiri juga memindahkan chat ke mode manual)
  const latestNow = await redis.get(`latest:${conversationId}`);
  if (latestNow && latestNow !== String(messageId)) return { skipped: "newer message / takeover" };
  const [fresh] = await sql`SELECT mode, human_until FROM conversations WHERE id = ${conversationId}`;
  if (isHumanMode(fresh)) return { skipped: "admin took over" };

  // model CS bisa meminta handoff ke manusia: kirim jawabannya dulu, lalu pindahkan ke mode manual
  const handoff = /\[HANDOFF\]/i.test(text);
  text = text.replace(/\[HANDOFF\]/gi, "").trim();
  if (!text) text = s.handoff_reply;

  await sendAndStore(conversationId, conv.wa_id, conv.phone_number_id, text, "ai", modelUsed);
  if (handoff) await setHuman(conversationId, s);
  return { sent: true, model: modelUsed };
}

/**
 * Event dari service wa-baileys (nomor pribadi). Dipetakan ke alur yang sama dengan Kirimdev:
 * message -> message.received, agent_message (dikirim manual dari HP) -> message.sent, status -> message.status.
 */
export async function handleBaileysEvent(ev: any) {
  if (ev?.type === "message" && ev.message) {
    const payload = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: BAILEYS_PHONE_ID },
        contacts: [{ wa_id: ev.message.from, profile: { name: ev.name ?? null } }],
        messages: [ev.message],
      } }] }],
    };
    await handleInbound(payload, "message.received");
    return { ok: true };
  }
  if (ev?.type === "agent_message" && ev.message) {
    const m = ev.message;
    return handleMessageSent({
      data: {
        meta: { phone_number_id: BAILEYS_PHONE_ID },
        message: {
          provider_id: m.id, to: m.to, type: m.type,
          body: m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? null,
          status: "sent",
        },
      },
    });
  }
  if (ev?.type === "status" && ev.status?.id) {
    await handleStatus(ev.status);
    return { ok: true };
  }
  return { ignored: ev?.type ?? "unknown" };
}
