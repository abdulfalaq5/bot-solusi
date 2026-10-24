# Tutorial Setup Bot Solusi

Panduan langkah demi langkah: dari install sampai bot membalas chat WhatsApp pakai AI.

- [1. Persiapan](#1-persiapan)
- [2. Siapkan akun Kirimdev](#2-siapkan-akun-kirimdev)
- [3. Isi file .env](#3-isi-file-env)
- [4. Jalankan dengan Docker](#4-jalankan-dengan-docker)
- [5. Buat server bisa diakses publik (HTTPS)](#5-buat-server-bisa-diakses-publik-https)
- [6. Sambungkan webhook Kirimdev](#6-sambungkan-webhook-kirimdev)
- [7. Pilih & atur model AI](#7-pilih--atur-model-ai)
- [8. Atur prompt & informasi bisnis](#8-atur-prompt--informasi-bisnis)
- [9. Tes kirim chat](#9-tes-kirim-chat)
- [10. Chat manual dari admin](#10-chat-manual-dari-admin)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Perintah Docker yang sering dipakai](#12-perintah-docker-yang-sering-dipakai)

---

## 1. Persiapan

| Kebutuhan | Keterangan |
|---|---|
| Server / VPS / PC | Linux, Windows (WSL2), atau macOS dengan **Docker** dan **Docker Compose v2** |
| Akun Kirimdev | [app.kirimdev.com](https://app.kirimdev.com), dengan minimal 1 nomor WhatsApp Business yang sudah terhubung |
| Domain + HTTPS | Webhook Kirimdev perlu URL publik HTTPS. Untuk uji coba bisa pakai Cloudflare Tunnel atau ngrok |
| API key AI | Minimal 1 provider. Untuk mulai gratis, gunakan **OpenRouter** atau **Groq** |

Cek Docker:

```bash
docker --version
docker compose version
```

---

## 2. Siapkan akun Kirimdev

1. Daftar atau login di **[app.kirimdev.com](https://app.kirimdev.com)**.
2. **Hubungkan nomor WhatsApp**. Dashboard akan memandu proses *embedded signup* Meta. Ikuti sampai nomor berstatus aktif/approved.
3. **Buat API key**: buka menu **Developers → API Keys**, lalu klik **Create key**. Beri label, misalnya `bot-solusi`.
   > ⚠️ API key hanya ditampilkan **sekali**. Langsung salin dan simpan. Formatnya `kdv_live_...`.
4. **Ambil Phone Number ID**: buka **WhatsApp → Accounts**, klik **⋯** pada nomor Anda, lalu pilih **Copy Phone Number ID**.

Simpan dua nilai ini (API key dan Phone Number ID) untuk langkah berikutnya.

---

## 3. Isi file .env

Masuk ke folder project:

```bash
cd bot-solusi
cp .env.example .env     # lewati jika .env sudah ada
nano .env                # atau editor lain
```

Isi minimal bagian berikut:

```env
# --- WhatsApp via Kirimdev ---
KIRIM_API_KEY=kdv_live_xxxxxxxxxxxxxxxxxxxxxxxx
KIRIM_PHONE_ID=1234567890123456
KIRIM_WEBHOOK_SECRET=          # biarkan kosong jika daftar webhook lewat admin panel (langkah 6)

# --- URL publik server (HTTPS, tanpa / di akhir) ---
PUBLIC_URL=https://bot.domainanda.com

# --- Admin panel ---
WEB_PORT=8080
ADMIN_EMAIL=admin@domainanda.com
ADMIN_PASSWORD=PasswordKuat123
JWT_SECRET=isi-string-acak-panjang     # buat dengan: openssl rand -hex 32

# --- Database ---
POSTGRES_PASSWORD=password-db-yang-kuat

# --- API key AI (isi minimal satu) ---
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxx
```

> 💡 **Catatan penting**
> - `ADMIN_EMAIL` / `ADMIN_PASSWORD` hanya dipakai saat **pertama kali** database dibuat. Setelah itu, ganti password lewat **Pengaturan → Ganti password admin**.
> - Jangan ganti `POSTGRES_PASSWORD` setelah database terbentuk, karena aplikasi tidak akan bisa konek lagi. Kalau terpaksa, hapus volume DB dulu (lihat bagian 12).
> - API key AI juga bisa diisi langsung dari admin panel (langkah 7) tanpa restart.
> - Jangan pernah commit file `.env` ke git. File ini sudah masuk `.gitignore`.

---

## 4. Jalankan dengan Docker

```bash
docker compose up -d --build
```

Build pertama butuh beberapa menit. Setelah selesai, cek semua service:

```bash
docker compose ps
```

Hasilnya harus seperti ini:

```
SERVICE    STATUS
api        Up (healthy)
postgres   Up (healthy)
redis      Up (healthy)
web        Up
worker     Up
```

Buka admin panel di **http://IP-SERVER:8080** (sesuai `WEB_PORT`), lalu login dengan `ADMIN_EMAIL` dan `ADMIN_PASSWORD`.

> Jika muncul error `port is already allocated`, ganti `WEB_PORT` di `.env` (misalnya `8090`), lalu jalankan `docker compose up -d` lagi.

---

## 5. Buat server bisa diakses publik (HTTPS)

Kirimdev mengirim pesan masuk ke `https://DOMAIN-ANDA/webhook/kirim`, jadi URL itu harus bisa diakses dari internet. Pilih salah satu cara berikut.

### Opsi A: VPS + domain + Caddy (paling mudah untuk produksi)

Arahkan DNS `bot.domainanda.com` ke IP VPS. Install [Caddy](https://caddyserver.com/docs/install), lalu buat `/etc/caddy/Caddyfile`:

```
bot.domainanda.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy otomatis membuat sertifikat HTTPS (Let's Encrypt). Nginx + Certbot juga bisa dipakai.

### Opsi B: Cloudflare Tunnel (tanpa buka port, cocok untuk server di rumah/kantor)

```bash
cloudflared tunnel --url http://localhost:8080
```

Salin URL `https://xxxx.trycloudflare.com` yang muncul. Untuk URL permanen, buat *named tunnel* di dashboard Cloudflare Zero Trust.

### Opsi C: ngrok (hanya untuk uji coba)

```bash
ngrok http 8080
```

> ⚠️ URL gratis ngrok/trycloudflare **berubah setiap restart**. Kalau URL berubah, daftarkan ulang webhook (langkah 6).

Setelah dapat URL, isi `PUBLIC_URL` di `.env`, lalu restart:

```bash
docker compose up -d
```

Tes dari luar:

```bash
curl https://bot.domainanda.com/health
# {"ok":true}
```

---

## 6. Sambungkan webhook Kirimdev

### Cara 1: lewat admin panel (disarankan)

1. Buka **Pengaturan**, lalu scroll ke kartu **WhatsApp (Kirimdev)**.
2. Pastikan statusnya **"API key & Phone ID terisi"** dan nomor Anda muncul di tabel **Akun terhubung**.
   Jika muncul error `401`, berarti `KIRIM_API_KEY` salah.
3. Isi **URL webhook publik**: `https://bot.domainanda.com/webhook/kirim`.
4. Klik **Daftarkan webhook ke Kirimdev**.
5. Webhook akan terdaftar dengan event `message.received` dan `message.status`. Signing secret dari Kirimdev **tersimpan otomatis** di database, jadi tidak perlu diisi ke `.env`.
6. Tabel **Webhook terdaftar** akan menampilkan URL Anda dengan status `active`.

### Cara 2: manual di dashboard Kirimdev

1. Di dashboard Kirimdev, buat webhook subscription ke URL `https://bot.domainanda.com/webhook/kirim`.
2. Pilih event **`message.received`** dan **`message.status`**.
3. Salin **signing secret** yang diberikan, lalu isi di `.env`:
   ```env
   KIRIM_WEBHOOK_SECRET=whsec_xxxxxxxx
   ```
4. Restart: `docker compose up -d`.

> 🔐 Setiap webhook diverifikasi dengan HMAC (`X-Kirim-Signature`). Request dengan signature salah ditolak (`401`). Jika secret belum diisi sama sekali, webhook tetap diterima **tanpa verifikasi**, dan Dashboard akan menampilkan peringatan. Jangan biarkan kondisi ini di produksi.

---

## 7. Pilih & atur model AI

### 7.1 Cara kerja pemilihan model

Untuk setiap pesan masuk, bot mencoba model satu per satu:

```
Model FREE (priority terkecil dulu) ──gagal──▶ model FREE berikutnya ──gagal──▶ ...
        ──semua free gagal──▶ Model PAID (priority terkecil dulu) ──▶ ...
        ──semua gagal──▶ kirim "pesan fallback" + tandai chat "perlu perhatian"
```

- Model hanya dipakai jika **model aktif**, **provider aktif**, dan **API key provider tersedia**.
- Model yang kena limit (429) atau timeout diistirahatkan 60 detik. Model dengan key/nama salah (401/403/404) diistirahatkan 10 menit.
- Urutan model yang benar-benar aktif bisa dilihat di **Dashboard → Urutan fallback model aktif**.

### 7.2 Isi API key provider

Buka menu **Provider AI**:

1. Klik **Edit** pada provider, misalnya OpenRouter.
2. Isi kolom **API key**, lalu klik **Simpan**. Key langsung berlaku tanpa restart.
   Atau biarkan kosong dan isi variabel `.env` sesuai kolom **Env API key** (misalnya `OPENROUTER_API_KEY`), lalu restart.
3. Kolom **API Key** berubah menjadi ✓ hijau.

Tempat mendapatkan API key:

| Provider | Tipe | Daftar / ambil key | Catatan |
|---|---|---|---|
| OpenRouter | freemium | [openrouter.ai/keys](https://openrouter.ai/keys) | Banyak model `:free`. Rekomendasi pertama |
| Groq | freemium | [console.groq.com/keys](https://console.groq.com/keys) | Gratis & sangat cepat |
| Google Gemini | freemium | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Flash/Flash-Lite ada free tier |
| Cerebras | freemium | [cloud.cerebras.ai](https://cloud.cerebras.ai) | Free tier harian |
| Mistral | freemium | [console.mistral.ai](https://console.mistral.ai) | Plan "Experiment" gratis |
| SumoPod | paid | [ai.sumopod.com](https://ai.sumopod.com) | Bayar Rupiah, banyak model |
| OpenAI | paid | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | |
| Qwen (Alibaba) | paid | [modelstudio.console.alibabacloud.com](https://modelstudio.console.alibabacloud.com) | |
| DeepSeek | paid | [platform.deepseek.com](https://platform.deepseek.com) | Sangat murah |
| Anthropic | paid | [console.anthropic.com](https://console.anthropic.com) | |
| Ollama | free (lokal) | [ollama.com](https://ollama.com) | Jalan di server sendiri. Aktifkan provider-nya dulu |

**Rekomendasi awal (gratis):** isi key **OpenRouter** dan **Groq**. Untuk cadangan berbayar yang murah, tambahkan **SumoPod** atau **DeepSeek**.

### 7.3 Atur model

Buka menu **Model AI**:

| Kolom | Fungsi |
|---|---|
| **Aktif** | Centang untuk memasukkan model ke antrean fallback |
| **Priority** | Angka kecil = dicoba lebih dulu (dalam tipe yang sama) |
| **Tipe** | `free` = dicoba duluan, `paid` = cadangan berbayar |
| **Tes** | Kirim pesan uji ke model. Hasilnya `OK` + waktu respons, atau pesan error |
| **Edit** | Ubah temperature, max tokens, timeout |

Langkah yang disarankan:

1. Klik **Tes** di setiap model yang provider-nya sudah punya key.
2. **Nonaktifkan** model yang gagal atau lambat.
3. Taruh model tercepat dan paling bagus di **priority** paling kecil.
4. Atur pengaturan berikut di **Pengaturan**:
   - **Gunakan model berbayar sebagai fallback**: matikan jika hanya ingin pakai model gratis.
   - **Maks. model dicoba per pesan** (default 6). Pastikan nilainya **lebih besar dari jumlah model free yang aktif**. Kalau tidak, model paid tidak akan pernah sempat dicoba.

### 7.4 Menambah model baru

Nama model di provider sering berubah. Cara termudah menambah model:

1. Di **Provider AI**, klik **Sync models** pada provider. Daftar model terbaru akan diambil langsung dari provider. Model gratis OpenRouter ditandai `free`.
2. Ketik filter (misalnya `:free`, `gemini`, `qwen`), centang model yang diinginkan, lalu klik **Tambahkan**.
3. Model baru masuk dalam keadaan **nonaktif**. Buka **Model AI**, klik **Tes**, lalu aktifkan.

Bisa juga lewat tombol **+ Model** dengan mengetik Model ID secara manual.

### 7.5 Menambah provider lain

Provider apa pun yang **OpenAI-compatible** (Together, NVIDIA NIM, GitHub Models, LM Studio, dll.) bisa ditambahkan:

**Provider AI → + Provider**, lalu isi:
- **Kode**: unik, misalnya `together`
- **Base URL**: berakhiran `/v1`, **tanpa** `/chat/completions` (misalnya `https://api.together.xyz/v1`)
- **API key** dan **Tipe** (free/freemium/paid)

### 7.6 Uji di Playground

Menu **Playground** dipakai untuk mencoba chat **tanpa** mengirim ke WhatsApp:
- Pilih prompt, lalu pilih **Otomatis (fallback free → paid)** atau model tertentu.
- Panel kanan menampilkan model mana yang dicoba, mana yang gagal, dan kenapa.

---

## 8. Atur prompt & informasi bisnis

1. **Pengaturan → Bot**: isi **Nama bot**, **Nama bisnis**, dan **Informasi bisnis** (produk, harga, jam buka, alamat, FAQ). Informasi ini menjadi "pengetahuan" bagi CS AI.
2. **Prompt**: tersedia dua prompt bawaan:
   - **CS AI (Customer Service)**: default. Hanya menjawab berdasarkan informasi bisnis, dan bisa menyerahkan chat ke admin.
   - **Asisten AI (Umum)**: menjawab pertanyaan umum.
3. Edit isi prompt, lalu klik **Simpan**. Perubahan langsung dipakai untuk balasan berikutnya. Klik **Jadikan default** untuk mengganti prompt utama.
4. Variabel yang bisa dipakai di prompt:

   | Variabel | Isi |
   |---|---|
   | `{bot_name}` | Nama bot |
   | `{business_name}` | Nama bisnis |
   | `{business_info}` | Informasi bisnis |
   | `{customer_name}` | Nama WhatsApp pelanggan |
   | `{date}` | Tanggal hari ini (WIB) |

5. Supaya AI bisa menyerahkan chat ke manusia, tulis instruksi di prompt agar AI menambahkan **`[HANDOFF]`** di akhir jawaban. Tag ini otomatis dihapus sebelum pesan dikirim, lalu chat pindah ke mode manual.

---

## 9. Tes kirim chat

1. Dari HP lain, kirim chat ke nomor WhatsApp bisnis Anda, misalnya: *"Halo, jam buka kapan?"*
2. Dalam beberapa detik, pesan akan dicentang biru, muncul "sedang mengetik...", lalu AI membalas.
3. Buka **Inbox Chat** di admin. Percakapan muncul, dan setiap balasan AI menampilkan nama model yang dipakai.
4. Cek **Log AI** untuk melihat model, latensi, dan error.

> Bot sengaja menunggu ±2,5 detik (**Jeda tunggu sebelum membalas**) supaya beberapa pesan beruntun dari pelanggan dibalas sekali saja.

---

## 10. Chat manual dari admin

| Aksi | Cara |
|---|---|
| Balas manual | Buka chat di **Inbox**, ketik, lalu Enter. AI otomatis berhenti di chat itu |
| Ambil alih tanpa membalas | Klik **Ambil alih (manual)** |
| Kembalikan ke AI | Klik **Serahkan ke AI** |
| AI aktif lagi otomatis | Atur di **Pengaturan → AI aktif lagi setelah admin membalas (menit)**. `0` = tetap manual sampai diserahkan |
| Ganti prompt per chat | Dropdown prompt di header chat |
| Pelanggan minta admin | Keyword (`admin`, `cs`, `manusia`, `operator`, bisa diubah) memindahkan chat ke mode manual dan menandainya ⚠️ |
| Chat baru | Tombol **+ Chat** di Inbox |

> ⚠️ Aturan WhatsApp: pesan bebas hanya bisa dikirim dalam **24 jam** sejak pesan terakhir pelanggan. Di luar itu wajib pakai **template** yang disetujui Meta (dikelola di dashboard Kirimdev).

---

## 11. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Bot tidak membalas sama sekali | Cek `docker compose logs -f api worker`. Pastikan webhook `active` di **Pengaturan**, `PUBLIC_URL` bisa diakses, dan **Bot AI aktif** dicentang |
| Log `webhook signature tidak valid` | Secret salah. Daftarkan ulang webhook lewat admin, atau perbaiki `KIRIM_WEBHOOK_SECRET` lalu restart |
| Pesan masuk ke Inbox, tapi AI tidak membalas | Chat sedang mode **Manual**, atau tidak ada model siap pakai (lihat Dashboard → Urutan fallback) |
| Pelanggan menerima "Maaf kak, sistem kami sedang sibuk..." | Semua model gagal. Buka **Log AI** untuk melihat error-nya (key salah, model tidak ada, limit habis) |
| Error `HTTP 401` di Log AI | API key provider salah atau kosong |
| Error `HTTP 404` / `model not found` | Nama model salah atau sudah tidak tersedia. Gunakan **Sync models** |
| Error `HTTP 429` | Limit gratis habis. Tambahkan provider/model lain, atau aktifkan fallback berbayar |
| Balasan admin berstatus `failed` + `outside_24h_window` | Lewat 24 jam. Harus pakai template |
| Status Kirimdev `401` di Pengaturan | `KIRIM_API_KEY` salah. Buat key baru di **Developers → API Keys** |
| Lupa password admin | `docker compose exec postgres psql -U bot -d botsolusi -c "DELETE FROM admins;"`, lalu `docker compose restart api`. Admin akan dibuat ulang dari `.env` |

---

## 12. Perintah Docker yang sering dipakai

```bash
docker compose up -d --build          # build ulang setelah update kode
docker compose ps                     # status service
docker compose logs -f api worker     # lihat log realtime
docker compose restart api worker     # restart setelah ubah .env
docker compose down                   # stop (data tetap aman)

# backup & restore database
docker compose exec -T postgres pg_dump -U bot botsolusi > backup.sql
docker compose exec -T postgres psql -U bot -d botsolusi < backup.sql

docker compose down -v                # ⚠️ HAPUS SEMUA DATA (chat, setting, model)
```

> Perubahan di admin panel (model, provider, prompt, setting) **tidak perlu** build ulang atau restart. Restart hanya diperlukan setelah mengubah `.env`.
