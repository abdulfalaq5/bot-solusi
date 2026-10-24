import { useEffect, useState } from "react";
import { api } from "../api";

export default function Settings() {
  const [s, setS] = useState<any>(null);
  const [kirim, setKirim] = useState<any>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [pw, setPw] = useState({ current: "", password: "" });

  useEffect(() => {
    api("/api/settings").then(setS);
    api("/api/kirim/status").then((k) => {
      setKirim(k);
      setHookUrl(k.webhook_url ?? `${location.origin}/webhook/kirim`);
    });
  }, []);

  const set = (k: string, v: unknown) => setS((o: any) => ({ ...o, [k]: v }));
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };

  const save = async () => {
    setError("");
    try {
      const { webhook_secrets, ...rest } = s;
      setS(await api("/api/settings", { method: "PUT", body: rest }));
      flash("Pengaturan tersimpan dan langsung berlaku.");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const registerHook = async () => {
    setError("");
    try {
      const r = await api("/api/kirim/webhook", { body: { url: hookUrl } });
      flash(r.secret_saved ? "Webhook terdaftar & signing secret disimpan otomatis." : "Webhook terdaftar. Secret tidak dikembalikan — isi KIRIM_WEBHOOK_SECRET di .env.");
      setKirim(await api("/api/kirim/status"));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const changePw = async () => {
    try {
      await api("/api/auth/password", { method: "PUT", body: pw });
      setPw({ current: "", password: "" });
      flash("Password diubah.");
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!s) return <p className="muted">Memuat...</p>;

  const accounts = kirim?.accounts?.data ?? [];
  const hooks = kirim?.webhooks?.data ?? [];

  return (
    <>
      <h1>Pengaturan</h1>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className="alert">{msg}</div>}

      <div className="card">
        <h2>Bot</h2>
        <div className="row" style={{ marginBottom: 12, gap: 20 }}>
          <label className="row"><input type="checkbox" checked={s.bot_enabled} onChange={(e) => set("bot_enabled", e.target.checked)} /> <b>Bot AI aktif</b></label>
          <label className="row"><input type="checkbox" checked={s.use_paid_fallback} onChange={(e) => set("use_paid_fallback", e.target.checked)} /> Gunakan model berbayar sebagai fallback</label>
          <label className="row"><input type="checkbox" checked={s.mark_as_read} onChange={(e) => set("mark_as_read", e.target.checked)} /> Tandai dibaca (centang biru)</label>
          <label className="row"><input type="checkbox" checked={s.typing_indicator} onChange={(e) => set("typing_indicator", e.target.checked)} /> Tampilkan "sedang mengetik"</label>
          <label className="row"><input type="checkbox" checked={s.takeover_on_open} onChange={(e) => set("takeover_on_open", e.target.checked)} /> Admin membuka chat di Inbox → AI berhenti</label>
          <label className="row"><input type="checkbox" checked={s.sync_kirim_agent} onChange={(e) => set("sync_kirim_agent", e.target.checked)} /> Admin membalas / assign di Kirimdev → AI berhenti (closed → AI aktif lagi)</label>
        </div>
        <div className="form-grid">
          <label className="field"><span>Nama bot</span><input value={s.bot_name} onChange={(e) => set("bot_name", e.target.value)} /></label>
          <label className="field"><span>Nama bisnis</span><input value={s.business_name} onChange={(e) => set("business_name", e.target.value)} /></label>
          <label className="field"><span>Mode default chat baru</span>
            <select value={s.default_mode} onChange={(e) => set("default_mode", e.target.value)}>
              <option value="ai">AI membalas otomatis</option><option value="human">Manual (admin)</option>
            </select>
          </label>
          <label className="field"><span>Jumlah riwayat chat dikirim ke AI</span><input type="number" value={s.history_limit} onChange={(e) => set("history_limit", Number(e.target.value))} /></label>
          <label className="field"><span>Jeda tunggu sebelum membalas (ms)</span><input type="number" value={s.reply_debounce_ms} onChange={(e) => set("reply_debounce_ms", Number(e.target.value))} /></label>
          <label className="field"><span>Maks. model dicoba per pesan</span><input type="number" value={s.max_attempts} onChange={(e) => set("max_attempts", Number(e.target.value))} /></label>
          <label className="field"><span>AI aktif lagi setelah admin membalas (menit, 0 = tidak)</span><input type="number" value={s.human_auto_resume_minutes} onChange={(e) => set("human_auto_resume_minutes", Number(e.target.value))} /></label>
          <label className="field"><span>Keyword minta admin (pisahkan koma)</span>
            <input value={(s.handoff_keywords ?? []).join(", ")} onChange={(e) => set("handoff_keywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          </label>
        </div>
        <label className="field"><span>Informasi bisnis (pengetahuan untuk CS AI: produk, harga, jam buka, FAQ...)</span>
          <textarea rows={8} value={s.business_info} onChange={(e) => set("business_info", e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field"><span>Balasan saat minta admin</span><textarea rows={3} value={s.handoff_reply} onChange={(e) => set("handoff_reply", e.target.value)} /></label>
          <label className="field"><span>Balasan jika semua model AI gagal</span><textarea rows={3} value={s.fallback_message} onChange={(e) => set("fallback_message", e.target.value)} /></label>
          <label className="field"><span>Balasan untuk pesan non-teks tanpa caption (kosong = diam)</span><textarea rows={3} value={s.reply_to_non_text} onChange={(e) => set("reply_to_non_text", e.target.value)} /></label>
        </div>
        <button className="btn" onClick={save}>Simpan pengaturan</button>
      </div>

      <div className="card">
        <h2>WhatsApp (Kirimdev)</h2>
        {!kirim ? <p className="muted">Memuat...</p> : (
          <>
            <p>
              Status: {kirim.configured ? <span className="badge ok">API key & Phone ID terisi</span> : <span className="badge err">KIRIM_API_KEY / KIRIM_PHONE_ID belum di .env</span>}
              {kirim.error && <span className="badge err" style={{ marginLeft: 6 }}>{kirim.error}</span>}
            </p>
            <p className="small">Phone Number ID aktif: <span className="mono">{kirim.phone_id || "-"}</span></p>
            {accounts.length > 0 && (
              <table style={{ marginBottom: 12 }}>
                <thead><tr><th>Akun terhubung</th><th>Phone Number ID</th></tr></thead>
                <tbody>
                  {accounts.map((a: any, i: number) => (
                    <tr key={i}><td>{a.display_phone_number ?? a.phone_number ?? a.verified_name ?? a.name ?? "-"}</td><td className="mono">{a.phone_number_id ?? a.id}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <label className="field"><span>URL webhook publik (harus HTTPS & bisa diakses internet)</span><input className="mono" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} /></label>
            <button className="btn" onClick={registerHook} disabled={!kirim.configured}>Daftarkan webhook ke Kirimdev</button>
            <p className="muted small">Signing secret disimpan otomatis di database. Secret tambahan dari .env: KIRIM_WEBHOOK_SECRET. Secret di DB: {s.webhook_secrets?.length ?? 0}.</p>
            {hooks.length > 0 && (
              <table>
                <thead><tr><th>Webhook terdaftar</th><th>Event</th><th>Status</th></tr></thead>
                <tbody>
                  {hooks.map((h: any) => (
                    <tr key={h.id}><td className="mono">{h.url}</td><td className="small">{(h.events ?? []).join(", ")}</td><td><span className={`badge ${h.status === "active" ? "ok" : "err"}`}>{h.status}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Ganti password admin</h2>
        <div className="form-grid">
          <label className="field"><span>Password lama</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field"><span>Password baru (min. 8)</span><input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
        </div>
        <button className="btn" onClick={changePw}>Ganti password</button>
      </div>
    </>
  );
}
