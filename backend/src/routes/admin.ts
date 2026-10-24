import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { sql } from "../db.js";
import { config } from "../config.js";
import { callModel, generateReply, getCandidates, resolveKey } from "../ai/router.js";
import { getSettings, updateSettings } from "../services/settings.js";
import { buildSystemPrompt, sendAndStore } from "../services/conversation.js";
import { kirimApi } from "../services/kirim.js";

const PROVIDER_FIELDS = ["code", "name", "base_url", "api_key", "api_key_env", "requires_key", "tier", "enabled", "extra_headers", "website", "notes"] as const;
const MODEL_FIELDS = ["provider_id", "model_id", "label", "tier", "enabled", "priority", "temperature", "max_tokens", "timeout_ms"] as const;
const PROMPT_FIELDS = ["name", "kind", "content"] as const;

function pick<T extends readonly string[]>(body: any, fields: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (body && body[f] !== undefined) out[f] = body[f];
  return out;
}

function maskKey(k: string | null) {
  if (!k) return null;
  return k.length <= 8 ? "****" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function publicProvider(p: any) {
  return {
    ...p,
    api_key: maskKey(p.api_key),
    has_key: !!resolveKey(p),
    key_source: p.api_key ? "database" : p.api_key_env && process.env[p.api_key_env] ? `env:${p.api_key_env}` : null,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };

  // ---------- auth ----------
  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = (req.body ?? {}) as any;
    const [admin] = await sql`SELECT * FROM admins WHERE email = ${String(email ?? "")}`;
    if (!admin || !(await bcrypt.compare(String(password ?? ""), admin.password_hash))) {
      return reply.code(401).send({ error: "Email atau password salah" });
    }
    const token = app.jwt.sign({ sub: admin.id, email: admin.email }, { expiresIn: "7d" });
    return { token, email: admin.email };
  });

  app.register(async (r) => {
    r.addHook("preHandler", auth);

    r.get("/api/auth/me", async (req) => req.user);

    r.put("/api/auth/password", async (req, reply) => {
      const { current, password } = (req.body ?? {}) as any;
      const id = (req.user as any).sub;
      const [admin] = await sql`SELECT * FROM admins WHERE id = ${id}`;
      if (!admin || !(await bcrypt.compare(String(current ?? ""), admin.password_hash))) return reply.code(400).send({ error: "Password lama salah" });
      if (!password || String(password).length < 8) return reply.code(400).send({ error: "Password minimal 8 karakter" });
      await sql`UPDATE admins SET password_hash = ${await bcrypt.hash(String(password), 10)} WHERE id = ${id}`;
      return { ok: true };
    });

    // ---------- dashboard ----------
    r.get("/api/stats", async () => {
      const [c] = await sql`
        SELECT
          (SELECT count(*)::int FROM conversations) AS conversations,
          (SELECT count(*)::int FROM conversations WHERE mode = 'human') AS human_mode,
          (SELECT count(*)::int FROM conversations WHERE needs_attention) AS needs_attention,
          (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours' AND direction = 'in') AS inbound_24h,
          (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours' AND sender = 'ai') AS ai_replies_24h,
          (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours' AND sender = 'admin') AS admin_replies_24h`;
      const usage = await sql`
        SELECT provider, model, tier, count(*)::int AS total, count(*) FILTER (WHERE success)::int AS ok,
               round(avg(latency_ms) FILTER (WHERE success))::int AS avg_ms
        FROM ai_logs WHERE created_at > now() - interval '24 hours'
        GROUP BY provider, model, tier ORDER BY total DESC LIMIT 20`;
      const s = await getSettings();
      const candidates = await getCandidates({ includePaid: s.use_paid_fallback });
      return {
        ...c,
        usage,
        bot_enabled: s.bot_enabled,
        active_chain: candidates.map((x) => ({ provider: x.provider_code, model: x.model_id, tier: x.tier })),
        kirim_configured: !!(config.kirim.apiKey && config.kirim.phoneId),
        webhook_secret_configured: !!(config.kirim.webhookSecrets.length || s.webhook_secrets?.length),
      };
    });

    // ---------- providers ----------
    r.get("/api/providers", async () => {
      const rows = await sql`
        SELECT p.*, (SELECT count(*)::int FROM ai_models m WHERE m.provider_id = p.id) AS model_count
        FROM providers p ORDER BY p.tier = 'paid', p.id`;
      return rows.map(publicProvider);
    });

    r.post("/api/providers", async (req, reply) => {
      const d = pick(req.body, PROVIDER_FIELDS);
      if (!d.code || !d.name || !d.base_url) return reply.code(400).send({ error: "code, name, base_url wajib" });
      if (d.extra_headers) d.extra_headers = sql.json(d.extra_headers as any);
      const [row] = await sql`INSERT INTO providers ${sql(d)} RETURNING *`;
      return publicProvider(row);
    });

    r.put("/api/providers/:id", async (req) => {
      const d = pick(req.body, PROVIDER_FIELDS);
      // api_key: string kosong = hapus, nilai mask (mengandung …) = jangan ubah
      if (typeof d.api_key === "string") {
        if (d.api_key.includes("…") || d.api_key === "****") delete d.api_key;
        else if (d.api_key.trim() === "") d.api_key = null;
      }
      if (d.extra_headers) d.extra_headers = sql.json(d.extra_headers as any);
      const id = Number((req.params as any).id);
      if (!Object.keys(d).length) return { ok: true };
      const [row] = await sql`UPDATE providers SET ${sql(d)} WHERE id = ${id} RETURNING *`;
      return publicProvider(row);
    });

    r.delete("/api/providers/:id", async (req) => {
      await sql`DELETE FROM providers WHERE id = ${Number((req.params as any).id)}`;
      return { ok: true };
    });

    // ambil daftar model langsung dari endpoint /models provider
    r.get("/api/providers/:id/remote-models", async (req, reply) => {
      const [p] = await sql`SELECT * FROM providers WHERE id = ${Number((req.params as any).id)}`;
      if (!p) return reply.code(404).send({ error: "not found" });
      const key = resolveKey(p);
      try {
        const res = await fetch(`${p.base_url.replace(/\/+$/, "")}/models`, {
          headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(p.extra_headers ?? {}) },
          signal: AbortSignal.timeout(20000),
        });
        const json: any = await res.json().catch(() => null);
        if (!res.ok) return reply.code(502).send({ error: json?.error?.message ?? `HTTP ${res.status}` });
        const list: any[] = json?.data ?? json?.models ?? [];
        const existing = new Set((await sql`SELECT model_id FROM ai_models WHERE provider_id = ${p.id}`).map((m) => m.model_id));
        return list
          .map((m) => {
            const id = String(m.id ?? m.name ?? "").replace(/^models\//, "");
            const pr = m.pricing;
            const free = id.endsWith(":free") || id === "openrouter/free" || (pr && Number(pr.prompt) === 0 && Number(pr.completion) === 0);
            return { id, name: m.name ?? id, suggested_tier: free || p.tier === "free" ? "free" : "paid", exists: existing.has(id) };
          })
          .filter((m) => m.id)
          .sort((a, b) => Number(b.suggested_tier === "free") - Number(a.suggested_tier === "free") || a.id.localeCompare(b.id));
      } catch (e: any) {
        return reply.code(502).send({ error: e.message });
      }
    });

    // ---------- models ----------
    r.get("/api/models", async () =>
      sql`SELECT m.*, p.name AS provider_name, p.code AS provider_code, p.enabled AS provider_enabled
          FROM ai_models m JOIN providers p ON p.id = m.provider_id
          ORDER BY (m.tier = 'paid'), m.priority, m.id`,
    );

    r.post("/api/models", async (req, reply) => {
      const body = req.body as any;
      const items = Array.isArray(body) ? body : [body];
      const out = [];
      for (const it of items) {
        const d = pick(it, MODEL_FIELDS);
        if (!d.provider_id || !d.model_id) return reply.code(400).send({ error: "provider_id dan model_id wajib" });
        const [row] = await sql`INSERT INTO ai_models ${sql(d)} ON CONFLICT (provider_id, model_id) DO NOTHING RETURNING *`;
        if (row) out.push(row);
      }
      return out;
    });

    r.put("/api/models/:id", async (req) => {
      const d = pick(req.body, MODEL_FIELDS);
      if (!Object.keys(d).length) return { ok: true };
      const [row] = await sql`UPDATE ai_models SET ${sql(d)} WHERE id = ${Number((req.params as any).id)} RETURNING *`;
      return row;
    });

    r.delete("/api/models/:id", async (req) => {
      await sql`DELETE FROM ai_models WHERE id = ${Number((req.params as any).id)}`;
      return { ok: true };
    });

    r.post("/api/models/:id/test", async (req, reply) => {
      const [c] = await getCandidates({ includePaid: true, onlyModelPk: Number((req.params as any).id) });
      if (!c) return reply.code(400).send({ error: "Model tidak ditemukan atau API key provider belum diisi" });
      const started = Date.now();
      try {
        const r = await callModel(c, [{ role: "user", content: "Balas dengan satu kalimat singkat: halo, kamu model apa?" }]);
        return { ok: true, ms: Date.now() - started, text: r.text };
      } catch (e: any) {
        return { ok: false, ms: Date.now() - started, error: e.message };
      }
    });

    // ---------- prompts ----------
    r.get("/api/prompts", async () => sql`SELECT * FROM prompts ORDER BY is_default DESC, id`);

    r.post("/api/prompts", async (req, reply) => {
      const d = pick(req.body, PROMPT_FIELDS);
      if (!d.name || !d.content) return reply.code(400).send({ error: "name dan content wajib" });
      const [row] = await sql`INSERT INTO prompts ${sql(d)} RETURNING *`;
      return row;
    });

    r.put("/api/prompts/:id", async (req) => {
      const d = { ...pick(req.body, PROMPT_FIELDS), updated_at: new Date() };
      const [row] = await sql`UPDATE prompts SET ${sql(d)} WHERE id = ${Number((req.params as any).id)} RETURNING *`;
      return row;
    });

    r.post("/api/prompts/:id/default", async (req) => {
      const id = Number((req.params as any).id);
      await sql.begin(async (tx) => {
        await tx`UPDATE prompts SET is_default = false WHERE is_default`;
        await tx`UPDATE prompts SET is_default = true WHERE id = ${id}`;
      });
      return { ok: true };
    });

    r.delete("/api/prompts/:id", async (req, reply) => {
      const id = Number((req.params as any).id);
      const [p] = await sql`SELECT is_default FROM prompts WHERE id = ${id}`;
      if (p?.is_default) return reply.code(400).send({ error: "Prompt default tidak bisa dihapus. Jadikan prompt lain default dulu." });
      await sql`DELETE FROM prompts WHERE id = ${id}`;
      return { ok: true };
    });

    // ---------- settings ----------
    r.get("/api/settings", async () => getSettings());
    r.put("/api/settings", async (req) => {
      await updateSettings((req.body ?? {}) as Record<string, unknown>);
      return getSettings();
    });

    // ---------- conversations / inbox ----------
    r.get("/api/conversations", async (req) => {
      const { q, filter } = (req.query ?? {}) as any;
      const like = q ? `%${q}%` : null;
      return sql`
        SELECT c.*, ct.wa_id, ct.name AS contact_name, p.name AS prompt_name
        FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
        LEFT JOIN prompts p ON p.id = c.prompt_id
        WHERE (${like}::text IS NULL OR ct.wa_id ILIKE ${like} OR ct.name ILIKE ${like} OR c.last_preview ILIKE ${like})
          AND (${filter ?? null}::text IS NULL
               OR (${filter ?? null} = 'human' AND c.mode = 'human')
               OR (${filter ?? null} = 'attention' AND c.needs_attention)
               OR (${filter ?? null} = 'unread' AND c.unread > 0))
        ORDER BY c.last_message_at DESC LIMIT 200`;
    });

    r.get("/api/conversations/:id/messages", async (req) => {
      const id = Number((req.params as any).id);
      const before = Number((req.query as any)?.before) || null;
      const rows = await sql`
        SELECT * FROM messages WHERE conversation_id = ${id} AND (${before}::bigint IS NULL OR id < ${before})
        ORDER BY id DESC LIMIT 100`;
      return rows.reverse();
    });

    r.post("/api/conversations/:id/read", async (req) => {
      await sql`UPDATE conversations SET unread = 0, needs_attention = false WHERE id = ${Number((req.params as any).id)}`;
      return { ok: true };
    });

    r.patch("/api/conversations/:id", async (req) => {
      const id = Number((req.params as any).id);
      const b = (req.body ?? {}) as any;
      if (b.mode === "ai") await sql`UPDATE conversations SET mode = 'ai', human_until = NULL, needs_attention = false WHERE id = ${id}`;
      if (b.mode === "human") await sql`UPDATE conversations SET mode = 'human', human_until = NULL WHERE id = ${id}`;
      if (b.prompt_id !== undefined) await sql`UPDATE conversations SET prompt_id = ${b.prompt_id || null} WHERE id = ${id}`;
      const [row] = await sql`SELECT * FROM conversations WHERE id = ${id}`;
      return row;
    });

    // kirim pesan manual dari admin (chat bisnis manual)
    r.post("/api/conversations/:id/send", async (req, reply) => {
      const id = Number((req.params as any).id);
      const { text, takeover = true } = (req.body ?? {}) as any;
      if (!text || !String(text).trim()) return reply.code(400).send({ error: "Pesan kosong" });
      const [conv] = await sql`SELECT c.*, ct.wa_id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ${id}`;
      if (!conv) return reply.code(404).send({ error: "not found" });
      try {
        const row = await sendAndStore(id, conv.wa_id, conv.phone_number_id, String(text).trim(), "admin");
        if (takeover) {
          const s = await getSettings();
          const minutes = Number(s.human_auto_resume_minutes) || 0;
          const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
          await sql`UPDATE conversations SET mode = 'human', human_until = ${until}, unread = 0, needs_attention = false WHERE id = ${id}`;
        }
        return row;
      } catch (e: any) {
        return reply.code(502).send({ error: e.message, message: e.stored });
      }
    });

    // mulai chat baru ke nomor tertentu (hanya berhasil jika masih dalam jendela 24 jam WhatsApp)
    r.post("/api/conversations", async (req, reply) => {
      const { wa_id, name, text } = (req.body ?? {}) as any;
      const waId = String(wa_id ?? "").replace(/[^\d]/g, "");
      if (!waId || !text) return reply.code(400).send({ error: "wa_id dan text wajib" });
      const [ct] = await sql`INSERT INTO contacts (wa_id, name) VALUES (${waId}, ${name ?? null})
                             ON CONFLICT (wa_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name) RETURNING *`;
      const [conv] = await sql`INSERT INTO conversations (contact_id, phone_number_id, mode) VALUES (${ct.id}, ${config.kirim.phoneId}, 'human')
                               ON CONFLICT (contact_id, phone_number_id) DO UPDATE SET mode = 'human' RETURNING *`;
      try {
        await sendAndStore(conv.id, waId, conv.phone_number_id, String(text), "admin");
        return conv;
      } catch (e: any) {
        return reply.code(502).send({ error: e.message, conversation: conv });
      }
    });

    // ---------- playground ----------
    r.post("/api/playground", async (req, reply) => {
      const { messages = [], prompt_id, model_pk, customer_name } = (req.body ?? {}) as any;
      const system = await buildSystemPrompt(prompt_id ? Number(prompt_id) : null, customer_name ?? "Budi");
      try {
        const r = await generateReply([{ role: "system", content: system }, ...messages], { onlyModelPk: model_pk ? Number(model_pk) : undefined });
        return r;
      } catch (e: any) {
        return reply.code(502).send({ error: e.message, attempts: e.attempts ?? [] });
      }
    });

    // ---------- logs ----------
    r.get("/api/logs", async (req) => {
      const { status } = (req.query ?? {}) as any;
      return sql`SELECT * FROM ai_logs WHERE (${status ?? null}::text IS NULL OR success = ${status === "ok"})
                 ORDER BY id DESC LIMIT 300`;
    });

    // ---------- kirimdev ----------
    r.get("/api/kirim/status", async () => {
      const out: any = {
        configured: !!(config.kirim.apiKey && config.kirim.phoneId),
        phone_id: config.kirim.phoneId,
        public_url: config.publicUrl,
        webhook_url: config.publicUrl ? `${config.publicUrl.replace(/\/+$/, "")}/webhook/kirim` : null,
      };
      try {
        out.me = await kirimApi.me();
        out.accounts = await kirimApi.accounts();
        out.webhooks = await kirimApi.listWebhooks();
      } catch (e: any) {
        out.error = e.message;
      }
      return out;
    });

    r.post("/api/kirim/webhook", async (req, reply) => {
      const { url } = (req.body ?? {}) as any;
      if (!url) return reply.code(400).send({ error: "url wajib" });
      try {
        const res: any = await kirimApi.createWebhook(String(url));
        const secret = res?.data?.initial_secret;
        if (secret) {
          const s = await getSettings();
          await updateSettings({ webhook_secrets: [...new Set([...(s.webhook_secrets ?? []), secret])] });
        }
        return { ok: true, subscription: { ...res?.data, initial_secret: undefined }, secret_saved: !!secret };
      } catch (e: any) {
        return reply.code(502).send({ error: e.message, detail: e.body });
      }
    });
  });
}
