import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";

export default function Logs() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const load = () => api<any[]>(`/api/logs${status ? `?status=${status}` : ""}`).then(setRows);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [status]);

  return (
    <>
      <div className="row">
        <h1>Log AI</h1>
        <div className="spacer" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">Semua</option><option value="ok">Sukses</option><option value="fail">Gagal</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Waktu</th><th>Status</th><th>Tipe</th><th>Provider / Model</th><th>Latensi</th><th>Token</th><th>Chat</th><th>Error</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmtTime(r.created_at)}</td>
                <td><span className={`badge ${r.success ? "ok" : "err"}`}>{r.success ? "OK" : "gagal"}</span></td>
                <td><span className={`badge ${r.tier}`}>{r.tier}</span></td>
                <td><b>{r.provider}</b> <span className="mono">{r.model}</span></td>
                <td className="small">{r.latency_ms} ms</td>
                <td className="small">{r.prompt_tokens ?? "-"} / {r.completion_tokens ?? "-"}</td>
                <td className="small">{r.conversation_id ? <a href={`/inbox/${r.conversation_id}`}>#{r.conversation_id}</a> : "playground"}</td>
                <td className="small muted" style={{ maxWidth: 380 }}>{r.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
