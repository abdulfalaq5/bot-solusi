import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { queue } from "../queue.js";
import { verifySignature } from "../services/kirim.js";
import { getSettings } from "../services/settings.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.get("/webhook/kirim", async () => ({ ok: true, hint: "Kirimdev webhook endpoint, gunakan POST" }));

  app.post("/webhook/kirim", async (req, reply) => {
    // kanal Kirimdev dimatikan: balas 200 agar Kirimdev tidak terus retry, tapi abaikan isinya
    if (!config.kirim.enabled) return { received: true, ignored: "KIRIM_ENABLED=false" };
    const raw: Buffer = (req as any).rawBody ?? Buffer.from("");
    const s = await getSettings();
    const secrets = [...config.kirim.webhookSecrets, ...(s.webhook_secrets ?? [])].filter(Boolean);

    if (secrets.length) {
      const ok = verifySignature(req.headers["x-kirim-signature"] as string | undefined, raw, secrets, config.kirim.webhookTolerance);
      if (!ok) {
        req.log.warn("webhook signature tidak valid");
        return reply.code(401).send({ error: "invalid signature" });
      }
    } else {
      req.log.warn("KIRIM_WEBHOOK_SECRET kosong: signature webhook TIDAK diverifikasi");
    }

    const event = String(req.headers["x-kirim-event"] ?? "");
    // delivery-id sama untuk retry pengiriman yang sama; event-id bisa sama untuk beberapa status (sent/delivered/read)
    const deliveryId = String(req.headers["x-kirim-delivery-id"] ?? "");
    // balas 200 secepatnya, proses di worker (Kirimdev retry jika lambat/gagal)
    await queue.add(
      "inbound",
      { event, payload: req.body },
      {
        ...(deliveryId ? { jobId: `in-${deliveryId}`.replace(/[^a-zA-Z0-9._-]/g, "_") } : {}),
        // beri waktu kiriman bot sendiri tersimpan dulu, supaya tidak dikira balasan agen
        ...(event === "message.sent" ? { delay: 5000 } : {}),
      },
    );
    return { received: true };
  });

  // event dari service wa-baileys (jaringan internal docker, tidak di-proxy nginx ke publik)
  app.post("/internal/baileys/event", async (req, reply) => {
    const got = Buffer.from(String(req.headers["x-internal-secret"] ?? ""));
    const exp = Buffer.from(config.baileys.secret);
    if (!exp.length || got.length !== exp.length || !timingSafeEqual(got, exp)) return reply.code(401).send({ error: "unauthorized" });
    if (!config.baileys.enabled) return { received: true, ignored: "BAILEYS_ENABLED=false" };
    const body = req.body as any;
    await queue.add("baileys", body, {
      // balasan manual dari HP: beri waktu kiriman bot tersimpan dulu agar tidak dikira balasan admin
      ...(body?.type === "agent_message" ? { delay: 5000 } : {}),
      ...(body?.message?.id && body?.type === "message" ? { jobId: `bl-${String(body.message.id).replace(/[^a-zA-Z0-9._-]/g, "_")}` } : {}),
    });
    return { received: true };
  });
}
