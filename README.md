# Bot Solusi — WhatsApp AI Bot (Kirimdev)

Bot WhatsApp (WhatsApp Business API resmi via [Kirimdev](https://docs.kirimdev.com)) yang bisa:
- **Asisten AI** dan **CS AI**: membalas otomatis dengan prompt yang tersimpan di database.
- **Chat bisnis manual**: admin membalas dari Inbox, mengambil alih chat dari AI, lalu menyerahkannya kembali.
- **Multi provider AI dengan fallback**: model **free** dicoba dulu (urut priority). Kalau semuanya gagal, lanjut ke model **paid**.
- Semua pengaturan (provider, model, API key, prompt, info bisnis) diubah dari halaman admin **tanpa build ulang**.

> 📘 **Tutorial lengkap setup, menyambungkan Kirimdev, dan memilih model AI: [TUTORIAL.md](TUTORIAL.md)**

## Stack

| Komponen | Teknologi | Alasan |
|---|---|---|
| API + webhook | Node.js 22 + TypeScript + Fastify | I/O async, cocok untuk webhook & HTTP ke LLM; Kirimdev menyediakan SDK TS |
| Antrean | Redis + BullMQ | webhook langsung dibalas 200, proses AI di worker, retry & debounce |
| Database | PostgreSQL 16 | provider, model, prompt, setting, chat, log |
| Admin UI | React + Vite, disajikan nginx | nginx juga mem-proxy `/api` & `/webhook` |

```
WhatsApp ⇄ Kirimdev ──webhook──▶ web(nginx) ─▶ api ─▶ Redis queue ─▶ worker ─▶ AI (free → paid)
                                                                       └──▶ Kirimdev /messages (balasan)
```

## Menjalankan

```bash
cp .env.example .env      # isi KIRIM_API_KEY, KIRIM_PHONE_ID, ADMIN_*, JWT_SECRET, POSTGRES_PASSWORD
docker compose up -d --build
```

Buka `http://localhost:${WEB_PORT}`, lalu login dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Hubungkan WhatsApp
1. Server harus bisa diakses publik lewat HTTPS, misalnya dengan domain + reverse proxy, Cloudflare Tunnel, atau ngrok untuk tes. Isi `PUBLIC_URL`.
2. Di admin, buka **Pengaturan → WhatsApp (Kirimdev)** dan klik **Daftarkan webhook**. Signing secret akan tersimpan otomatis di DB. Bisa juga daftar manual di dashboard Kirimdev ke `https://domain/webhook/kirim` (event `message.received` dan `message.status`), lalu isi `KIRIM_WEBHOOK_SECRET`.
3. Kirim chat ke nomor WhatsApp bisnis Anda.

### Atur AI
1. **Provider AI**: isi API key (di DB lewat form, atau di `.env` sesuai nama variabel). Provider tanpa key dilewati.
2. **Model AI**: aktifkan/nonaktifkan model, ubah priority, ubah tipe free/paid, lalu klik **Tes**. Pakai **Sync models** di Provider untuk mengambil daftar model terbaru dari provider.
3. **Prompt**: edit prompt CS / Asisten, lalu pilih default. Di Inbox, prompt bisa dibedakan per percakapan.
4. **Playground**: uji prompt dan urutan fallback tanpa mengirim ke WhatsApp.

## Provider bawaan

| Provider | Tipe | Contoh model | Key |
|---|---|---|---|
| OpenRouter | freemium | `openrouter/free`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free` | `OPENROUTER_API_KEY` |
| Groq | freemium | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b` | `GROQ_API_KEY` |
| Google Gemini | freemium | `gemini-3.5-flash-lite`, `gemini-3.6-flash` (free), `gemini-4-argon` (paid) | `GEMINI_API_KEY` |
| Cerebras | freemium | `gpt-oss-120b`, `qwen-3.8-27b` | `CEREBRAS_API_KEY` |
| Mistral | freemium | `mistral-small-latest` | `MISTRAL_API_KEY` |
| Ollama (lokal) | free | `qwen3:8b` (nonaktif default) | – |
| SumoPod | paid | `gpt-5-mini`, `gemini/gemini-2.5-flash`, `deepseek-v4-flash`, `qwen3.6-flash` | `SUMOPOD_API_KEY` |
| OpenAI | paid | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` | `OPENAI_API_KEY` |
| Qwen (Alibaba) | paid | `qwen3.8-flash`, `qwen3.7-plus`, `qwen3.8-max` | `DASHSCOPE_API_KEY` |
| DeepSeek | paid | `deepseek-chat`, `deepseek-reasoner` | `DEEPSEEK_API_KEY` |
| Anthropic | paid | `claude-haiku-5-5`, `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |

Nama model dan kuota gratis bisa berubah, jadi gunakan **Sync models** dan **Tes**. Provider lain yang OpenAI-compatible (Together, NVIDIA NIM, GitHub Models, dll.) bisa ditambahkan dari form **+ Provider**.

## Perilaku bot
- **Debounce**: pesan beruntun digabung, lalu dibalas sekali (`reply_debounce_ms`).
- **Handoff**: keyword (`admin`, `cs`, ...) atau tag `[HANDOFF]` dari AI memindahkan chat ke mode manual dan menandainya "perlu perhatian".
- **Mode manual**: saat admin membalas, AI berhenti dan aktif lagi setelah `human_auto_resume_minutes` (0 = tetap manual).
- **Circuit breaker**: model yang kena 429/timeout diistirahatkan 60 detik, sedangkan 401/403/404 diistirahatkan 10 menit.
- **Keamanan**: verifikasi HMAC `X-Kirim-Signature`, dedupe berdasarkan `wamid`, dan JWT untuk admin.
- WhatsApp hanya mengizinkan pesan bebas dalam **24 jam** sejak pesan terakhir pelanggan.

## Pengembangan lokal
```bash
docker compose up -d postgres redis   # (expose port bila perlu)
cd backend && npm i && DATABASE_URL=... JWT_SECRET=dev npm run dev
cd frontend && npm i && npm run dev
```
