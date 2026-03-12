import { Queue, type ConnectionOptions } from "bullmq"
import IORedis from "ioredis"
import { config } from "./config.js"

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const videoQueue = new Queue("video-generation", {
  connection: redis as unknown as ConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    priority: 1, // interactive single-node jobs get high priority over orchestrator batch jobs
  },
})
