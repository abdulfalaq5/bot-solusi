import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function Dashboard() {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => api("/api/stats").then(setS).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!s) return <p className="muted">Memuat...</p>;

  const stats = [
    ["Percakapan", s.conversations],
    ["Pesan masuk 24j", s.inbound_24h],
    ["Balasan AI 24j", s.ai_replies_24h],
    ["Balasan admin 24j", s.admin_replies_24h],
    ["Mode manual (human)", s.human_mode],
    ["Perlu perhatian", s.needs_attention],
  ];

  return (
    <>
      <h1>Dashboard</h1>
      {!s.kirim_configured && <div className="alert error">KIRIM_API_KEY / KIRIM_PHONE_ID belum diisi di file .env.</div>}
      {!s.webhook_secret_configured && (
        <div className="alert">Webhook secret belum diset — signature webhook tidak diverifikasi. Daftarkan webhook di <Link to="/settings">Pengaturan</Link>.</div>
      )}
      {!s.bot_enabled && <div className="alert">Bot sedang <b>NONAKTIF</b>. Aktifkan di Pengaturan.</div>}
      <div className="grid" style={{ marginBottom: 16 }}>
        {stats.map(([l, n]) => (
          <div className="card stat" key={l}>
            <div className="num">{n}</div>
            <div className="lbl">{l}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Urutan fallback model aktif</h2>
        <p className="muted small">Model gratis dicoba lebih dulu, jika gagal lanjut ke berikutnya, lalu model berbayar. Hanya model yang provider-nya punya API key yang tampil.</p>
        {s.active_chain.length === 0 ? (
          <div className="alert error">Belum ada model yang siap dipakai. Isi API key provider di halaman <Link to="/providers">Provider AI</Link>.</div>
        ) : (
          <ol>
            {s.active_chain.map((c: any, i: number) => (
              <li key={i}>
                <span className={`badge ${c.tier}`}>{c.tier}</span> <b>{c.provider}</b> / <span className="mono">{c.model}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2>Pemakaian model (24 jam)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Provider</th><th>Model</th><th>Tipe</th><th>Request</th><th>Sukses</th><th>Rata-rata</th></tr>
            </thead>
            <tbody>
              {s.usage.map((u: any, i: number) => (
                <tr key={i}>
                  <td>{u.provider}</td>
                  <td className="mono">{u.model}</td>
                  <td><span className={`badge ${u.tier}`}>{u.tier}</span></td>
                  <td>{u.total}</td>
                  <td>{u.ok}</td>
                  <td>{u.avg_ms ? `${u.avg_ms} ms` : "-"}</td>
                </tr>
              ))}
              {s.usage.length === 0 && <tr><td colSpan={6} className="muted">Belum ada data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
