import { config } from "../config.js";
import { markRead as kirimMarkRead, sendText as kirimSendText } from "./kirim.js";

/**
 * Kanal pengiriman. Percakapan Baileys ditandai phone_number_id = "baileys";
 * selain itu phone_number_id adalah Phone Number ID Kirimdev.
 */
export const BAILEYS_PHONE_ID = "baileys";
export const isBaileys = (phoneNumberId: string | null | undefined) => phoneNumberId === BAILEYS_PHONE_ID;

export type SendResult = { id: string | null; message_id: string | null; status: string | null };

export async function baileysRequest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.baileys.url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Internal-Secret": config.baileys.secret },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Baileys: ${json?.error ?? `HTTP ${res.status}`}`);
  return json as T;
}

/** Kanal default untuk chat baru yang dimulai admin. */
export function defaultPhoneId() {
  if (config.kirim.enabled && config.kirim.phoneId) return config.kirim.phoneId;
  if (config.baileys.enabled) return BAILEYS_PHONE_ID;
  return config.kirim.phoneId;
}

/** Jeda acak ala manusia: min..max, makin panjang pesan makin lama (±40 ms per karakter). */
export function humanDelay(text: string, minMs: number, maxMs: number) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || 0);
  const byLength = min + text.length * 40;
  const jitter = Math.random() * Math.min(2000, max - min);
  return Math.round(Math.min(max, byLength + jitter));
}

export async function channelSendText(phoneNumberId: string, to: string, text: string, opts: { delayMs?: number } = {}): Promise<SendResult[]> {
  if (isBaileys(phoneNumberId)) {
    if (!config.baileys.enabled) throw new Error("Kanal Baileys dinonaktifkan (BAILEYS_ENABLED=false)");
    const r = await baileysRequest<{ id: string | null; status: string }>("POST", "/send", { to, text, delayMs: opts.delayMs ?? 0 });
    return [{ id: null, message_id: r.id, status: r.status }];
  }
  if (!config.kirim.enabled) throw new Error("Kanal Kirimdev dinonaktifkan (KIRIM_ENABLED=false)");
  return kirimSendText(to, text, { phoneNumberId: phoneNumberId || undefined });
}

export async function channelMarkRead(phoneNumberId: string, to: string, messageId: string, typing: boolean) {
  if (isBaileys(phoneNumberId)) {
    if (!config.baileys.enabled) return;
    return baileysRequest("POST", "/read", { to, id: messageId, typing });
  }
  if (!config.kirim.enabled) return;
  return kirimMarkRead(messageId, typing, phoneNumberId);
}
