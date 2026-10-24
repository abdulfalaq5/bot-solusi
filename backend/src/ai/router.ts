import { sql } from "../db.js";
import { getSettings } from "../services/settings.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Candidate = {
  model_pk: number;
  model_id: string;
  label: string | null;
  tier: "free" | "paid";
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  provider_code: string;
  provider_name: string;
  base_url: string;
  api_key: string | null;
  api_key_env: string | null;
  requires_key: boolean;
  extra_headers: Record<string, string>;
};

export type AiResult = {
  text: string;
  model: string;
  provider: string;
  tier: string;
  attempts: { provider: string; model: string; ok: boolean; error?: string; ms: number }[];
};

// Model yang kena rate-limit / error diistirahatkan sebentar (circuit breaker sederhana per proses)
const cooldown = new Map<string, number>();

export function resolveKey(c: any): string | null {
  if (c.api_key) return c.api_key;
  if (c.api_key_env) return process.env[c.api_key_env] || null;
  return null;
}

export async function getCandidates(opts: { includePaid: boolean; onlyModelPk?: number }): Promise<Candidate[]> {
  const rows = await sql<Candidate[]>`
    SELECT m.id AS model_pk, m.model_id, m.label, m.tier, m.temperature, m.max_tokens, m.timeout_ms,
           p.code AS provider_code, p.name AS provider_name, p.base_url, p.api_key, p.api_key_env,
           p.requires_key, p.extra_headers
    FROM ai_models m JOIN providers p ON p.id = m.provider_id
    WHERE ${opts.onlyModelPk ? sql`m.id = ${opts.onlyModelPk}` : sql`m.enabled AND p.enabled`}
    ORDER BY (m.tier = 'paid') ASC, m.priority ASC, m.id ASC`;
  return rows.filter((c) => (opts.includePaid || c.tier === "free") && (!c.requires_key || resolveKey(c)));
}

function cleanOutput(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    // Markdown -> format WhatsApp: **tebal** -> *tebal*, heading "## x" -> *x*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .trim();
}

export async function callModel(c: Candidate, messages: ChatMessage[]) {
  const key = resolveKey(c);
  const res = await fetch(`${c.base_url.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(c.extra_headers ?? {}),
    },
    body: JSON.stringify({
      model: c.model_id,
      messages,
      temperature: c.temperature,
      max_tokens: c.max_tokens,
    }),
    signal: AbortSignal.timeout(c.timeout_ms || 30000),
  });
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`), { status: res.status });
  }
  if (!res.ok || json.error) {
    let msg = json?.error?.message ?? json?.message ?? raw.slice(0, 200);
    // OpenRouter menaruh error asli provider upstream di error.metadata.raw
    const meta = json?.error?.metadata;
    if (meta?.raw) msg += ` (${meta.provider_name ?? "upstream"}: ${String(meta.raw).slice(0, 300)})`;
    throw Object.assign(new Error(`HTTP ${res.status}: ${msg}`), { status: res.status });
  }
  const choice = json?.choices?.[0];
  // jawaban terpotong (max_tokens habis, sering terjadi pada model "thinking") -> anggap gagal, coba model lain
  if (choice?.finish_reason === "length") {
    throw new Error(`Jawaban terpotong (max_tokens ${c.max_tokens} habis) — naikkan Max tokens model ini`);
  }
  const text = cleanOutput(choice?.message?.content ?? "");
  if (!text) throw new Error("Respons kosong dari model");
  return { text, usage: json.usage ?? {} };
}

/**
 * Coba model satu per satu: semua model FREE (urut priority) dulu,
 * jika semuanya gagal baru lanjut ke model PAID (jika use_paid_fallback aktif).
 */
export async function generateReply(
  messages: ChatMessage[],
  opts: { conversationId?: number; onlyModelPk?: number } = {},
): Promise<AiResult> {
  const s = await getSettings();
  const candidates = await getCandidates({ includePaid: s.use_paid_fallback || !!opts.onlyModelPk, onlyModelPk: opts.onlyModelPk });
  if (!candidates.length) throw new Error("Tidak ada model aktif yang punya API key. Atur di halaman admin → Providers/Models.");

  const attempts: AiResult["attempts"] = [];
  const now = Date.now();
  const ready = candidates.filter((c) => opts.onlyModelPk || (cooldown.get(`${c.model_pk}`) ?? 0) < now);
  const list = (ready.length ? ready : candidates).slice(0, Math.max(1, s.max_attempts || 6));

  for (const c of list) {
    const started = Date.now();
    try {
      const { text, usage } = await callModel(c, messages);
      const ms = Date.now() - started;
      attempts.push({ provider: c.provider_code, model: c.model_id, ok: true, ms });
      await sql`INSERT INTO ai_logs (conversation_id, provider, model, tier, success, latency_ms, prompt_tokens, completion_tokens)
                VALUES (${opts.conversationId ?? null}, ${c.provider_code}, ${c.model_id}, ${c.tier}, true, ${ms},
                        ${usage.prompt_tokens ?? null}, ${usage.completion_tokens ?? null})`;
      return { text, model: c.model_id, provider: c.provider_code, tier: c.tier, attempts };
    } catch (e: any) {
      const ms = Date.now() - started;
      const error = e?.name === "TimeoutError" ? `timeout ${c.timeout_ms}ms` : String(e?.message ?? e);
      attempts.push({ provider: c.provider_code, model: c.model_id, ok: false, error, ms });
      // 429/5xx/timeout -> istirahatkan 60 detik ; 401/403/404 -> 10 menit (kemungkinan key/model salah)
      const status = e?.status as number | undefined;
      const pause = status && [401, 403, 404].includes(status) ? 600_000 : 60_000;
      cooldown.set(`${c.model_pk}`, Date.now() + pause);
      await sql`INSERT INTO ai_logs (conversation_id, provider, model, tier, success, latency_ms, error)
                VALUES (${opts.conversationId ?? null}, ${c.provider_code}, ${c.model_id}, ${c.tier}, false, ${ms}, ${error.slice(0, 1000)})`;
      console.warn(`[ai] ${c.provider_code}/${c.model_id} gagal: ${error}`);
    }
  }
  const err = new Error("Semua model AI gagal");
  (err as any).attempts = attempts;
  throw err;
}
