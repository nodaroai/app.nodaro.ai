import { Queue, type ConnectionOptions } from "bullmq"
import { redis } from "./queue.js"

export const renderQueue = new Queue("video-render", {
  connection: redis as unknown as ConnectionOptions,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
    priority: 1, // interactive single-node jobs get high priority over orchestrator batch jobs
  },
})
