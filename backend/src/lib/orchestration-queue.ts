import { Queue } from "bullmq"
import IORedis from "ioredis"
import { config } from "./config.js"

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})

export const orchestrationQueue = new Queue("workflow-orchestration", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
})
