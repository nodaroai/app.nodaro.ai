import { Queue } from "bullmq"
import { redis } from "./queue.js"

export const renderQueue = new Queue("video-render", {
  connection: redis,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
})
