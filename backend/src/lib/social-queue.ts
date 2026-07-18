import { Queue, type ConnectionOptions } from "bullmq"
import { redis } from "./queue.js"

/**
 * Scheduled social publishes. Payload is just `{ scheduledPostId }` — the
 * worker loads the row fresh (edits/cancellations between enqueue and pickup
 * are honored). Generic (pre-provider-call) failures retry with backoff; the
 * worker converts definitive outcomes to UnrecoverableError so BullMQ never
 * blind-retries a publish whose provider call already started.
 */
export const socialPublishQueue = new Queue("social-publish", {
  connection: redis as unknown as ConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
})

export interface SocialPublishJobData {
  scheduledPostId: string
}
