import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export class KirimError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

async function request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!config.kirim.apiKey) throw new KirimError("KIRIM_API_KEY belum diisi di .env", 0, null);
  const res = await fetch(`${config.kirim.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.kirim.apiKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`;
    throw new KirimError(`Kirimdev: ${msg}`, res.status, json);
  }
  return json as T;
}

const phone = (id?: string) => encodeURIComponent(id || config.kirim.phoneId);

// WhatsApp membatasi 4096 karakter per pesan teks
function splitText(text: string, max = 4000): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendText(to: string, body: string, opts: { phoneNumberId?: string; replyTo?: string } = {}) {
  const results: { id: string | null; message_id: string | null; status: string | null }[] = [];
  for (const [i, chunk] of splitText(body).entries()) {
    const payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: chunk, preview_url: false },
    };
    if (opts.replyTo && i === 0) payload.context = { message_id: opts.replyTo };
    const r = await request("POST", `/${phone(opts.phoneNumberId)}/messages`, payload);
    results.push({ id: r?.data?.id ?? null, message_id: r?.data?.message_id ?? null, status: r?.data?.status ?? null });
  }
  return results;
}

export async function markRead(wamid: string, typing: boolean, phoneNumberId?: string) {
  const payload: any = { messaging_product: "whatsapp", status: "read", message_id: wamid };
  if (typing) payload.typing_indicator = { type: "text" };
  return request("POST", `/${phone(phoneNumberId)}/messages`, payload);
}

export const kirimApi = {
  me: () => request("GET", "/me"),
  accounts: () => request("GET", "/accounts"),
  listWebhooks: () => request("GET", "/webhook_subscriptions"),
  conversation: (id: string, phoneNumberId?: string) => request("GET", `/${phone(phoneNumberId)}/conversations/${encodeURIComponent(id)}`),
  createWebhook: (url: string) =>
    request(
      "POST",
      "/webhook_subscriptions",
      {
        url,
        description: "Bot Solusi AI",
        events: ["message.received", "message.status"],
        phone_number_ids: config.kirim.phoneId ? [config.kirim.phoneId] : null,
      },
      { "Idempotency-Key": `bot-solusi-${url}` },
    ),
};

/** Verifikasi header X-Kirim-Signature: "t=<unix>,v1=<hex>[,v1=<hex>]" ; HMAC-SHA256 dari "{t}.{raw_body}" */
export function verifySignature(header: string | undefined, rawBody: Buffer, secrets: string[], toleranceSec: number): boolean {
  if (!header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") t = Number(v);
    else if (k === "v1" && v) sigs.push(v);
  }
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const signed = Buffer.concat([Buffer.from(`${t}.`), rawBody]);
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac("sha256", secret).update(signed).digest("hex"));
    for (const s of sigs) {
      const got = Buffer.from(s);
      if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
    }
  }
  return false;
}
