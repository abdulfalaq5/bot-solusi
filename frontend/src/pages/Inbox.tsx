import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Conversation, fmtTime, Message, Prompt } from "../api";

const SENDER_LABEL: Record<string, string> = { ai: "AI", admin: "Admin", system: "Sistem", customer: "" };

export default function Inbox() {
  const { id } = useParams();
  const nav = useNavigate();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [newChat, setNewChat] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastMsgId = useRef<number>(0);

  const active = convs.find((c) => String(c.id) === id);

  const loadConvs = () => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (filter) p.set("filter", filter);
    api<Conversation[]>(`/api/conversations?${p}`).then(setConvs).catch((e) => setError(e.message));
  };
  const loadMsgs = () => {
    if (!id) return;
    api<Message[]>(`/api/conversations/${id}/messages`).then((m) => {
      setMsgs(m);
      const last = m[m.length - 1]?.id ?? 0;
      if (last !== lastMsgId.current) {
        lastMsgId.current = last;
        setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }), 30);
      }
    });
  };

  useEffect(() => {
    api<Prompt[]>("/api/prompts").then(setPrompts);
  }, []);
  useEffect(() => {
    loadConvs();
    const t = setInterval(loadConvs, 4000);
    return () => clearInterval(t);
  }, [q, filter]);
  useEffect(() => {
    lastMsgId.current = 0;
    setMsgs([]);
    if (!id) return;
    loadMsgs();
    api(`/api/conversations/${id}/read`, { method: "POST", body: {} }).catch(() => {});
    const t = setInterval(loadMsgs, 3000);
    return () => clearInterval(t);
  }, [id]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !id) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/conversations/${id}/send`, { body: { text } });
      setText("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
      loadMsgs();
      loadConvs();
    }
  };

  const patch = async (body: any) => {
    await api(`/api/conversations/${id}`, { method: "PATCH", body });
    loadConvs();
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div className="inbox">
        <div className="conv-list">
          <div className="search">
            <input placeholder="Cari nama / nomor / pesan" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="row">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }}>
                <option value="">Semua</option>
                <option value="unread">Belum dibaca</option>
                <option value="human">Mode manual</option>
                <option value="attention">Perlu perhatian</option>
              </select>
              <button className="btn sm" onClick={() => setNewChat(true)}>+ Chat</button>
            </div>
          </div>
          <div className="conv-items">
            {convs.map((c) => (
              <div key={c.id} className={`conv-item ${String(c.id) === id ? "active" : ""}`} onClick={() => nav(`/inbox/${c.id}`)}>
                <div className="name">
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{c.contact_name || `+${c.wa_id}`}</span>
                  {c.needs_attention && <span title="Perlu perhatian">⚠️</span>}
                  <span className={`badge ${c.mode}`}>{c.mode === "ai" ? "AI" : "Manual"}</span>
                  {c.unread > 0 && <span className="unread">{c.unread}</span>}
                </div>
                <div className="preview">{c.last_preview}</div>
                <div className="muted small">{fmtTime(c.last_message_at)}</div>
              </div>
            ))}
            {convs.length === 0 && <p className="muted" style={{ padding: 12 }}>Belum ada percakapan.</p>}
          </div>
        </div>

        <div className="chat">
          {!active ? (
            <div className="empty">Pilih percakapan</div>
          ) : (
            <>
              <div className="chat-head">
                <div>
                  <b>{active.contact_name || `+${active.wa_id}`}</b>
                  <div className="muted small">+{active.wa_id}</div>
                </div>
                <div className="spacer" />
                <span className={`badge ${active.mode}`}>
                  {active.mode === "ai" ? "Dibalas AI" : `Manual${active.human_until ? ` s/d ${fmtTime(active.human_until)}` : ""}`}
                </span>
                {active.mode === "ai" ? (
                  <button className="btn sm ghost" onClick={() => patch({ mode: "human" })}>Ambil alih (manual)</button>
                ) : (
                  <button className="btn sm" onClick={() => patch({ mode: "ai" })}>Serahkan ke AI</button>
                )}
                <select
                  style={{ width: 200 }}
                  value={active.prompt_id ?? ""}
                  onChange={(e) => patch({ prompt_id: e.target.value ? Number(e.target.value) : null })}
                  title="Prompt untuk percakapan ini"
                >
                  <option value="">Prompt default</option>
                  {prompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="chat-body" ref={bodyRef}>
                {msgs.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction} ${m.sender}`}>
                    {m.body ?? <i className="muted">[{m.type}]</i>}
                    {m.media_url && (
                      <div><a href={m.media_url} target="_blank" rel="noreferrer">lihat media</a></div>
                    )}
                    <div className="meta">
                      {SENDER_LABEL[m.sender] && <b>{SENDER_LABEL[m.sender]}{m.source === "kirimdev" ? " (Kirimdev)" : ""} · </b>}
                      {m.model_used && <span title="model">{m.model_used} · </span>}
                      {fmtTime(m.created_at)}
                      {m.direction === "out" && m.status && ` · ${m.status}`}
                      {m.error && <div style={{ color: "var(--danger)" }}>{m.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <form className="chat-input" onSubmit={send}>
                <textarea
                  rows={2}
                  placeholder="Ketik balasan manual... (Enter kirim, Shift+Enter baris baru). Mengirim akan mengambil alih chat dari AI."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(e as any);
                    }
                  }}
                />
                <button className="btn" disabled={sending || !text.trim()}>Kirim</button>
              </form>
            </>
          )}
        </div>
      </div>
      {newChat && <NewChat onClose={() => setNewChat(false)} onCreated={(cid) => { setNewChat(false); loadConvs(); nav(`/inbox/${cid}`); }} />}
    </>
  );
}

function NewChat({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [waId, setWaId] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const c = await api("/api/conversations", { body: { wa_id: waId, name, text } });
      onCreated(c.id);
    } catch (err: any) {
      setError(err.message);
      if (err.data?.conversation) onCreated(err.data.conversation.id);
    }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Chat baru</h2>
        <p className="muted small">WhatsApp hanya mengizinkan pesan bebas jika pelanggan mengirim pesan dalam 24 jam terakhir. Di luar itu wajib template (atur di dashboard Kirimdev).</p>
        {error && <div className="alert error">{error}</div>}
        <label className="field"><span>Nomor WhatsApp (format 62...)</span><input value={waId} onChange={(e) => setWaId(e.target.value)} required /></label>
        <label className="field"><span>Nama (opsional)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Pesan</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} required /></label>
        <div className="row"><div className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>Batal</button><button className="btn">Kirim</button></div>
      </form>
    </div>
  );
}
