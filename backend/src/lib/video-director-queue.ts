import { Queue, type ConnectionOptions } from "bullmq"
import { redis } from "./queue.js"

/**
 * BullMQ queue for the video-director chain
 * (author → speech → forced-alignment → bake → render).
 *
 * Mirrors render-queue.ts. One job per director run; attempts=1 because
 * retrying from scratch after a ~3-min pipeline is very expensive and the
 * root cause is almost always a transient TTS/alignment/render failure that
 * warrants a fresh user request rather than a blind retry.
 */
export const videoDirectorQueue = new Queue("video-director", {
  connection: redis as unknown as ConnectionOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})
