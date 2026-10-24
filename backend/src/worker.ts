import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { migrate, sql } from "./db.js";
import { seed } from "./seed.js";
import { QUEUE_NAME, InboundJob, ReplyJob } from "./queue.js";
import { handleInbound, processReply } from "./services/conversation.js";

await migrate();
await seed();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === "inbound") {
      const { event, payload } = job.data as InboundJob;
      if (event === "message.received" || event === "message.status" || payload?.object === "whatsapp_business_account") {
        await handleInbound(payload);
      }
      return { ok: true };
    }
    if (job.name === "reply") {
      const { conversationId, messageId } = job.data as ReplyJob;
      return processReply(conversationId, messageId);
    }
  },
  { connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }), concurrency: config.workerConcurrency },
);

worker.on("failed", (job, err) => console.error(`[worker] job ${job?.name}#${job?.id} gagal:`, err.message));
console.log(`[worker] berjalan, concurrency=${config.workerConcurrency}`);

const shutdown = async () => {
  await worker.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
