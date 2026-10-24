import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { queue } from "../queue.js";
import { verifySignature } from "../services/kirim.js";
import { getSettings } from "../services/settings.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.get("/webhook/kirim", async () => ({ ok: true, hint: "Kirimdev webhook endpoint, gunakan POST" }));

  app.post("/webhook/kirim", async (req, reply) => {
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
      deliveryId ? { jobId: `in-${deliveryId}`.replace(/[^a-zA-Z0-9._-]/g, "_") } : {},
    );
    return { received: true };
  });
}
