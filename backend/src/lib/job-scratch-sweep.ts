import { isStorageConfigured, listObjectsByPrefixWithMeta } from "./storage.js"
import { deleteKeysRecordingFailures } from "./storage-delete.js"
import { isScratchJobId, JOB_SCRATCH_ROOT } from "./job-scratch-keys.js"

/**
 * The backstop for temporary provider uploads (decided 2026-10-09, round 3 of
 * the expiry walk): every file under the scratch root older than 7 days is
 * deleted, once a day.
 *
 * A job's end empties its scratch folder (`discardJobScratch`, `job-scratch.ts`).
 * Three exits never reach that: a worker that dies before its `finally` with no
 * re-pick after it, a job the reconcile cron ends outside the worker, and a
 * post-processing self-heal that leaves the row for reconcile. The sweep also
 * reaches the flat keys directly under the root: the ones written before
 * scratch folders existed (`<name>-<timestamp>.<ext>`: KIE's lip-sync and
 * motion trims and format-converted frames) and the ones a writer still uses
 * outside a job. The other temporary copies made before scratch folders
 * (Seedance's extend tail and frame, HeyGen's capped audio, KIE's resized
 * mask) were written under other prefixes, and this sweep does not see them.
 *
 * Nothing reads a scratch file after its job is over, so the sweep goes by
 * each file's AGE alone (`LastModified`), owner-agnostic and with no database
 * read: 7 days is far past any job's retries. A file whose age storage does
 * not report stays.
 *
 * Every edition runs it: where no provider work has staged a copy the root
 * never exists, and a run is one empty listing. Batched (the funnel deletes
 * 1000 keys per call), idempotent (a key already gone is not an error, and a
 * second replica's run asks for the same deletes), and best-effort: a listing
 * failure is counted and reported, never thrown. The delete goes through the
 * storage-delete funnel, so each file storage did not delete is recorded for
 * the daily retry pass, with its job (the folder it sits in) as provenance —
 * and is listed again by the next sweep anyway.
 */
export const JOB_SCRATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface JobScratchSweepResult {
  readonly listed: number
  readonly deleted: number
  readonly failed: number
  /** Listed keys outside the scratch root, never deleted. */
  readonly skipped: number
}

/** The job whose scratch folder holds `key`; null for a flat key. */
function jobIdOfScratchKey(key: string): string | null {
  if (!key.startsWith(JOB_SCRATCH_ROOT)) return null
  const rest = key.slice(JOB_SCRATCH_ROOT.length)
  const slash = rest.indexOf("/")
  if (slash < 0) return null
  const folder = rest.slice(0, slash)
  return isScratchJobId(folder) ? folder : null
}

export async function sweepJobScratch(nowMs: number = Date.now()): Promise<JobScratchSweepResult> {
  let objects
  try {
    objects = await listObjectsByPrefixWithMeta(JOB_SCRATCH_ROOT)
  } catch {
    return { listed: 0, deleted: 0, failed: 1, skipped: 0 }
  }

  const cutoffMs = nowMs - JOB_SCRATCH_MAX_AGE_MS
  const toDelete: string[] = []
  let skipped = 0
  for (const o of objects) {
    // Listed BY the root, re-asserted anyway: this is the last check before a delete.
    if (!o.key.startsWith(JOB_SCRATCH_ROOT)) {
      skipped++
      continue
    }
    // No LastModified: its age cannot be proven, so it stays.
    if (o.lastModified && o.lastModified.getTime() < cutoffMs) toDelete.push(o.key)
  }

  if (toDelete.length === 0) return { listed: objects.length, deleted: 0, failed: 0, skipped }

  try {
    const { deleted, failed } = await deleteKeysRecordingFailures(toDelete, "job-scratch", { jobIdOf: jobIdOfScratchKey })
    return { listed: objects.length, deleted, failed: failed.length, skipped }
  } catch {
    return { listed: objects.length, deleted: 0, failed: toDelete.length, skipped }
  }
}

/** Sweep on boot, then once a day. Returns the stop function the server's
 *  `onClose` awaits. A no-op without object storage. */
export function startJobScratchSweep(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await sweepJobScratch()
      if (result.failed > 0) {
        report(`Temporary provider upload cleanup: ${result.failed} failed; they will be retried on the next run`)
      }
    })().finally(() => { pending = undefined })
  }
  const timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
