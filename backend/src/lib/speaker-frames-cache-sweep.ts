import { batchDeleteFromR2, isStorageConfigured, listObjectsByPrefixWithMeta } from "./storage.js"

/**
 * Speaker Frames' per-window detection checkpoints (decided 2026-10-08): objects
 * under `speaker-frames-cache/` older than 7 days are deleted.
 *
 * The writer is the private cloud plugins package: `speaker-frames-cache/<fp>.json`,
 * where `<fp>` is a hash of the job id, the proxy and the detector — so a key
 * names no job and no owner, and nothing in the database points at one. The
 * plugin deletes a job's checkpoints on every exit it sees as terminal and
 * keeps them only for a retry; an attempt the worker never returns from (a
 * crash, a stall sweep) leaves them behind. Nothing reads one after its job is
 * over, so the sweep goes by AGE alone and is owner-agnostic: 7 days is far past
 * any job's retries.
 *
 * SYNC NOTE: keep the prefix equal to the plugin's `SPEAKER_FRAMES_CHECKPOINT_PREFIX`
 * (which has no trailing slash), or the checkpoints it leaves are never reaped.
 *
 * Every edition runs it: on community, and anywhere the plugin is not loaded,
 * the prefix never exists and a run is one empty listing. Batched (one
 * `DeleteObjects` per 1000 keys), idempotent (deleting a key already gone is
 * not an error, and a second replica's run asks for the same deletes), and
 * best-effort: a listing or delete failure is counted and reported, never
 * thrown.
 */
export const SPEAKER_FRAMES_CACHE_PREFIX = "speaker-frames-cache/"

export const SPEAKER_FRAMES_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface SpeakerFramesCacheSweepResult {
  readonly listed: number
  readonly deleted: number
  readonly failed: number
  /** Listed keys outside the prefix, never deleted. */
  readonly skipped: number
}

export async function sweepSpeakerFramesCache(nowMs: number = Date.now()): Promise<SpeakerFramesCacheSweepResult> {
  let objects
  try {
    objects = await listObjectsByPrefixWithMeta(SPEAKER_FRAMES_CACHE_PREFIX)
  } catch {
    return { listed: 0, deleted: 0, failed: 1, skipped: 0 }
  }

  const cutoffMs = nowMs - SPEAKER_FRAMES_CACHE_MAX_AGE_MS
  const toDelete: string[] = []
  let skipped = 0
  for (const o of objects) {
    // Listed BY the prefix, re-asserted anyway: this is the last check before a delete.
    if (!o.key.startsWith(SPEAKER_FRAMES_CACHE_PREFIX)) {
      skipped++
      continue
    }
    // No LastModified: its age cannot be proven, so it stays.
    if (o.lastModified && o.lastModified.getTime() < cutoffMs) toDelete.push(o.key)
  }

  if (toDelete.length === 0) return { listed: objects.length, deleted: 0, failed: 0, skipped }

  try {
    const { deleted, errors } = await batchDeleteFromR2(toDelete)
    return { listed: objects.length, deleted, failed: errors, skipped }
  } catch {
    return { listed: objects.length, deleted: 0, failed: toDelete.length, skipped }
  }
}

/** Sweep on boot, then once a day. Returns the stop function the server's
 *  `onClose` awaits. A no-op without object storage. */
export function startSpeakerFramesCacheSweep(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await sweepSpeakerFramesCache()
      if (result.failed > 0) {
        report(`Speaker Frames checkpoint cleanup: ${result.failed} failed; they will be retried on the next run`)
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
