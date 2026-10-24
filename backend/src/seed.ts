import bcrypt from "bcryptjs";
import { sql } from "./db.js";
import { config } from "./config.js";

type SeedModel = { id: string; label: string; tier: "free" | "paid"; priority: number };
type SeedProvider = {
  code: string;
  name: string;
  base_url: string;
  api_key_env: string | null;
  requires_key?: boolean;
  tier: "free" | "freemium" | "paid";
  enabled?: boolean;
  website: string;
  notes: string;
  extra_headers?: Record<string, string>;
  models: SeedModel[];
};

// Semua provider di sini OpenAI-compatible (POST {base_url}/chat/completions).
// Nama model bisa berubah sewaktu-waktu: gunakan tombol "Sync models" di admin
// untuk mengambil daftar terbaru dari provider. Priority kecil = dicoba lebih dulu.
export const PROVIDERS: SeedProvider[] = [
  {
    code: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY",
    tier: "freemium",
    website: "https://openrouter.ai/models?q=free",
    notes: "Banyak model gratis (suffix :free). Limit gratis ±50 req/hari, 1000/hari jika top-up $10.",
    extra_headers: { "HTTP-Referer": "https://github.com/bot-solusi", "X-Title": "Bot Solusi" },
    models: [
      { id: "openrouter/free", label: "OpenRouter Free Router (auto pilih model gratis)", tier: "free", priority: 10 },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", tier: "free", priority: 12 },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super 120B (free)", tier: "free", priority: 14 },
      { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B A4B (free)", tier: "free", priority: 16 },
      { id: "openrouter/auto", label: "OpenRouter Auto (berbayar)", tier: "paid", priority: 230 },
    ],
  },
  {
    code: "groq",
    name: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    api_key_env: "GROQ_API_KEY",
    tier: "freemium",
    website: "https://console.groq.com/keys",
    notes: "Free tier dengan rate limit per menit/hari. Sangat cepat.",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", tier: "free", priority: 20 },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", tier: "free", priority: 22 },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (preview)", tier: "free", priority: 24 },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", tier: "free", priority: 26 },
    ],
  },
  {
    code: "gemini",
    name: "Google Gemini (AI Studio)",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    api_key_env: "GEMINI_API_KEY",
    tier: "freemium",
    website: "https://aistudio.google.com/apikey",
    notes: "Model Flash/Flash-Lite punya free tier di AI Studio. Model Pro/terbaru berbayar.",
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", tier: "free", priority: 30 },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", tier: "free", priority: 32 },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", tier: "paid", priority: 210 },
      { id: "gemini-4-argon", label: "Gemini 4 Argon", tier: "paid", priority: 260 },
    ],
  },
  {
    code: "cerebras",
    name: "Cerebras",
    base_url: "https://api.cerebras.ai/v1",
    api_key_env: "CEREBRAS_API_KEY",
    tier: "freemium",
    website: "https://cloud.cerebras.ai",
    notes: "Free tier harian, inference sangat cepat.",
    models: [
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", tier: "free", priority: 40 },
      { id: "qwen-3.8-27b", label: "Qwen 3.8 27B", tier: "free", priority: 42 },
    ],
  },
  {
    code: "mistral",
    name: "Mistral AI",
    base_url: "https://api.mistral.ai/v1",
    api_key_env: "MISTRAL_API_KEY",
    tier: "freemium",
    website: "https://console.mistral.ai",
    notes: "Plan 'Experiment' gratis (rate limit rendah).",
    models: [
      { id: "mistral-small-latest", label: "Mistral Small (latest)", tier: "free", priority: 50 },
      { id: "mistral-large-latest", label: "Mistral Large (latest)", tier: "paid", priority: 250 },
    ],
  },
  {
    code: "sumopod",
    name: "SumoPod AI",
    base_url: "https://ai.sumopod.com/v1",
    api_key_env: "SUMOPOD_API_KEY",
    tier: "paid",
    website: "https://ai.sumopod.com",
    notes: "Gateway Indonesia (bayar Rupiah) ke OpenAI, Gemini, Claude, DeepSeek, Qwen, dll. Ada beberapa model gratis.",
    models: [
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (free)", tier: "free", priority: 60 },
      { id: "qwen/qwen3-30b-a3b-instruct-2507", label: "Qwen3 30B A3B (free)", tier: "free", priority: 62 },
      { id: "gpt-5-mini", label: "GPT-5 mini", tier: "paid", priority: 200 },
      { id: "gemini/gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "paid", priority: 202 },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "paid", priority: 204 },
      { id: "qwen3.6-flash", label: "Qwen 3.6 Flash", tier: "paid", priority: 206 },
    ],
  },
  {
    code: "openai",
    name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    api_key_env: "OPENAI_API_KEY",
    tier: "paid",
    website: "https://platform.openai.com/api-keys",
    notes: "Berbayar.",
    models: [
      { id: "gpt-6-luna", label: "GPT-6 Luna (murah)", tier: "paid", priority: 220 },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", tier: "paid", priority: 240 },
      { id: "gpt-6-astra", label: "GPT-6 Astra (flagship)", tier: "paid", priority: 290 },
    ],
  },
  {
    code: "qwen",
    name: "Qwen (Alibaba Model Studio)",
    base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    api_key_env: "DASHSCOPE_API_KEY",
    tier: "paid",
    website: "https://modelstudio.console.alibabacloud.com",
    notes: "Berbayar (ada kuota gratis untuk akun baru).",
    models: [
      { id: "qwen3.8-flash", label: "Qwen 3.8 Flash", tier: "paid", priority: 212 },
      { id: "qwen3.7-plus", label: "Qwen 3.7 Plus", tier: "paid", priority: 232 },
      { id: "qwen3.8-max", label: "Qwen 3.8 Max", tier: "paid", priority: 270 },
    ],
  },
  {
    code: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    api_key_env: "DEEPSEEK_API_KEY",
    tier: "paid",
    website: "https://platform.deepseek.com",
    notes: "Berbayar, sangat murah.",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", tier: "paid", priority: 214 },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", tier: "paid", priority: 280 },
    ],
  },
  {
    code: "anthropic",
    name: "Anthropic Claude",
    base_url: "https://api.anthropic.com/v1",
    api_key_env: "ANTHROPIC_API_KEY",
    tier: "paid",
    website: "https://console.anthropic.com",
    notes: "Berbayar, via endpoint OpenAI-compatible Anthropic.",
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", tier: "paid", priority: 225 },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", tier: "paid", priority: 285 },
    ],
  },
  {
    code: "ollama",
    name: "Ollama (lokal / self-host)",
    base_url: "http://host.docker.internal:11434/v1",
    api_key_env: null,
    requires_key: false,
    tier: "free",
    enabled: false,
    website: "https://ollama.com/library",
    notes: "Gratis, jalan di server sendiri. Aktifkan jika Ollama sudah berjalan.",
    models: [{ id: "qwen3:8b", label: "Qwen3 8B (lokal)", tier: "free", priority: 5 }],
  },
];

const PROMPT_ASSISTANT = `Kamu adalah {bot_name}, asisten AI WhatsApp untuk {business_name}.
Tugasmu membantu pengguna menjawab pertanyaan secara umum dengan ramah, jelas, dan singkat.

Aturan:
- Gunakan Bahasa Indonesia yang santai tapi sopan, kecuali pengguna memakai bahasa lain.
- Jawaban ringkas (maksimal 3-5 kalimat), cocok dibaca di WhatsApp. Hindari tabel dan heading markdown.
- Untuk penekanan pakai format WhatsApp: *tebal*, _miring_.
- Jika tidak tahu, katakan jujur. Jangan mengarang data.
- Sapa pengguna dengan namanya ({customer_name}) bila tersedia.

Tanggal hari ini: {date}.`;

const PROMPT_CS = `Kamu adalah {bot_name}, Customer Service resmi {business_name} di WhatsApp.

Tugas:
- Menjawab pertanyaan pelanggan tentang produk, layanan, harga, jam operasional, dan pemesanan HANYA berdasarkan "Informasi Bisnis" di bawah.
- Bersikap ramah, empatik, profesional, dan solutif. Panggil pelanggan "Kak {customer_name}".
- Jawaban singkat dan jelas (maks. 5 kalimat), gunakan format WhatsApp (*tebal*, daftar dengan "-").
- Jika informasi tidak tersedia, komplain serius, atau pelanggan minta bicara dengan manusia, sampaikan bahwa pertanyaan akan diteruskan ke tim kami, lalu tambahkan tag [HANDOFF] di akhir jawaban.
- Jangan pernah menjanjikan diskon, refund, atau hal lain di luar informasi bisnis.

Informasi Bisnis:
{business_info}

Tanggal hari ini: {date}.`;

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  bot_enabled: true,
  bot_name: "Asisten Solusi",
  business_name: "Bot Solusi",
  business_info:
    "- Jam operasional: Senin-Jumat 08.00-17.00 WIB\n- Alamat: (isi alamat)\n- Produk/layanan: (isi daftar produk & harga)\n- Kontak admin: (isi nomor)",
  default_mode: "ai",
  history_limit: 12,
  reply_debounce_ms: 2500,
  use_paid_fallback: true,
  max_attempts: 6,
  fallback_message: "Maaf kak, sistem kami sedang sibuk. Pesan kakak sudah kami terima dan akan dibalas oleh admin secepatnya 🙏",
  handoff_keywords: ["admin", "cs", "manusia", "operator"],
  handoff_reply: "Baik kak, chat ini kami teruskan ke admin. Mohon tunggu sebentar ya 🙏",
  human_auto_resume_minutes: 30,
  mark_as_read: true,
  typing_indicator: true,
  reply_to_non_text: "Maaf kak, saat ini kami baru bisa membaca pesan teks. Silakan ketik pertanyaannya ya 🙏",
  webhook_secrets: [],
  // admin membuka chat di admin panel -> AI berhenti di chat itu (default mati: AI tetap menjawab
  // sampai admin mengambil alih secara manual dengan membalas / klik "Ambil alih")
  takeover_on_open: false,
  // admin membalas / di-assign dari inbox Kirimdev -> AI berhenti; conversation ditutup -> AI aktif lagi
  sync_kirim_agent: true,
  // jeda "sedang mengetik..." sebelum balasan AI dikirim (kanal nomor pribadi), acak di antara min-max
  // dan makin lama untuk pesan yang lebih panjang, supaya tidak terlihat seperti bot
  human_delay_min_ms: 3000,
  human_delay_max_ms: 9000,
};

export async function seed() {
  const existing = new Set((await sql`SELECT code FROM providers`).map((r) => r.code as string));
  for (const p of PROVIDERS) {
    if (existing.has(p.code)) continue; // sudah ada, jangan timpa editan admin
    const [row] = await sql`
      INSERT INTO providers (code, name, base_url, api_key_env, requires_key, tier, enabled, website, notes, extra_headers)
      VALUES (${p.code}, ${p.name}, ${p.base_url}, ${p.api_key_env}, ${p.requires_key ?? true}, ${p.tier},
              ${p.enabled ?? true}, ${p.website}, ${p.notes}, ${sql.json(p.extra_headers ?? {})})
      ON CONFLICT (code) DO NOTHING
      RETURNING id`;
    if (!row) continue;
    for (const m of p.models) {
      await sql`
        INSERT INTO ai_models (provider_id, model_id, label, tier, priority)
        VALUES (${row.id}, ${m.id}, ${m.label}, ${m.tier}, ${m.priority})
        ON CONFLICT DO NOTHING`;
    }
  }

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM prompts`;
  if (count === 0) {
    await sql`INSERT INTO prompts (name, kind, content, is_default) VALUES
      ('CS AI (Customer Service)', 'cs', ${PROMPT_CS}, true),
      ('Asisten AI (Umum)', 'assistant', ${PROMPT_ASSISTANT}, false)`;
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${sql.json(value as any)}) ON CONFLICT (key) DO NOTHING`;
  }

  const hash = await bcrypt.hash(config.adminPassword, 10);
  await sql`INSERT INTO admins (email, password_hash) VALUES (${config.adminEmail}, ${hash}) ON CONFLICT (email) DO NOTHING`;
}
