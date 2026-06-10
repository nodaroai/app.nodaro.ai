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

/** Queue states a not-yet-picked job can sit in. Our queue uses priorities
 *  (defaultJobOptions.priority + orchestrator overrides), so queued jobs
 *  usually live in "prioritized", NOT "waiting" — scanning waiting alone
 *  misses them. */
const REMOVABLE_STATES = ["prioritized", "waiting", "delayed"] as const

/** Per-state scan cap. Removal is a best-effort UX nicety (the worker's
 *  pickup CAS is the correctness guard — see video-worker.ts), so a deep
 *  backlog beyond the cap is acceptable to miss. */
const REMOVE_SCAN_LIMIT = 500

/**
 * Best-effort removal of a cancelled job from the BullMQ video queue.
 *
 * BullMQ entries get auto-generated ids (no `add()` call site passes a
 * custom `jobId` option — deliberately, since reusing a DB uuid as the Bull
 * id would dedupe against the removeOnComplete window), so `getJob(<db uuid>)`
 * can never match. We instead scan the not-yet-picked states for an entry
 * whose `data.jobId` is the DB job id. Active jobs cannot be stopped
 * mid-execution; the worker discards them via the pickup status CAS and
 * throwIfJobCancelled.
 */
export async function tryRemoveFromQueue(jobId: string): Promise<void> {
  try {
    const queued = await videoQueue.getJobs([...REMOVABLE_STATES], 0, REMOVE_SCAN_LIMIT)
    const match = queued.find(
      (j) => (j?.data as { jobId?: string } | undefined)?.jobId === jobId,
    )
    if (match) {
      await match.remove()
    }
  } catch {
    // Best-effort — job may already be gone or active
  }
}
