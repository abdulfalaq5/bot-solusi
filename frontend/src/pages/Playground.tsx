import { FormEvent, useEffect, useState } from "react";
import { api, Model, Prompt } from "../api";

type Msg = { role: "user" | "assistant"; content: string; meta?: string };

export default function Playground() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [promptId, setPromptId] = useState("");
  const [modelPk, setModelPk] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Prompt[]>("/api/prompts").then(setPrompts);
    api<Model[]>("/api/models").then(setModels);
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setText("");
    setLoading(true);
    setError("");
    try {
      const r = await api("/api/playground", {
        body: { messages: next.map(({ role, content }) => ({ role, content })), prompt_id: promptId || null, model_pk: modelPk || null },
      });
      setAttempts(r.attempts);
      setMsgs([...next, { role: "assistant", content: r.text, meta: `${r.provider}/${r.model} (${r.tier})` }]);
    } catch (err: any) {
      setError(err.message);
      setAttempts(err.data?.attempts ?? []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1>Playground</h1>
      <p className="muted">Uji prompt & urutan fallback model tanpa WhatsApp. Pesan di sini tidak dikirim ke pelanggan.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={promptId} onChange={(e) => setPromptId(e.target.value)} style={{ width: 260, maxWidth: "100%" }}>
          <option value="">Prompt default</option>
          {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={modelPk} onChange={(e) => setModelPk(e.target.value)} style={{ width: 340, maxWidth: "100%" }}>
          <option value="">Otomatis (fallback free → paid)</option>
          {models.map((m) => <option key={m.id} value={m.id}>[{m.tier}] {m.provider_name} / {m.model_id}</option>)}
        </select>
        <button className="btn ghost" onClick={() => { setMsgs([]); setAttempts([]); }}>Reset</button>
      </div>
      <div className="inbox playground has-active">
        <div className="chat">
          <div className="chat-body">
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "in" : "out"}`}>
                {m.content}
                {m.meta && <div className="meta">{m.meta}</div>}
              </div>
            ))}
            {loading && <div className="bubble out muted">mengetik...</div>}
          </div>
          {error && <div className="alert error" style={{ margin: 8 }}>{error}</div>}
          <form className="chat-input" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan sebagai pelanggan..." />
            <button className="btn" disabled={loading}>Kirim</button>
          </form>
        </div>
        <div className="attempts">
          <h2>Percobaan model</h2>
          {attempts.map((a, i) => (
            <div key={i} className="small" style={{ marginBottom: 8 }}>
              <span className={`badge ${a.ok ? "ok" : "err"}`}>{a.ok ? "OK" : "gagal"}</span> <b>{a.provider}</b> <span className="mono">{a.model}</span> · {a.ms}ms
              {a.error && <div className="muted">{a.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
