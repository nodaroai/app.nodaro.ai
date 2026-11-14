import { Job, Queue, type ConnectionOptions } from "bullmq"
import { redis } from "./queue-connection.js"

/** The process's BullMQ connection (created in queue-connection.ts, a leaf the concurrency gate shares). */
export { redis }

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

/** The queues a `jobs` row's BullMQ entry can live on, by lane queue name (imported lazily, so a process that never cancels does not create those queues). */
async function jobsQueueNamed(name: string): Promise<Queue | null> {
  switch (name) {
    case "video-generation":
      return videoQueue
    case "video-render":
      return (await import("./render-queue.js")).renderQueue
    case "video-director":
      return (await import("./video-director-queue.js")).videoDirectorQueue
    default:
      return null
  }
}

/**
 * Remove the job's entry by the BullMQ id it was stamped with
 * (`jobs.lane_bull_job_id`, written at pickup and at park). "removed": done;
 * "running": the entry is active and the row has started — nothing removes
 * it, the worker discards the cancelled row; "unknown": no stamp, the entry is
 * gone, it carries another job, or it is active while the row still waits —
 * the caller scans.
 */
async function removeByStoredEntry(jobId: string): Promise<"removed" | "running" | "unknown"> {
  const { readBullEntry } = await import("./concurrency-lanes/columns.js")
  const stored = await readBullEntry(jobId)
  if (!stored) return "unknown"
  const queue = await jobsQueueNamed(stored.queue)
  if (!queue) return "unknown"
  const entry = await Job.fromId(queue, stored.bullJobId)
  if (!entry || (entry.data as { jobId?: string } | undefined)?.jobId !== jobId) return "unknown"
  const state = await entry.getState()
  if (state === "active") {
    // An active entry for a row that is still waiting (pending/queued) is a
    // pickup in progress, not the job running: another entry of the same job
    // may still sit in the queue, so the caller scans (which never touches an
    // active entry). A row that started is being run by this entry.
    return stored.status === "pending" || stored.status === "queued" ? "unknown" : "running"
  }
  if (!(REMOVABLE_STATES as readonly string[]).includes(state)) return "unknown"
  await entry.remove()
  return "removed"
}

/**
 * Best-effort removal of a cancelled job from the BullMQ queues — the shared
 * removal funnel every cancel path calls.
 *
 * First the job leaves its concurrency lane (`withdrawFromLane`: a waiting
 * job must not stay at the head of its line; idempotent, bounded, never
 * throws). Then its entry is removed by the BullMQ id it was stamped with
 * (a parked job sits on the delayed set, possibly beyond any scan's reach).
 *
 * The scan below is the fallback, for a job with no stamp (never picked up,
 * or a database without the lane columns): BullMQ entries get auto-generated
 * ids (the `add()` call sites pass no custom `jobId` option — deliberately,
 * since reusing a DB uuid as the Bull id would dedupe against the
 * removeOnComplete window — except the jobs of a batch (`runJobBatch`:
 * generate-image, generate-character, -creature, -location, -object and
 * video-sfx), whose `<job name>-<db uuid>` id (`batchQueueId`) makes a retry's
 * re-queue a no-op), so
 * `getJob(<db uuid>)` can never match. We instead scan the not-yet-picked
 * states for an entry whose `data.jobId` is the DB job id. Active jobs cannot
 * be stopped mid-execution; the workers discard them via the pickup status
 * CAS and throwIfJobCancelled.
 *
 * Scans BOTH queues: render-video jobs live in the separate "video-render"
 * queue (audit R1 — scanning only the video queue meant cancelled queued
 * renders were never removed AND, before the render-worker pickup CAS, were
 * resurrected and rendered anyway). The render queue is imported lazily,
 * only when a scan reaches it.
 */
export async function tryRemoveFromQueue(jobId: string, runScan: ScanRunner = (scan) => scan()): Promise<void> {
  try {
    const { withdrawFromLane } = await import("./concurrency-lanes/withdraw.js")
    await withdrawFromLane(jobId)
  } catch {
    // withdrawFromLane never throws; only its import could.
  }
  const findAndRemove = async (queue: Queue): Promise<boolean> => {
    const queued = await queue.getJobs([...REMOVABLE_STATES], 0, REMOVE_SCAN_LIMIT)
    const match = queued.find(
      (j) => (j?.data as { jobId?: string } | undefined)?.jobId === jobId,
    )
    if (match) {
      await match.remove()
      return true
    }
    return false
  }
  try {
    if ((await removeByStoredEntry(jobId).catch(() => "unknown" as const)) !== "unknown") return
    await runScan(async () => {
      if (await findAndRemove(videoQueue)) return
      const { renderQueue } = await import("./render-queue.js")
      await findAndRemove(renderQueue)
    })
  } catch {
    // Best-effort — job may already be gone or active
  }
}

/** Runs a removal's fallback scan (see tryRemoveFromQueue). */
export type ScanRunner = (scan: () => Promise<void>) => Promise<void>

/**
 * A runner that runs the scans given to it one at a time, each after the one
 * before it ended (whether it threw or not). Cancel-all hands one runner to
 * all its removals: they remove by stored id side by side, and their scans —
 * each reads up to REMOVE_SCAN_LIMIT entries in three states on two queues —
 * run one after another. Every other caller scans at once, as before.
 */
export function oneScanAtATime(): ScanRunner {
  let tail: Promise<void> = Promise.resolve()
  return (scan) => {
    const run = tail.then(scan, scan)
    tail = run.catch(() => undefined)
    return run
  }
}

