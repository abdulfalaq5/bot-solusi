import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

export const QUEUE_NAME = "wa-bot";

export const queue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export type InboundJob = { event: string; payload: any };
export type ReplyJob = { conversationId: number; messageId: number };
