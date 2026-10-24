/**
 * Kanal WhatsApp tidak resmi (WhatsApp Web / multi-device) memakai Baileys.
 * Menjaga satu koneksi socket, meneruskan pesan masuk ke backend (api) dan menyediakan
 * HTTP internal untuk kirim pesan, tanda baca, dan status/QR. TIDAK diekspos ke publik.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";

const ENABLED = process.env.BAILEYS_ENABLED === "true";
const PORT = Number(process.env.PORT ?? 3100);
const API_URL = process.env.API_URL ?? "http://api:3000";
const SECRET = process.env.BAILEYS_INTERNAL_SECRET ?? "";
const AUTH_DIR = process.env.AUTH_DIR ?? "/app/auth";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? "warn" });

type Status = "disabled" | "connecting" | "qr" | "open" | "closed" | "logged_out";
const state: { status: Status; qr: string | null; me: { id: string; name?: string | null } | null; lastError: string | null; since: string } = {
  status: ENABLED ? "connecting" : "disabled",
  qr: null,
  me: null,
  lastError: null,
  since: new Date().toISOString(),
};

let sock: WASocket | null = null;
let reconnectAttempts = 0;
// id pesan yang dikirim oleh service ini (balasan bot/admin panel), agar tidak dikira balasan manual dari HP
const sentIds = new Map<string, number>();
// key pesan masuk terakhir (untuk read receipt) dan jid balasan per kontak
const inboundKeys = new Map<string, WAMessageKey>();
const replyJid = new Map<string, string>();

function remember<K, V>(map: Map<K, V>, k: K, v: V, max = 5000) {
  map.set(k, v);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

function setStatus(s: Status, err?: string | null) {
  state.status = s;
  state.since = new Date().toISOString();
  if (err !== undefined) state.lastError = err;
}

/** Nomor (digit) untuk kontak biasa; untuk alamat LID tanpa nomor, jid lengkap "...@lid". */
function contactId(key: WAMessageKey): { waId: string; jid: string } | null {
  const candidates = [key.remoteJid, key.remoteJidAlt].filter(Boolean) as string[];
  const pn = candidates.find((j) => isPnUser(j));
  if (pn) {
    const jid = jidNormalizedUser(pn);
    return { waId: jid.split("@")[0], jid: key.remoteJid ?? jid };
  }
  const lid = candidates.find((j) => isLidUser(j));
  if (lid) {
    const jid = jidNormalizedUser(lid);
    return { waId: jid, jid };
  }
  return null;
}

function toJid(to: string) {
  if (replyJid.has(to)) return replyJid.get(to)!;
  return to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
}

/** Ubah pesan Baileys ke bentuk mirip Meta Cloud API agar backend bisa memakai alur yang sama. */
function toMetaMessage(m: WAMessage, waId: string) {
  const c = m.message ?? {};
  const msg = (c.ephemeralMessage?.message ?? c.viewOnceMessage?.message ?? c.viewOnceMessageV2?.message ?? c) as typeof c;
  const id = m.key.id!;
  const base = { from: waId, id, timestamp: String(m.messageTimestamp ?? Math.floor(Date.now() / 1000)) };
  if (msg.conversation) return { ...base, type: "text", text: { body: msg.conversation } };
  if (msg.extendedTextMessage?.text) return { ...base, type: "text", text: { body: msg.extendedTextMessage.text } };
  if (msg.imageMessage) return { ...base, type: "image", image: { caption: msg.imageMessage.caption ?? undefined } };
  if (msg.videoMessage) return { ...base, type: "video", video: { caption: msg.videoMessage.caption ?? undefined } };
  if (msg.documentMessage)
    return { ...base, type: "document", document: { caption: msg.documentMessage.caption ?? undefined, filename: msg.documentMessage.fileName ?? undefined } };
  if (msg.buttonsResponseMessage) return { ...base, type: "button", button: { text: msg.buttonsResponseMessage.selectedDisplayText ?? "" } };
  if (msg.listResponseMessage) return { ...base, type: "interactive", interactive: { list_reply: { title: msg.listResponseMessage.title ?? "" } } };
  if (msg.locationMessage)
    return { ...base, type: "location", location: { latitude: msg.locationMessage.degreesLatitude ?? 0, longitude: msg.locationMessage.degreesLongitude ?? 0, name: msg.locationMessage.name ?? undefined } };
  if (msg.audioMessage) return { ...base, type: "audio" };
  if (msg.stickerMessage) return { ...base, type: "sticker" };
  if (msg.contactMessage || msg.contactsArrayMessage) return { ...base, type: "contacts" };
  return null; // reaction, protocol message, dll. -> abaikan
}

async function postEvent(body: unknown) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${API_URL}/internal/baileys/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return;
      logger.warn({ status: res.status }, "api menolak event");
    } catch (e: any) {
      logger.warn({ err: e.message }, "gagal kirim event ke api");
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
}

const STATUS_MAP: Record<number, string> = { 1: "pending", 2: "sent", 3: "delivered", 4: "read", 5: "read" };

async function start() {
  if (!ENABLED) return;
  setStatus("connecting");
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {
    version = undefined;
  }

  const s = makeWASocket({
    version,
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    logger,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  sock = s;

  s.ev.on("creds.update", saveCreds);

  s.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
      setStatus("qr", null);
      console.log("[baileys] QR baru tersedia — scan dari admin panel (menu WhatsApp)");
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      state.qr = null;
      state.me = s.user ? { id: jidNormalizedUser(s.user.id), name: s.user.name ?? null } : null;
      setStatus("open", null);
      console.log(`[baileys] terhubung sebagai ${state.me?.id}`);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
      const msg = lastDisconnect?.error?.message ?? `closed (${code})`;
      if (sock !== s) return; // socket lama yang sudah diganti
      sock = null;
      if (code === DisconnectReason.loggedOut) {
        console.log("[baileys] logout dari HP — sesi dihapus, menunggu scan QR baru");
        setStatus("logged_out", msg);
        state.me = null;
        await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
        setTimeout(start, 2000);
        return;
      }
      setStatus("closed", msg);
      const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 2000 * 2 ** reconnectAttempts++);
      console.log(`[baileys] koneksi tertutup (${msg}), reconnect dalam ${delay}ms`);
      setTimeout(start, delay);
    }
  });

  s.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      try {
        const jid = m.key.remoteJid ?? "";
        if (!m.message || isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) continue;
        const who = contactId(m.key);
        if (!who) continue;
        const meta = toMetaMessage(m, who.waId);
        if (!meta) continue;
        remember(replyJid, who.waId, who.jid);

        if (m.key.fromMe) {
          // event kiriman sendiri bisa muncul sebelum sendMessage() selesai mencatat id-nya
          await sleep(2000);
          if (sentIds.has(m.key.id!)) continue; // kiriman bot sendiri
          // dikirim manual dari HP pemilik nomor -> admin mengambil alih chat ini
          await postEvent({ type: "agent_message", message: { ...meta, to: who.waId } });
          continue;
        }
        // "append" = pesan yang tertunda saat offline; hanya proses yang masih baru (< 5 menit)
        const ageSec = Date.now() / 1000 - Number(m.messageTimestamp ?? 0);
        if (type !== "notify" && ageSec > 300) continue;
        remember(inboundKeys, m.key.id!, m.key);
        await postEvent({ type: "message", name: m.pushName ?? null, message: meta });
      } catch (e: any) {
        logger.error({ err: e.message }, "gagal memproses pesan masuk");
      }
    }
  });

  s.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      const st = u.update?.status;
      if (!u.key.fromMe || st === undefined || st === null) continue;
      const status = STATUS_MAP[Number(st)];
      if (status) await postEvent({ type: "status", status: { id: u.key.id, status } });
    }
  });
}

// ---------------- HTTP internal ----------------
function authorized(req: IncomingMessage) {
  const got = Buffer.from(String(req.headers["x-internal-secret"] ?? ""));
  const exp = Buffer.from(SECRET);
  return SECRET.length > 0 && got.length === exp.length && timingSafeEqual(got, exp);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireSocket(): WASocket {
  if (!ENABLED) throw Object.assign(new Error("Baileys dinonaktifkan (BAILEYS_ENABLED=false)"), { code: 503 });
  if (!sock || state.status !== "open") throw Object.assign(new Error(`WhatsApp belum terhubung (status: ${state.status})`), { code: 503 });
  return sock;
}

createServer(async (req, res) => {
  try {
    if (req.url === "/health") return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && req.url === "/status") return send(res, 200, { enabled: ENABLED, ...state });

    if (req.method === "POST" && req.url === "/send") {
      const { to, text, delayMs } = await readJson(req);
      if (!to || !text) return send(res, 400, { error: "to dan text wajib" });
      const s = requireSocket();
      const jid = toJid(String(to));
      // tampilkan "sedang mengetik..." selama jeda (dihitung backend dari pengaturan admin)
      const delay = Math.max(0, Math.min(30000, Number(delayMs) || 0));
      if (delay > 0) {
        await s.sendPresenceUpdate("composing", jid).catch(() => {});
        await sleep(delay);
      }
      const sent = await s.sendMessage(jid, { text: String(text) });
      await s.sendPresenceUpdate("paused", jid).catch(() => {});
      const id = sent?.key?.id ?? null;
      if (id) remember(sentIds, id, Date.now());
      return send(res, 200, { id, status: "sent" });
    }

    if (req.method === "POST" && req.url === "/read") {
      const { to, id, typing } = await readJson(req);
      const s = requireSocket();
      const key = inboundKeys.get(String(id)) ?? { remoteJid: toJid(String(to)), id: String(id), fromMe: false };
      await s.readMessages([key]);
      if (typing) await s.sendPresenceUpdate("composing", key.remoteJid ?? toJid(String(to))).catch(() => {});
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/logout") {
      if (sock) await sock.logout().catch(() => {});
      sock = null;
      state.me = null;
      await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
      setStatus("logged_out", "logout dari admin panel");
      setTimeout(start, 1000);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/restart") {
      const old = sock;
      sock = null;
      old?.end(undefined);
      setTimeout(start, 500);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found" });
  } catch (e: any) {
    send(res, typeof e?.code === "number" ? e.code : 500, { error: e?.message ?? String(e) });
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`[baileys] HTTP internal di :${PORT}, enabled=${ENABLED}`);
  if (!SECRET) console.warn("[baileys] BAILEYS_INTERNAL_SECRET kosong — semua request internal akan ditolak");
  start().catch((e) => {
    console.error("[baileys] gagal start:", e);
    setStatus("closed", String(e?.message ?? e));
  });
});

// bersihkan id kiriman lama (>1 jam)
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, at] of sentIds) if (at < cutoff) sentIds.delete(id);
}, 600_000).unref();
