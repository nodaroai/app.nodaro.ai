/**
 * Video Remake's side by side as a BACKGROUND JOB, the clip measurement's
 * shape (lib/clip-measure-job.ts): the person's request never waits for the
 * render. `POST /v1/video-remake/:jobId/side-by-side` starts it and is asked
 * again until the file is there; a run whose file is recorded answers at once.
 * No job row and no charge: it is free, and its state lives in Redis.
 *
 *   - the ANSWER is the file's record in the run's own `output_data`
 *     (`SIDE_BY_SIDE_FIELD`), read by the route before it asks here;
 *   - a `running` MARKER per run (set with NX, a lease renewed while the render
 *     goes on) keeps one render per run across instances; an instance that
 *     dies stops renewing it, and the next ask starts it again;
 *   - ONE render at a time per account (a second lease, per owner): another
 *     run's ask WAITS (`waiting`) until the first is done, so one account can
 *     never fill the box's ffmpeg admission with renders;
 *   - a failure is held for a few seconds so the ask can read it; it is never
 *     kept, so a later ask tries again;
 *   - a finished file whose record could not be written is held in the marker
 *     for a few minutes, so asking again never renders it twice;
 *   - a run KEPT OFF its row (`keepOffRun`: a trend run, made for an
 *     administrator) is never recorded on the run: its file goes to the run's
 *     scratch folder (`tmp/provider-input/<jobId>/`, which the daily sweep
 *     empties of files older than `JOB_SCRATCH_MAX_AGE_MS`, and no job read
 *     lists), its record only in the marker, held for a day less than that so
 *     the marker never outlives the file.
 *
 * The render runs in this process, detached from the request that started it.
 */
import { promises as fs } from "node:fs"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { uploadLocalFileToR2Key } from "../../lib/storage.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { JOB_SCRATCH_MAX_AGE_MS } from "../../lib/job-scratch-sweep.js"
import { sideBySideKeyHash } from "../../lib/job-output-keys.js"
import { deleteKeyRecordingFailure } from "../../lib/storage-delete.js"
import { TRASHED_JOB_COLUMN } from "../../lib/public-job-data.js"
import { RESTRICTED_JOB_COLUMN } from "../../lib/content-restrictions-column.js"
import { cleanupWorkDir, createWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { composeSideBySide } from "../../providers/video/side-by-side.js"
import {
  SIDE_BY_SIDE_FIELD,
  SIDE_BY_SIDE_RECIPE,
  sideBySideObjectKey,
  staleSideBySideRecipe,
  type SideBySideRecord,
  type SideBySideSource,
} from "./video-remake-side-by-side.js"

export type SideBySideState =
  | { readonly status: "ready"; readonly record: SideBySideRecord }
  /** Being rendered. */
  | { readonly status: "making" }
  /** Another of the account's runs is being rendered: this one starts after it. */
  | { readonly status: "waiting" }
  | { readonly status: "failed" }
  | { readonly status: "none" }

export interface SideBySideStore {
  readonly get: (key: string) => Promise<string | null>
  /** Set only if absent; true when this call set it. */
  readonly setNx: (key: string, value: string, ttlSeconds: number) => Promise<boolean>
  readonly set: (key: string, value: string, ttlSeconds: number) => Promise<void>
  readonly expire: (key: string, ttlSeconds: number) => Promise<void>
  readonly del: (key: string) => Promise<void>
}

/** What one render is asked to make. */
export interface SideBySideWork {
  readonly jobId: string
  /** The run's owner (whose account the render counts against, whose row records it). */
  readonly ownerId: string
  readonly resultUrl: string
  readonly source: SideBySideSource
  /** Never record the file on the run (`SideBySidePlan.keepOffRun`): the marker alone holds it. */
  readonly keepOffRun: boolean
}

export interface SideBySideJobDeps {
  /** Render the file, store it and record it on the run; the record. */
  readonly render: (work: SideBySideWork) => Promise<SideBySideRecord>
  readonly store: SideBySideStore
  /** How often a running render renews its leases. */
  readonly heartbeatMs: number
}

/** The lease a running marker (and the owner's) holds between renewals. */
export const LEASE_SECONDS = 180
/** How long a failure stays readable. */
const FAILED_SECONDS = 30
/** How long a finished file whose record could not be written is held by the marker itself. */
export const READY_SECONDS = 300
/** How long the marker holds the file of a run kept off its row (its only record): a day less than the scratch sweep's age. */
export const KEPT_OFF_RUN_READY_SECONDS = Math.floor(JOB_SCRATCH_MAX_AGE_MS / 1000) - 24 * 60 * 60

/** The whole render's deadline: its downloads, and its wait for the box's ffmpeg admission. */
export const SIDE_BY_SIDE_DEADLINE_MS = 15 * 60 * 1000

export const sideBySideMarkerKey = (jobId: string): string => `video-remake:side-by-side:job:v${SIDE_BY_SIDE_RECIPE}:${jobId}`
export const sideBySideOwnerKey = (ownerId: string): string => `video-remake:side-by-side:owner:${ownerId}`

type Marker =
  | { readonly status: "running" }
  | { readonly status: "ready"; readonly record: SideBySideRecord }
  | { readonly status: "failed" }

function parseMarker(raw: string | null): Marker | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { status?: unknown; record?: Partial<SideBySideRecord> }
    if (v.status === "running") return { status: "running" }
    if (v.status === "failed") return { status: "failed" }
    const r = v.record
    if (v.status === "ready" && r && r.v === SIDE_BY_SIDE_RECIPE && typeof r.url === "string" && typeof r.width === "number" && typeof r.height === "number" && (r.layout === "stack" || r.layout === "side")) {
      return { status: "ready", record: { v: r.v, url: r.url, width: r.width, height: r.height, layout: r.layout } }
    }
  } catch {
    // A marker that is junk is no marker.
  }
  return null
}

export interface SideBySideJob {
  /** What is known now, starting nothing. */
  poll(jobId: string): Promise<SideBySideState>
  /** Poll, and if nothing is known or running, start the render (or wait for the account's other one). */
  start(work: SideBySideWork): Promise<SideBySideState>
}

export function createSideBySideJob(deps: SideBySideJobDeps): SideBySideJob {
  async function poll(jobId: string): Promise<SideBySideState> {
    let marker: Marker | null = null
    try {
      marker = parseMarker(await deps.store.get(sideBySideMarkerKey(jobId)))
    } catch {
      marker = null
    }
    if (!marker) return { status: "none" }
    return marker.status === "running" ? { status: "making" } : marker
  }

  async function run(work: SideBySideWork, ownerToken: string): Promise<void> {
    const key = sideBySideMarkerKey(work.jobId)
    const ownerKey = sideBySideOwnerKey(work.ownerId)
    const beat = setInterval(() => {
      deps.store.expire(key, LEASE_SECONDS).catch(() => undefined)
      deps.store.expire(ownerKey, LEASE_SECONDS).catch(() => undefined)
    }, deps.heartbeatMs)
    try {
      const record = await deps.render(work)
      // The record is on the run now; the marker holds it a few minutes too, for an ask that read the run before it landed.
      // A run kept off its row: the marker is the only record.
      const held: Marker = { status: "ready", record }
      const ttl = work.keepOffRun ? KEPT_OFF_RUN_READY_SECONDS : READY_SECONDS
      await deps.store.set(key, JSON.stringify(held), ttl).catch(() => deps.store.del(key).catch(() => undefined))
    } catch (err) {
      console.warn(`[video-remake-side-by-side] render failed for ${work.jobId}: ${err instanceof Error ? err.message : String(err)}`)
      await deps.store.set(key, JSON.stringify({ status: "failed" }), FAILED_SECONDS).catch(() => undefined)
    } finally {
      clearInterval(beat)
      // The account's lease goes only if it is still this render's.
      try {
        if ((await deps.store.get(ownerKey)) === ownerToken) await deps.store.del(ownerKey)
      } catch {
        // It runs out on its own.
      }
    }
  }

  async function start(work: SideBySideWork): Promise<SideBySideState> {
    const known = await poll(work.jobId)
    if (known.status !== "none") return known
    const ownerToken = `${work.jobId}:${Date.now()}`
    let ownerWon = false
    try {
      ownerWon = await deps.store.setNx(sideBySideOwnerKey(work.ownerId), ownerToken, LEASE_SECONDS)
    } catch {
      // No store to coordinate through: render here anyway — unless the run is kept off its row, whose only
      // record is the store's (every ask would start another render, none ever answered).
      if (work.keepOffRun) return { status: "failed" }
      ownerWon = true
    }
    if (!ownerWon) return { status: "waiting" }
    let won = false
    try {
      won = await deps.store.setNx(sideBySideMarkerKey(work.jobId), JSON.stringify({ status: "running" }), LEASE_SECONDS)
    } catch {
      if (work.keepOffRun) {
        await deps.store.del(sideBySideOwnerKey(work.ownerId)).catch(() => undefined)
        return { status: "failed" }
      }
      won = true
    }
    if (!won) {
      // Someone else is rendering this run: give the account's lease back and report theirs.
      await deps.store.del(sideBySideOwnerKey(work.ownerId)).catch(() => undefined)
      const now = await poll(work.jobId)
      return now.status === "none" ? { status: "making" } : now
    }
    void run(work, ownerToken)
    return { status: "making" }
  }

  return { poll, start }
}

/**
 * The record written on the run: its `output_data` with `SIDE_BY_SIDE_FIELD`
 * set (the rest as it is), and the recipe of a file of an older recipe it
 * replaces. The run's own row, read again right before the write; a run moved
 * to the Trash or restricted meanwhile is not written (the render fails and
 * its file goes).
 */
async function recordOnRun(jobId: string, ownerId: string, record: SideBySideRecord): Promise<number | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("output_data")
    .eq("id", jobId)
    .eq("user_id", ownerId)
    .is(TRASHED_JOB_COLUMN, null)
    .is(RESTRICTED_JOB_COLUMN, null)
    .maybeSingle()
  if (error) throw new Error(`Could not read the run to record its side by side: ${error.message}`)
  if (!data) throw new Error("The run is gone")
  const output = (data as { output_data: unknown }).output_data
  const current = typeof output === "object" && output !== null && !Array.isArray(output) ? (output as Record<string, unknown>) : {}
  const stale = staleSideBySideRecipe(current)
  const { error: writeError } = await supabase
    .from("jobs")
    .update({ output_data: { ...current, [SIDE_BY_SIDE_FIELD]: record } })
    .eq("id", jobId)
    .eq("user_id", ownerId)
  if (writeError) throw new Error(`Could not record the side by side: ${writeError.message}`)
  return stale
}

/**
 * The production render: compose in a work dir of its own, store under the
 * run's key, record it on the run. A run kept off its row: stored in the run's
 * scratch folder under its keyed hash and recorded nowhere (the job's marker
 * holds it).
 */
export async function renderSideBySide(work: SideBySideWork): Promise<SideBySideRecord> {
  const workDir = await createWorkDir("video-remake-side-by-side")
  try {
    const made = await composeSideBySide({
      originalUrl: work.source.originalUrl,
      resultUrl: work.resultUrl,
      startSec: work.source.startSec,
      lengthSec: work.source.lengthSec,
      workDir,
      signal: AbortSignal.timeout(SIDE_BY_SIDE_DEADLINE_MS),
    })
    const stat = await fs.stat(made.outputPath)
    if (stat.size <= 0) throw new Error("The side by side came out empty")
    if (work.keepOffRun) {
      const name = `side-by-side-${sideBySideKeyHash(work.jobId, config.INTERNAL_ORCHESTRATOR_SECRET, SIDE_BY_SIDE_RECIPE)}`
      const url = await uploadJobScratchFile(made.outputPath, name, "mp4", "video/mp4", work.jobId)
      return { v: SIDE_BY_SIDE_RECIPE, url, width: made.width, height: made.height, layout: made.layout }
    }
    // Derived from the run's own files: not the person's upload, so it is not counted against their storage.
    const key = sideBySideObjectKey(work.jobId, config.INTERNAL_ORCHESTRATOR_SECRET)
    const url = await uploadLocalFileToR2Key(made.outputPath, key, "video/mp4")
    const record: SideBySideRecord = { v: SIDE_BY_SIDE_RECIPE, url, width: made.width, height: made.height, layout: made.layout }
    let stale: number | null
    try {
      stale = await recordOnRun(work.jobId, work.ownerId, record)
    } catch (err) {
      // A file no record names would outlive its run: it goes.
      await deleteKeyRecordingFailure(key, "media").catch(() => undefined)
      throw err
    }
    // The older recipe's file it replaces: its key rebuilt here, never read off the row.
    if (stale !== null) await deleteKeyRecordingFailure(sideBySideObjectKey(work.jobId, config.INTERNAL_ORCHESTRATOR_SECRET, stale), "media").catch(() => undefined)
    return record
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/** The production wiring: the render above and Redis for the markers. */
export function defaultSideBySideJobDeps(): SideBySideJobDeps {
  const redis = async () => (await import("../../lib/queue.js")).redis
  return {
    render: renderSideBySide,
    store: {
      get: async (key) => (await redis()).get(key),
      setNx: async (key, value, ttl) => (await (await redis()).set(key, value, "EX", ttl, "NX")) === "OK",
      set: async (key, value, ttl) => { await (await redis()).set(key, value, "EX", ttl) },
      expire: async (key, ttl) => { await (await redis()).expire(key, ttl) },
      del: async (key) => { await (await redis()).del(key) },
    },
    heartbeatMs: 60_000,
  }
}
