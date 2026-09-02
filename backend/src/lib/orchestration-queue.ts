import { Queue } from "bullmq"
import IORedis from "ioredis"
import { config } from "./config.js"

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})

/** Retry budget + default job options live in the Redis-free leaf
 *  `orchestration-queue-config.ts` (M-10a) so a caller that needs only the
 *  values never opens this module's connection. Re-exported here so the
 *  existing import path keeps working. */
export { ORCHESTRATION_JOB_ATTEMPTS, ORCHESTRATION_JOB_OPTIONS } from "./orchestration-queue-config.js"
import { ORCHESTRATION_JOB_OPTIONS } from "./orchestration-queue-config.js"

export const orchestrationQueue = new Queue("workflow-orchestration", {
  connection,
  defaultJobOptions: { ...ORCHESTRATION_JOB_OPTIONS },
})
