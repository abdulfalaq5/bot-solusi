function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL", "redis://redis:6379"),
  jwtSecret: required("JWT_SECRET"),
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123",
  kirim: {
    // saklar kanal Kirimdev (WhatsApp Business API resmi)
    enabled: process.env.KIRIM_ENABLED !== "false",
    baseUrl: process.env.KIRIM_BASE_URL ?? "https://api.kirimdev.com/v1",
    apiKey: process.env.KIRIM_API_KEY ?? "",
    phoneId: process.env.KIRIM_PHONE_ID ?? "",
    // comma separated, supports secret rotation
    webhookSecrets: (process.env.KIRIM_WEBHOOK_SECRET ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webhookTolerance: Number(process.env.KIRIM_WEBHOOK_TOLERANCE ?? 300),
  },
  // kanal WhatsApp tidak resmi (nomor pribadi via WhatsApp Web) — service wa-baileys
  baileys: {
    enabled: process.env.BAILEYS_ENABLED === "true",
    url: process.env.BAILEYS_URL ?? "http://wa-baileys:3100",
    secret: process.env.BAILEYS_INTERNAL_SECRET ?? "",
  },
  publicUrl: process.env.PUBLIC_URL ?? "",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
};
