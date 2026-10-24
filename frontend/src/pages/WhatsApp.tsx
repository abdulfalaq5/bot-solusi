import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";

const STATUS_LABEL: Record<string, string> = {
  disabled: "Nonaktif",
  connecting: "Menghubungkan...",
  qr: "Menunggu scan QR",
  open: "Terhubung",
  closed: "Terputus (mencoba ulang)",
  logged_out: "Logout — menunggu QR baru",
  unreachable: "Service wa-baileys tidak bisa dihubungi",
};

export default function WhatsApp() {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = () => api("/api/whatsapp/status").then(setS).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const action = async (a: "logout" | "restart") => {
    if (a === "logout" && !confirm("Logout nomor ini dari bot? Anda perlu scan QR lagi.")) return;
    setBusy(a);
    try {
      await api(`/api/whatsapp/baileys/${a}`, { body: {} });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
      load();
    }
  };

  if (!s) return <p className="muted">Memuat...</p>;
  const b = s.baileys ?? {};

  return (
    <>
      <h1>Kanal WhatsApp</h1>
      {error && <div className="alert error">{error}</div>}
      <p className="muted">
        Saklar kanal diatur di file <span className="mono">.env</span> (<span className="mono">KIRIM_ENABLED</span>, <span className="mono">BAILEYS_ENABLED</span>),
        lalu jalankan <span className="mono">docker compose up -d</span>.
      </p>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Nomor pribadi (Baileys / WhatsApp Web)</h2>
          <span className={`badge ${b.enabled ? (b.status === "open" ? "ok" : "human") : ""}`}>
            {b.enabled ? STATUS_LABEL[b.status] ?? b.status : "Nonaktif"}
          </span>
          <div className="spacer" />
          {b.enabled && (
            <>
              <button className="btn sm ghost" disabled={!!busy} onClick={() => action("restart")}>Reconnect</button>
              <button className="btn sm danger" disabled={!!busy || b.status !== "open"} onClick={() => action("logout")}>Logout</button>
            </>
          )}
        </div>
        <div className="alert" style={{ marginTop: 12 }}>
          Kanal ini <b>tidak resmi</b>. Meta bisa memblokir nomor yang terdeteksi memakai bot. Gunakan nomor yang siap menanggung risiko,
          jangan kirim broadcast / pesan massal, dan hanya balas pelanggan yang menghubungi lebih dulu.
        </div>
        {!b.enabled && <p className="muted">Aktifkan dengan <span className="mono">BAILEYS_ENABLED=true</span> di .env.</p>}
        {b.enabled && b.status === "open" && (
          <p>
            Terhubung sebagai <b>{b.me?.name ?? "-"}</b> <span className="mono">+{String(b.me?.id ?? "").split("@")[0]}</span>
            <span className="muted small"> · sejak {fmtTime(b.since)}</span>
          </p>
        )}
        {b.enabled && b.qr && (
          <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
            <img src={b.qr} alt="QR WhatsApp" style={{ width: 280, height: 280, border: "1px solid var(--border)", borderRadius: 8 }} />
            <ol>
              <li>Buka WhatsApp di HP nomor yang akan dipakai bot.</li>
              <li>Ketuk <b>⋮ / Setelan → Perangkat tertaut → Tautkan perangkat</b>.</li>
              <li>Scan QR di samping. QR diperbarui otomatis tiap ±20 detik.</li>
            </ol>
          </div>
        )}
        {b.lastError && b.status !== "open" && <p className="muted small">Info terakhir: {b.lastError}</p>}
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Kirimdev (WhatsApp Business API resmi)</h2>
          <span className={`badge ${s.kirimdev.enabled ? "ok" : ""}`}>{s.kirimdev.enabled ? "Aktif" : "Nonaktif"}</span>
        </div>
        <p className="muted small">
          {s.kirimdev.enabled
            ? "Webhook & pengiriman lewat Kirimdev aktif. Detail ada di halaman Pengaturan."
            : "Dinonaktifkan: webhook Kirimdev diterima tapi diabaikan, dan tidak ada pesan yang dikirim lewat Kirimdev. Aktifkan lagi dengan KIRIM_ENABLED=true."}
        </p>
      </div>
    </>
  );
}
