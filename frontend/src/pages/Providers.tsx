import { FormEvent, useEffect, useState } from "react";
import { api, Provider } from "../api";

const EMPTY: Partial<Provider> = { code: "", name: "", base_url: "", api_key: "", api_key_env: "", requires_key: true, tier: "paid", enabled: true, extra_headers: {}, website: "", notes: "" };

export default function Providers() {
  const [list, setList] = useState<Provider[]>([]);
  const [edit, setEdit] = useState<Partial<Provider> | null>(null);
  const [sync, setSync] = useState<Provider | null>(null);
  const [error, setError] = useState("");

  const load = () => api<Provider[]>("/api/providers").then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const toggle = async (p: Provider) => {
    await api(`/api/providers/${p.id}`, { method: "PUT", body: { enabled: !p.enabled } });
    load();
  };
  const remove = async (p: Provider) => {
    if (!confirm(`Hapus provider ${p.name} beserta semua modelnya?`)) return;
    await api(`/api/providers/${p.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <div className="row">
        <h1>Provider AI</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Provider</button>
      </div>
      <p className="muted">
        Semua provider memakai format OpenAI-compatible (<span className="mono">/chat/completions</span>). API key bisa diisi langsung di sini (disimpan di database)
        atau lewat variabel <span className="mono">.env</span> yang namanya diisi di kolom "Env API key". Perubahan langsung berlaku tanpa build ulang.
      </p>
      {error && <div className="alert error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Provider</th><th>Tipe</th><th>Base URL</th><th>API Key</th><th>Model</th><th>Aktif</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <div className="muted small">{p.notes}</div>
                  {p.website && <a className="small" href={p.website} target="_blank" rel="noreferrer">dapatkan API key ↗</a>}
                </td>
                <td><span className={`badge ${p.tier}`}>{p.tier}</span></td>
                <td className="mono">{p.base_url}</td>
                <td>
                  {!p.requires_key ? <span className="badge ok">tidak perlu</span> : p.has_key ? <span className="badge ok">✓ {p.key_source}</span> : <span className="badge err">belum ada</span>}
                  {p.api_key_env && <div className="muted small mono">env: {p.api_key_env}</div>}
                </td>
                <td>{p.model_count}</td>
                <td><input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} /></td>
                <td>
                  <div className="row">
                    <button className="btn sm ghost" onClick={() => setEdit({ ...p, api_key: p.api_key ?? "" })}>Edit</button>
                    <button className="btn sm ghost" onClick={() => setSync(p)}>Sync models</button>
                    <button className="btn sm danger" onClick={() => remove(p)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <ProviderForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {sync && <SyncModels provider={sync} onClose={() => { setSync(null); load(); }} />}
    </>
  );
}

function ProviderForm({ value, onClose, onSaved }: { value: Partial<Provider>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...value, extra_headers: JSON.stringify(value.extra_headers ?? {}, null, 0) });
  const [error, setError] = useState("");
  const set = (k: string, val: unknown) => setV((o: any) => ({ ...o, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let headers = {};
    try {
      headers = v.extra_headers ? JSON.parse(v.extra_headers) : {};
    } catch {
      return setError("Extra headers harus JSON valid");
    }
    const body = { ...v, extra_headers: headers };
    delete body.has_key; delete body.key_source; delete body.model_count; delete body.id; delete body.created_at;
    try {
      if (value.id) await api(`/api/providers/${value.id}`, { method: "PUT", body });
      else await api("/api/providers", { body });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{value.id ? `Edit ${value.name}` : "Provider baru"}</h2>
        {error && <div className="alert error">{error}</div>}
        <div className="form-grid">
          <label className="field"><span>Kode (unik)</span><input value={v.code} onChange={(e) => set("code", e.target.value)} required /></label>
          <label className="field"><span>Nama</span><input value={v.name} onChange={(e) => set("name", e.target.value)} required /></label>
        </div>
        <label className="field"><span>Base URL (OpenAI-compatible, tanpa /chat/completions)</span><input value={v.base_url} onChange={(e) => set("base_url", e.target.value)} required placeholder="https://.../v1" /></label>
        <div className="form-grid">
          <label className="field"><span>API key (disimpan di DB, kosongkan untuk hapus)</span><input value={v.api_key ?? ""} onChange={(e) => set("api_key", e.target.value)} placeholder="sk-..." autoComplete="off" /></label>
          <label className="field"><span>Env API key (nama variabel di .env)</span><input value={v.api_key_env ?? ""} onChange={(e) => set("api_key_env", e.target.value)} placeholder="OPENROUTER_API_KEY" /></label>
          <label className="field"><span>Tipe</span>
            <select value={v.tier} onChange={(e) => set("tier", e.target.value)}>
              <option value="free">free</option><option value="freemium">freemium (ada free tier)</option><option value="paid">paid (berbayar)</option>
            </select>
          </label>
          <label className="field"><span>Website</span><input value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} /></label>
        </div>
        <label className="field"><span>Extra headers (JSON)</span><input className="mono" value={v.extra_headers} onChange={(e) => set("extra_headers", e.target.value)} /></label>
        <label className="field"><span>Catatan</span><textarea rows={2} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={v.requires_key} onChange={(e) => set("requires_key", e.target.checked)} /> Butuh API key</label>
          <label className="row small"><input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Aktif</label>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn">Simpan</button>
        </div>
      </form>
    </div>
  );
}

function SyncModels({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Record<string, "free" | "paid">>({});
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<any[]>(`/api/providers/${provider.id}/remote-models`).then(setItems).catch((e) => setError(e.message));
  }, []);

  const add = async () => {
    const body = Object.entries(sel).map(([model_id, tier], i) => ({
      provider_id: provider.id, model_id, label: model_id, tier, priority: (tier === "free" ? 90 : 290) + i, enabled: false,
    }));
    const r = await api<any[]>("/api/models", { body });
    setMsg(`${r.length} model ditambahkan (status nonaktif — aktifkan di halaman Model AI).`);
    setSel({});
    api<any[]>(`/api/providers/${provider.id}/remote-models`).then(setItems);
  };

  const shown = (items ?? []).filter((m) => !q || m.id.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Model tersedia di {provider.name}</h2>
        {error && <div className="alert error">{error}</div>}
        {msg && <div className="alert">{msg}</div>}
        {!items && !error && <p className="muted">Mengambil daftar model...</p>}
        {items && (
          <>
            <input placeholder="Filter (mis. :free, gemini, qwen)" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              <table>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <input type="checkbox" disabled={m.exists} checked={!!sel[m.id]}
                          onChange={(e) => setSel((s) => { const n = { ...s }; if (e.target.checked) n[m.id] = m.suggested_tier; else delete n[m.id]; return n; })} />
                      </td>
                      <td className="mono">{m.id}</td>
                      <td><span className={`badge ${m.suggested_tier}`}>{m.suggested_tier}</span></td>
                      <td>{m.exists && <span className="muted small">sudah ada</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted small">{Object.keys(sel).length} dipilih</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Tutup</button>
          <button className="btn" disabled={!Object.keys(sel).length} onClick={add}>Tambahkan</button>
        </div>
      </div>
    </div>
  );
}
