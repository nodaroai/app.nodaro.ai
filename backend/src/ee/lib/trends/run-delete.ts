/**
 * Deleting an admin's trend test run, with its media (decided 2026-10-25).
 *
 * A test run is a Cast Swap `jobs` row, plus the child jobs its handler ran for
 * it (`parent_job_id`: the reference preparation, the edit), which the job
 * delete cascades to. Deleting only the rows — what `DELETE /v1/jobs/:id` does
 * — would leave the run's files behind: its library rows (`assets.job_id` is
 * ON DELETE SET NULL) and the objects in storage. So, in this order:
 *
 *   1. Refuse a run with anything still in flight (`IN_FLIGHT_JOB_STATUSES`):
 *      its handler would write into rows and keys that no longer exist.
 *   2. Every library row the run's jobs made goes through the library's own
 *      permanent delete (`permanentlyDeleteAsset`): an object is removed only
 *      when the platform proves it the run owner's and nothing else uses it,
 *      and its size is refunded. BEFORE the job delete — that proof reads the
 *      job that made the key.
 *   3. The run's job row goes, its children with it, through the same RPC the
 *      job delete uses (Recast private audio included).
 *   4. The run's own remaining files — the keys in each job's own key family
 *      (`ownedJobOutputKeys`: posters, intermediates no library row names) —
 *      are deleted unless a library row still names one or the relay rule
 *      keeps it (`deletableKeys`). Best-effort, after the durable delete, like
 *      every other delete here: a storage outage never brings a run back.
 *
 * Examples promoted from the run are COPIES in trend storage
 * (`copyToTrendStorage`), so a trend never loses an example this way; its
 * `sourceJobId` is provenance only. A Full Quality try of a deleted draft run
 * stays a run of its own.
 */
import { supabase } from "../../../lib/supabase.js"
import { IN_FLIGHT_JOB_STATUSES } from "../../../lib/job-status.js"
import { ownedJobOutputKeys } from "../../../lib/job-output-keys.js"
import { deletableKeys, permanentlyDeleteAsset } from "../../../lib/asset-delete.js"
import { deleteKeysRecordingFailures } from "../../../lib/storage-delete.js"
import { deleteJobWithPrivateMedia } from "../../../lib/workflow-delete.js"
import { MAX_CHILD_JOB_DEPTH } from "../../../lib/public-job-data.js"


/** The run (or one of its child jobs) is still running. */
export class TrendRunInFlightError extends Error {
  constructor(readonly jobId: string) {
    super(`Trend run ${jobId} is still running.`)
    this.name = "TrendRunInFlightError"
  }
}

interface FamilyJob {
  id: string
  status: string
  output_data: unknown
}

export interface TrendRunDeleteResult {
  /** False when the job was already gone. */
  deleted: boolean
  /** Library rows removed. */
  libraryRows: number
  /** Storage objects removed (library objects and the run's own other files). */
  filesDeleted: number
  /** Objects kept because something else still uses them, or they are not provably the owner's. */
  filesKept: number
}

/** The run and its descendants by `parent_job_id`, each the run owner's. */
async function runFamily(runId: string, ownerId: string): Promise<FamilyJob[]> {
  const family: FamilyJob[] = []
  let level = [runId]
  for (let depth = 0; depth <= MAX_CHILD_JOB_DEPTH && level.length > 0; depth++) {
    const query = supabase.from("jobs").select("id, status, output_data").eq("user_id", ownerId)
    const { data, error } = depth === 0 ? await query.eq("id", runId) : await query.in("parent_job_id", level)
    if (error) throw new Error(`Could not read the jobs of trend run ${runId}: ${error.message}`)
    const rows = (data ?? []) as FamilyJob[]
    family.push(...rows)
    level = rows.map((r) => r.id)
  }
  return family
}

export async function deleteTrendTestRun(args: {
  runId: string
  ownerId: string
  actorUserId: string
  logger?: { warn(fields: Record<string, unknown>, message: string): void }
}): Promise<TrendRunDeleteResult> {
  const { runId, ownerId } = args
  const family = await runFamily(runId, ownerId)
  if (family.length === 0) return { deleted: false, libraryRows: 0, filesDeleted: 0, filesKept: 0 }
  const live = family.find((j) => (IN_FLIGHT_JOB_STATUSES as readonly string[]).includes(j.status))
  if (live) throw new TrendRunInFlightError(live.id)

  // 2. Library rows, while the job rows still prove who made each object.
  const { data: assetRows, error: assetError } = await supabase
    .from("assets")
    .select("id, r2_key, size_bytes, job_id, relay_job_id")
    .eq("user_id", ownerId)
    .in("job_id", family.map((j) => j.id))
  if (assetError) throw new Error(`Could not read the library rows of trend run ${runId}: ${assetError.message}`)
  const assets = (assetRows ?? []) as Array<{ id: string; r2_key: string | null; size_bytes: number | null; job_id: string | null; relay_job_id: string | null }>
  const handledKeys = new Set<string>()
  let libraryRows = 0
  let filesDeleted = 0
  let filesKept = 0
  for (const asset of assets) {
    const result = await permanentlyDeleteAsset({ userId: ownerId, asset, blockOnOwnJobReferrers: false })
    if (!result.ok) throw new Error(`Could not delete library row ${asset.id} of trend run ${runId}: ${result.dbError.message}`)
    libraryRows++
    if (asset.r2_key) {
      handledKeys.add(asset.r2_key)
      if (result.r2Deleted) filesDeleted++
      else filesKept++
    }
  }

  // The run's other own files, read before the rows that name them go.
  const ownKeys = [...new Set(family.flatMap((j) => ownedJobOutputKeys(j.id, j.output_data)))].filter((k) => !handledKeys.has(k))
  let remaining = ownKeys
  if (ownKeys.length > 0) {
    const { data: named, error: namedError } = await supabase.from("assets").select("r2_key").in("r2_key", ownKeys)
    // Fail safe: if we cannot tell whether a row still names a file, keep them all.
    const stillNamed = namedError ? new Set(ownKeys) : new Set(((named ?? []) as Array<{ r2_key: string }>).map((r) => r.r2_key))
    remaining = ownKeys.filter((k) => !stillNamed.has(k))
    filesKept += ownKeys.length - remaining.length
  }
  const toDelete = remaining.length > 0 ? await deletableKeys(remaining) : []
  filesKept += remaining.length - toDelete.length

  // 3. The rows (children cascade).
  const deleted = await deleteJobWithPrivateMedia({ jobId: runId, actorUserId: args.actorUserId, isAdmin: true, logger: args.logger })

  // 4. Best-effort, after the durable delete; a failed key is recorded for the retry pass.
  if (toDelete.length > 0) {
    try {
      const r2 = await deleteKeysRecordingFailures(toDelete, "job-output")
      filesDeleted += toDelete.length - r2.failed.length
    } catch (err) {
      args.logger?.warn({ runId, keys: toDelete.length, err }, "trend run file cleanup failed; the keys are left for the retry pass")
    }
  }
  return { deleted, libraryRows, filesDeleted, filesKept }
}
