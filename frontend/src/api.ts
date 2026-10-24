const TOKEN_KEY = "bot_admin_token";

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    auth.clear();
    location.href = "/login";
  }
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { data });
  return data as T;
}

export type Provider = {
  id: number;
  code: string;
  name: string;
  base_url: string;
  api_key: string | null;
  api_key_env: string | null;
  requires_key: boolean;
  tier: "free" | "freemium" | "paid";
  enabled: boolean;
  extra_headers: Record<string, string>;
  website: string | null;
  notes: string | null;
  has_key: boolean;
  key_source: string | null;
  model_count: number;
};

export type Model = {
  id: number;
  provider_id: number;
  provider_name: string;
  provider_code: string;
  provider_enabled: boolean;
  model_id: string;
  label: string | null;
  tier: "free" | "paid";
  enabled: boolean;
  priority: number;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
};

export type Prompt = { id: number; name: string; kind: "assistant" | "cs" | "custom"; content: string; is_default: boolean; updated_at: string };

export type Conversation = {
  id: number;
  wa_id: string;
  contact_name: string | null;
  mode: "ai" | "human";
  human_until: string | null;
  prompt_id: number | null;
  prompt_name: string | null;
  unread: number;
  needs_attention: boolean;
  last_message_at: string;
  last_inbound_at: string | null;
  last_preview: string | null;
};

export type Message = {
  id: number;
  direction: "in" | "out";
  sender: "customer" | "ai" | "admin" | "system";
  type: string;
  body: string | null;
  media_url: string | null;
  status: string | null;
  error: string | null;
  model_used: string | null;
  created_at: string;
};

export const fmtTime = (s: string) =>
  new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
