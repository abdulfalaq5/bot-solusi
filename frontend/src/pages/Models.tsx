import { FormEvent, useEffect, useState } from "react";
import { api, Model, Provider } from "../api";

export default function Models() {
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [edit, setEdit] = useState<Partial<Model> | null>(null);
  const [tests, setTests] = useState<Record<number, any>>({});
  const [tier, setTier] = useState("");
  const [prov, setProv] = useState("");

  const load = () => api<Model[]>("/api/models").then(setModels);
  useEffect(() => {
    load();
    api<Provider[]>("/api/providers").then(setProviders);
  }, []);

  const update = async (m: Model, patch: Partial<Model>) => {
    setModels((list) => list.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
    await api(`/api/models/${m.id}`, { method: "PUT", body: patch });
    load();
  };
  const test = async (m: Model) => {
    setTests((t) => ({ ...t, [m.id]: { loading: true } }));
    const r = await api(`/api/models/${m.id}/test`, { body: {} }).catch((e) => ({ ok: false, error: e.message }));
    setTests((t) => ({ ...t, [m.id]: r }));
  };
  const remove = async (m: Model) => {
    if (!confirm(`Hapus model ${m.model_id}?`)) return;
    await api(`/api/models/${m.id}`, { method: "DELETE" });
    load();
  };

  const keyOk = new Map(providers.map((p) => [p.id, !p.requires_key || p.has_key]));
  const shown = models.filter((m) => (!tier || m.tier === tier) && (!prov || String(m.provider_id) === prov));

  return (
    <>
      <div className="row">
        <h1>Model AI</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setEdit({ tier: "free", enabled: true, priority: 100, temperature: 0.7, max_tokens: 800, timeout_ms: 30000, provider_id: providers[0]?.id })}>
          + Model
        </button>
      </div>
      <p className="muted">
        Urutan pemakaian: semua model <span className="badge free">free</span> (priority kecil lebih dulu) → jika gagal semua, lanjut ke model <span className="badge paid">paid</span>.
        Matikan "Gunakan model berbayar sebagai fallback" di Pengaturan jika hanya ingin model gratis.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 160, maxWidth: "100%" }}>
          <option value="">Semua tipe</option><option value="free">free</option><option value="paid">paid</option>
        </select>
        <select value={prov} onChange={(e) => setProv(e.target.value)} style={{ width: 220, maxWidth: "100%" }}>
          <option value="">Semua provider</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Aktif</th><th>Priority</th><th>Tipe</th><th>Provider</th><th>Model</th><th>Temp / Max token</th><th>Tes</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} style={{ opacity: m.enabled && m.provider_enabled ? 1 : 0.55 }}>
                <td><input type="checkbox" checked={m.enabled} onChange={() => update(m, { enabled: !m.enabled })} /></td>
                <td>
                  <input type="number" style={{ width: 70, maxWidth: "100%" }} defaultValue={m.priority} key={`${m.id}-${m.priority}`}
                    onBlur={(e) => Number(e.target.value) !== m.priority && update(m, { priority: Number(e.target.value) })} />
                </td>
                <td>
                  <select value={m.tier} onChange={(e) => update(m, { tier: e.target.value as any })} style={{ width: 80, maxWidth: "100%" }}>
                    <option value="free">free</option><option value="paid">paid</option>
                  </select>
                </td>
                <td>
                  {m.provider_name}
                  {!keyOk.get(m.provider_id) && <div><span className="badge err">API key kosong</span></div>}
                  {!m.provider_enabled && <div><span className="badge">provider off</span></div>}
                </td>
                <td><span className="mono">{m.model_id}</span><div className="muted small">{m.label}</div></td>
                <td className="small">{m.temperature} / {m.max_tokens}</td>
                <td style={{ maxWidth: 260 }}>
                  <button className="btn sm ghost" onClick={() => test(m)} disabled={tests[m.id]?.loading}>{tests[m.id]?.loading ? "..." : "Tes"}</button>
                  {tests[m.id] && !tests[m.id].loading && (
                    <div className="small">
                      {tests[m.id].ok ? <span className="badge ok">OK {tests[m.id].ms}ms</span> : <span className="badge err">Gagal</span>}{" "}
                      <span className="muted">{tests[m.id].text ?? tests[m.id].error}</span>
                    </div>
                  )}
                </td>
                <td>
                  <div className="row">
                    <button className="btn sm ghost" onClick={() => setEdit(m)}>Edit</button>
                    <button className="btn sm danger" onClick={() => remove(m)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <ModelForm value={edit} providers={providers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function ModelForm({ value, providers, onClose, onSaved }: { value: Partial<Model>; providers: Provider[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>(value);
  const [error, setError] = useState("");
  const set = (k: string, val: unknown) => setV((o: any) => ({ ...o, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      provider_id: Number(v.provider_id), model_id: v.model_id, label: v.label, tier: v.tier, enabled: v.enabled,
      priority: Number(v.priority), temperature: Number(v.temperature), max_tokens: Number(v.max_tokens), timeout_ms: Number(v.timeout_ms),
    };
    try {
      if (value.id) await api(`/api/models/${value.id}`, { method: "PUT", body });
      else {
        const r = await api<any[]>("/api/models", { body });
        if (!r.length) throw new Error("Model sudah ada untuk provider ini");
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{value.id ? "Edit model" : "Model baru"}</h2>
        {error && <div className="alert error">{error}</div>}
        <div className="form-grid">
          <label className="field"><span>Provider</span>
            <select value={v.provider_id} onChange={(e) => set("provider_id", e.target.value)}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Model ID (persis seperti di provider)</span><input className="mono" value={v.model_id ?? ""} onChange={(e) => set("model_id", e.target.value)} required /></label>
          <label className="field"><span>Label</span><input value={v.label ?? ""} onChange={(e) => set("label", e.target.value)} /></label>
          <label className="field"><span>Tipe</span>
            <select value={v.tier} onChange={(e) => set("tier", e.target.value)}><option value="free">free</option><option value="paid">paid</option></select>
          </label>
          <label className="field"><span>Priority (kecil = dicoba duluan)</span><input type="number" value={v.priority} onChange={(e) => set("priority", e.target.value)} /></label>
          <label className="field"><span>Temperature</span><input type="number" step="0.1" min="0" max="2" value={v.temperature} onChange={(e) => set("temperature", e.target.value)} /></label>
          <label className="field"><span>Max tokens</span><input type="number" value={v.max_tokens} onChange={(e) => set("max_tokens", e.target.value)} /></label>
          <label className="field"><span>Timeout (ms)</span><input type="number" value={v.timeout_ms} onChange={(e) => set("timeout_ms", e.target.value)} /></label>
        </div>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={!!v.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Aktif</label>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn">Simpan</button>
        </div>
      </form>
    </div>
  );
}
