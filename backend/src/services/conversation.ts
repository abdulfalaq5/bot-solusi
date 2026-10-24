import { sql } from "../db.js";
import { ChatMessage, generateReply } from "../ai/router.js";
import { markRead, sendText } from "./kirim.js";
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
export async function handleInbound(payload: any) {
  const s = await getSettings();
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const phoneNumberId: string = value?.metadata?.phone_number_id ?? payload?.kirim?.phone_number_id ?? "";
      const names = new Map<string, string>();
      for (const c of value?.contacts ?? []) if (c?.wa_id) names.set(c.wa_id, c?.profile?.name ?? null);

      for (const m of (value?.messages ?? []) as InboundMessage[]) {
        await handleOneMessage(m, phoneNumberId, names.get(m.from) ?? null, payload?.kirim?.media_url ?? null, s);
      }
      for (const st of value?.statuses ?? []) await handleStatus(st);
    }
  }
}

async function handleOneMessage(m: InboundMessage, phoneNumberId: string, name: string | null, mediaUrl: string | null, s: Settings) {
  const [contact] = await sql`
    INSERT INTO contacts (wa_id, name) VALUES (${m.from}, ${name})
    ON CONFLICT (wa_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
    RETURNING *`;
  const [conv] = await sql`
    INSERT INTO conversations (contact_id, phone_number_id, mode)
    VALUES (${contact.id}, ${phoneNumberId}, ${s.default_mode})
    ON CONFLICT (contact_id, phone_number_id) DO UPDATE SET contact_id = EXCLUDED.contact_id
    RETURNING *`;

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

async function handleStatus(st: any) {
  if (!st?.id) return;
  const error = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title ?? st.errors[0].message ?? ""}` : null;
  await sql`UPDATE messages SET status = ${st.status}, error = COALESCE(${error}, error)
            WHERE direction = 'out' AND (wamid = ${st.id} OR kirim_msg_id = ${st.id})`;
}

async function setHuman(conversationId: number, s: Settings) {
  const minutes = Number(s.human_auto_resume_minutes) || 0;
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await sql`UPDATE conversations SET mode = 'human', human_until = ${until}, needs_attention = true WHERE id = ${conversationId}`;
}

export async function sendAndStore(
  conversationId: number,
  to: string,
  phoneNumberId: string,
  text: string,
  sender: "ai" | "admin" | "system",
  modelUsed: string | null = null,
) {
  let results: Awaited<ReturnType<typeof sendText>>;
  try {
    results = await sendText(to, text, { phoneNumberId: phoneNumberId || undefined });
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
    await markRead(lastIn.wamid, s.typing_indicator, conv.phone_number_id).catch((e) => console.warn("[kirim] markRead:", e.message));
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

  // model CS bisa meminta handoff ke manusia
  if (/\[HANDOFF\]/i.test(text)) {
    text = text.replace(/\[HANDOFF\]/gi, "").trim();
    await setHuman(conversationId, s);
  }
  if (!text) return { skipped: "empty" };

  // jika sementara itu pelanggan mengirim pesan baru, biarkan job berikutnya yang membalas
  const latestNow = await redis.get(`latest:${conversationId}`);
  if (latestNow && latestNow !== String(messageId)) return { skipped: "newer message arrived" };

  await sendAndStore(conversationId, conv.wa_id, conv.phone_number_id, text, "ai", modelUsed);
  return { sent: true, model: modelUsed };
}
