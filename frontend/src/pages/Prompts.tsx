import { useEffect, useState } from "react";
import { api, fmtTime, Prompt } from "../api";

const KIND_LABEL = { assistant: "Asisten AI", cs: "CS AI", custom: "Custom" };

export default function Prompts() {
  const [list, setList] = useState<Prompt[]>([]);
  const [sel, setSel] = useState<Partial<Prompt> | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = () => api<Prompt[]>("/api/prompts").then((l) => {
    setList(l);
    return l;
  });
  useEffect(() => {
    load().then((l) => setSel((s) => s ?? l[0] ?? null));
  }, []);

  const save = async () => {
    if (!sel) return;
    setError("");
    try {
      const body = { name: sel.name, kind: sel.kind, content: sel.content };
      const r = sel.id ? await api(`/api/prompts/${sel.id}`, { method: "PUT", body }) : await api("/api/prompts", { body });
      setSel(r);
      setMsg("Tersimpan — langsung dipakai untuk balasan berikutnya.");
      setTimeout(() => setMsg(""), 3000);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const makeDefault = async () => {
    await api(`/api/prompts/${sel!.id}/default`, { body: {} });
    const l = await load();
    setSel(l.find((p) => p.id === sel!.id) ?? null);
  };
  const remove = async () => {
    if (!confirm("Hapus prompt ini?")) return;
    try {
      await api(`/api/prompts/${sel!.id}`, { method: "DELETE" });
      const l = await load();
      setSel(l[0] ?? null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="row">
        <h1>Prompt</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setSel({ name: "Prompt baru", kind: "custom", content: "" })}>+ Prompt</button>
      </div>
      <p className="muted">
        Variabel yang tersedia: <span className="mono">{"{bot_name} {business_name} {business_info} {customer_name} {date}"}</span>. Prompt <b>default</b> dipakai untuk semua chat,
        kecuali percakapan yang di-set prompt khusus di Inbox. Tambahkan instruksi <span className="mono">[HANDOFF]</span> agar AI bisa menyerahkan chat ke admin.
      </p>
      <div className="prompts-grid">
        <div className="card" style={{ padding: 0 }}>
          {list.map((p) => (
            <div key={p.id} className={`conv-item ${sel?.id === p.id ? "active" : ""}`} onClick={() => setSel(p)}>
              <div className="name">{p.name} {p.is_default && <span className="badge ok">default</span>}</div>
              <div className="muted small">{KIND_LABEL[p.kind]} · {fmtTime(p.updated_at)}</div>
            </div>
          ))}
        </div>
        {sel && (
          <div className="card">
            {error && <div className="alert error">{error}</div>}
            {msg && <div className="alert">{msg}</div>}
            <div className="form-grid">
              <label className="field"><span>Nama</span><input value={sel.name ?? ""} onChange={(e) => setSel({ ...sel, name: e.target.value })} /></label>
              <label className="field"><span>Jenis</span>
                <select value={sel.kind} onChange={(e) => setSel({ ...sel, kind: e.target.value as any })}>
                  <option value="assistant">Asisten AI</option><option value="cs">CS AI</option><option value="custom">Custom</option>
                </select>
              </label>
            </div>
            <label className="field"><span>System prompt</span>
              <textarea rows={20} className="mono" value={sel.content ?? ""} onChange={(e) => setSel({ ...sel, content: e.target.value })} />
            </label>
            <div className="row">
              <button className="btn" onClick={save}>Simpan</button>
              {sel.id && !sel.is_default && <button className="btn ghost" onClick={makeDefault}>Jadikan default</button>}
              <div className="spacer" />
              {sel.id && !sel.is_default && <button className="btn danger" onClick={remove}>Hapus</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
