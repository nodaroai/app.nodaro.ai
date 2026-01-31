// Video generation worker - processes jobs from BullMQ
// Stub: will be implemented in Phase 1.3

import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"

export function createVideoWorker() {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

  return new Worker(
    "video-generation",
    async (job) => {
      console.log(`Processing job ${job.id}: ${job.name}`)
      // TODO: implement workflow execution
    },
    { connection },
  )
}
