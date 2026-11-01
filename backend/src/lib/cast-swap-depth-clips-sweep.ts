import { supabase } from "./supabase.js"
import { isStorageConfigured, listObjectsByPrefixWithMeta } from "./storage.js"
import { deleteKeysRecordingFailures } from "./storage-delete.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/**
 * The retention of Nodaro Motion's durable coloured depth maps (cast-swap
 * 0.426.0): `cast-swap/depth-clips/<jobId>-<attempt>-<nonce>.mp4`.
 *
 * The Cast Swap engine (the private cloud plugins package) colours a Full
 * depth's gray depth render with the admin's colormap and keeps the result at
 * a durable key only when it must outlive the job's scratch: a Kling (Pulse)
 * run's sent clip, which its Full Quality sends again, and a stored clip's
 * make with no face mesh (`cast-swap-face-mask`), which IS the trend's
 * stored clip. Nothing deleted them; each one is counted in its user's
 * storage for good.
 *
 * The one reader of a RUN's map after the run is its Full Quality, offered
 * for `CAST_SWAP_FULL_QUALITY_WINDOW_MS` (7 days) after the run completed
 * (the platform's `fullQualityUntil`, the engine's own check). So a run's map
 * is deleted once BOTH its object and its job are past that window plus
 * `DEPTH_CLIP_MARGIN_MS` (2 days: a Full Quality started on the window's last
 * minute is long done), and only when its job (the id the key starts with)
 * is a Cast Swap run or Full Quality version (`cast-swap`,
 * `cast-swap-full-quality`) that has finished (completed, failed or
 * cancelled).
 *
 * A make's map (`cast-swap-face-mask`) is read only until the admin approves
 * it: approval copies the clip into the trend's own storage
 * (`copyToTrendStorage`, admin-trends-face-mask.ts), and the trend's runs read
 * that copy. So a finished make's map goes once both it and its job are
 * `DEPTH_CLIP_MAKE_RETENTION_MS` (30 days, the engine's own cache retention)
 * old: a month to review it. A make approved later than that is refused with
 * the copy's own "could not fetch" (nothing dead is saved); it is made again.
 * Everything else stays:
 *
 * - a key whose job row is gone or of any other type, or that names no job:
 *   who reads it cannot be proven;
 * - a run still going, or one whose job row cannot be read (a failed read
 *   deletes nothing);
 * - an object whose age storage does not report.
 *
 * Each deleted map's bytes are given back to its owner's storage (the
 * engine's upload counted them, `uploadFileWithKeyToR2`'s tracking). Once a
 * day and on boot, batched, idempotent, best effort (a failure is counted and
 * reported, never thrown), through the storage-delete funnel (a key storage
 * did not delete is recorded for the daily retry pass, with its job). Every
 * edition runs it: where the engine never wrote one the prefix is empty and a
 * run is one listing.
 *
 * SYNC NOTE: keep the prefix equal to the plugin's `colouredDepthKey`
 * (`cast-swap/depth-clips/`, mask.ts).
 */
export const CAST_SWAP_DEPTH_CLIPS_PREFIX = "cast-swap/depth-clips/"

/** How long after a run completed its Full Quality may be started (the platform's `fullQualityUntil`; the engine's `FULL_QUALITY_WINDOW_MS`). */
export const CAST_SWAP_FULL_QUALITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Past the window, before a map goes: time for a Full Quality started at the window's end to finish. */
export const DEPTH_CLIP_MARGIN_MS = 2 * 24 * 60 * 60 * 1000

/** The age (object and job) after which a finished run's map is deleted. */
export const DEPTH_CLIP_RETENTION_MS = CAST_SWAP_FULL_QUALITY_WINDOW_MS + DEPTH_CLIP_MARGIN_MS

/** The age (object and job) after which a finished make's map is deleted: a month to review and approve it. */
export const DEPTH_CLIP_MAKE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** The job types whose maps are a run's (deleted past the retention). */
const RUN_JOB_TYPES: ReadonlySet<string> = new Set(["cast-swap", "cast-swap-full-quality"])

/** A stored clip's make: its map is copied into the trend's storage on approval (deleted past the make retention). */
const MAKE_JOB_TYPE = "cast-swap-face-mask"

const FINISHED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Job ids read per query. */
const LOOKUP_BATCH = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export interface DepthClipsSweepResult {
  readonly listed: number
  readonly deleted: number
  readonly failed: number
  /** Past the run age but kept: a make's not yet past its own, an unknown or unfinished job's, or a key that names no job. */
  readonly kept: number
  /** Listed keys outside the prefix, never deleted. */
  readonly skipped: number
}

/** The job a map's key names (`<jobId>-<attempt>-<nonce>.mp4`), or null. */
export function jobIdOfDepthClipKey(key: string): string | null {
  if (!key.startsWith(CAST_SWAP_DEPTH_CLIPS_PREFIX)) return null
  const rest = key.slice(CAST_SWAP_DEPTH_CLIPS_PREFIX.length)
  if (rest.includes("/")) return null
  const m = UUID_RE.exec(rest)
  return m && rest.charAt(m[0].length) === "-" ? m[0].toLowerCase() : null
}

interface JobRow {
  id: string
  user_id: string | null
  status: string | null
  completed_at: string | null
  job_type: string | null
  kind: string | null
}

/** The cutoff a job's map goes before: a finished run's or Full Quality's, a finished make's; null = it stays. */
function cutoffFor(row: JobRow, nowMs: number): number | null {
  if (!row.status || !FINISHED.has(row.status)) return null
  const type = row.job_type ?? row.kind
  if (type === MAKE_JOB_TYPE || row.kind === MAKE_JOB_TYPE) return nowMs - DEPTH_CLIP_MAKE_RETENTION_MS
  return type !== null && RUN_JOB_TYPES.has(type) ? nowMs - DEPTH_CLIP_RETENTION_MS : null
}

/** Whether a map written at `writtenMs` by `row`'s job may go now: its job finished and both are past its cutoff. */
function mapDeletable(row: JobRow, writtenMs: number, nowMs: number): boolean {
  const cutoff = cutoffFor(row, nowMs)
  if (cutoff === null || writtenMs >= cutoff) return false
  if (row.completed_at === null) return true
  const completed = Date.parse(row.completed_at)
  return Number.isFinite(completed) && completed < cutoff
}

async function readJobs(ids: readonly string[]): Promise<Map<string, JobRow> | null> {
  const out = new Map<string, JobRow>()
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    // trash-read: a sweep of the engine's own storage: a trashed run's map goes as any finished run's (it is never shown).
    const { data, error } = await supabase
      // tenant-scope-ignore: a platform sweep of the engine's own storage, by the job ids its keys name; no user scope.
      .from("jobs")
      .select("id, user_id, status, completed_at, job_type, kind:input_data->>type")
      .in("id", ids.slice(i, i + LOOKUP_BATCH))
    if (error) return null
    for (const row of (data ?? []) as Array<Partial<JobRow>>) {
      if (typeof row.id !== "string") continue
      out.set(row.id.toLowerCase(), {
        id: row.id,
        user_id: typeof row.user_id === "string" ? row.user_id : null,
        status: typeof row.status === "string" ? row.status : null,
        completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
        job_type: typeof row.job_type === "string" ? row.job_type : null,
        kind: typeof row.kind === "string" ? row.kind : null,
      })
    }
  }
  return out
}

export async function sweepCastSwapDepthClips(nowMs: number = Date.now()): Promise<DepthClipsSweepResult> {
  let objects
  try {
    objects = await listObjectsByPrefixWithMeta(CAST_SWAP_DEPTH_CLIPS_PREFIX)
  } catch {
    return { listed: 0, deleted: 0, failed: 1, kept: 0, skipped: 0 }
  }

  const cutoffMs = nowMs - DEPTH_CLIP_RETENTION_MS
  let skipped = 0
  let kept = 0
  /** Past the shortest age, by the job its key names. */
  const due = new Map<string, Array<{ key: string; size: number; writtenMs: number }>>()
  for (const o of objects) {
    // Listed BY the prefix, re-asserted anyway: this is the last check before a delete.
    if (!o.key.startsWith(CAST_SWAP_DEPTH_CLIPS_PREFIX)) {
      skipped++
      continue
    }
    // No LastModified: its age cannot be proven, so it stays.
    if (!o.lastModified || o.lastModified.getTime() >= cutoffMs) continue
    const jobId = jobIdOfDepthClipKey(o.key)
    if (!jobId) {
      kept++
      continue
    }
    const list = due.get(jobId) ?? []
    list.push({ key: o.key, size: o.size ?? 0, writtenMs: o.lastModified.getTime() })
    due.set(jobId, list)
  }
  if (due.size === 0) return { listed: objects.length, deleted: 0, failed: 0, kept, skipped }

  const jobs = await readJobs([...due.keys()])
  if (!jobs) return { listed: objects.length, deleted: 0, failed: 1, kept, skipped }

  const toDelete: string[] = []
  const owner = new Map<string, { userId: string | null; size: number; jobId: string }>()
  for (const [jobId, maps] of due) {
    const row = jobs.get(jobId)
    for (const m of maps) {
      if (!row || !mapDeletable(row, m.writtenMs, nowMs)) {
        kept++
        continue
      }
      toDelete.push(m.key)
      owner.set(m.key, { userId: row.user_id, size: m.size, jobId: row.id })
    }
  }
  if (toDelete.length === 0) return { listed: objects.length, deleted: 0, failed: 0, kept, skipped }

  let result
  try {
    result = await deleteKeysRecordingFailures(toDelete, "cast-swap-depth-clip", { jobIdOf: (key) => owner.get(key)?.jobId ?? null })
  } catch {
    return { listed: objects.length, deleted: 0, failed: toDelete.length, kept, skipped }
  }
  // Give each deleted map's bytes back to its owner (the engine's upload counted them).
  const notDeleted = new Set(result.notDeleted ?? [])
  const freed = new Map<string, number>()
  for (const key of toDelete) {
    if (notDeleted.has(key)) continue
    const o = owner.get(key)
    if (o?.userId && o.size > 0) freed.set(o.userId, (freed.get(o.userId) ?? 0) + o.size)
  }
  for (const [userId, bytes] of freed) await updateStorageUsage(userId, -bytes).catch(() => {})
  return { listed: objects.length, deleted: toDelete.length - notDeleted.size, failed: result.failed.length, kept, skipped }
}

/** Sweep on boot, then once a day. Returns the stop function the server's `onClose` awaits. A no-op without object storage. */
export function startCastSwapDepthClipsSweep(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await sweepCastSwapDepthClips()
      if (result.failed > 0) {
        report(`Nodaro Motion depth map cleanup: ${result.failed} failed; they will be retried on the next run`)
      }
    })().finally(() => {
      pending = undefined
    })
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
