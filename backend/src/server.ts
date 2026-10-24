import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { migrate, sql } from "./db.js";
import { seed } from "./seed.js";
import { webhookRoutes } from "./routes/webhook.js";
import { adminRoutes } from "./routes/admin.js";

await migrate();
await seed();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });

// simpan raw body (dibutuhkan untuk verifikasi HMAC webhook)
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  (req as any).rawBody = body;
  if (!body.length) return done(null, {});
  try {
    done(null, JSON.parse(body.toString("utf8")));
  } catch (e: any) {
    e.statusCode = 400;
    done(e, undefined);
  }
});

await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret });

app.get("/health", async () => {
  await sql`SELECT 1`;
  return { ok: true };
});

await app.register(webhookRoutes);
await app.register(adminRoutes);

const shutdown = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
