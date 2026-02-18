import { Queue } from "bullmq"
import { redis } from "./queue.js"

export const renderQueue = new Queue("video-render", {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
})
