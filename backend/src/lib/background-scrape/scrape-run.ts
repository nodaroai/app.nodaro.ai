/**
 * The external run of a background scrape, saved and re-attached (decided
 * 2026-11-01: an interrupted scrape re-attaches, never re-runs).
 *
 * A settle saves its run on the row the moment the run exists — the connected
 * cloud's job id (`nodaro-cloud`) or the Apify run id (`apify-run`), in
 * `provider_task_id` with its kind in `provider_kind` — and a settle handed a
 * saved run waits on THAT run instead of starting one. No path starts a second
 * external run for one job: a run that cannot be saved is given up (the job
 * fails and refunds) rather than left unrecoverable, and a saved run of another
 * kind than the path would start is refused, never replaced.
 */
import { supabase } from "../supabase.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus, type JobStatus } from "../job-status.js"
import type { ApifyRunHooks } from "../../providers/apify/run.js"
import type { SavedScrapeRun, ScrapeRunKind } from "./job-types.js"

export interface ScrapeRunTracker {
  /** The kind of the run this job already started, if any. */
  readonly savedKind: ScrapeRunKind | undefined
  /** The saved run's id when it is of `kind`; undefined when none is saved. Throws when a run of another kind is. */
  resumeIdFor(kind: ScrapeRunKind): string | undefined
  /** This job's id: what the idempotency key of the cloud job it creates is made from (relayIdempotencyKey). */
  readonly jobId: string
  /**
   * Save a run that just started — only on a row that is still live and has
   * no run saved yet. Answers the run to wait on: this one, or the run another
   * attempt of the same job saved first (the caller then gives its own up).
   * Throws when it cannot be saved.
   */
  record(kind: ScrapeRunKind, id: string): Promise<string>
}

/** A run that could not be saved: the job is no longer live, or another attempt saved a run of the other kind. */
export class ScrapeRunNotSavedError extends Error {
  constructor(jobId: string, why: string) {
    super(`The scrape's run for job ${jobId} was not saved: ${why}`)
    this.name = "ScrapeRunNotSavedError"
  }
}

/**
 * The statuses a scrape runs in: in flight, but neither waiting in a lane
 * (`queued`) nor held for review. A row in any other has been cancelled,
 * ended or parked, and saves no run.
 */
const LIVE_SCRAPE_STATUSES: readonly JobStatus[] = IN_FLIGHT_JOB_STATUSES.filter((s) => s !== "queued" && !isParkedJobStatus(s))

/** A run that cannot be re-attached on this path: the job must not start another. */
export class SavedScrapeRunMismatchError extends Error {
  constructor(saved: ScrapeRunKind, wanted: ScrapeRunKind) {
    super(`This scrape already started a run (${saved}) that this path cannot wait on (${wanted}); it was not started again.`)
    this.name = "SavedScrapeRunMismatchError"
  }
}

export function scrapeRunTracker(jobId: string, saved?: SavedScrapeRun): ScrapeRunTracker {
  return {
    jobId,
    savedKind: saved?.kind,
    resumeIdFor(kind) {
      if (!saved) return undefined
      if (saved.kind !== kind) throw new SavedScrapeRunMismatchError(saved.kind, kind)
      return saved.id
    },
    async record(kind, id) {
      // A CAS: the first run saved for this job is the job's run. Two attempts
      // of one job can both start one (a lock that lapsed under a live
      // attempt); the later save must never replace the earlier id.
      const { data, error } = await supabase
        .from("jobs")
        .update({ provider_kind: kind, provider_task_id: id, provider_call_started_at: new Date().toISOString() })
        .eq("id", jobId)
        .is("provider_task_id", null)
        .in("status", [...LIVE_SCRAPE_STATUSES])
        .select("id")
      // Saving the run is what makes an interruption recoverable without a second run.
      if (error) throw new Error(`Could not save the scrape's run for job ${jobId}: ${error.message}`)
      if (data && data.length > 0) return id
      // trash-read: a job's own lifecycle — a scrape finishes (and keeps its one run) whether or not it was deleted.
      const { data: row, error: readError } = await supabase
        .from("jobs")
        .select("status, provider_kind, provider_task_id")
        .eq("id", jobId)
        .maybeSingle()
      if (readError) throw new Error(`Could not read the scrape's saved run for job ${jobId}: ${readError.message}`)
      const r = row as { status?: string; provider_kind?: string | null; provider_task_id?: string | null } | null
      if (!r || !(LIVE_SCRAPE_STATUSES as readonly string[]).includes(r.status ?? "")) throw new ScrapeRunNotSavedError(jobId, "the job is no longer running")
      if (!r.provider_task_id || r.provider_kind !== kind) throw new ScrapeRunNotSavedError(jobId, `another attempt saved a run of kind ${String(r.provider_kind)}`)
      return r.provider_task_id
    },
  }
}

/**
 * A re-attached attempt restarts its row's staleness clock: the reconcile cron
 * measures a saved run from `provider_call_started_at`, and each attempt (a
 * re-pick after an interruption) may take as long as the first. Best-effort.
 */
export async function restampSavedScrapeRun(jobId: string): Promise<void> {
  try {
    const { error } = await supabase.from("jobs").update({ provider_call_started_at: new Date().toISOString() }).eq("id", jobId)
    if (error) console.warn(`[background-scrape] could not restamp the saved run of job ${jobId}: ${error.message}`)
  } catch (err) {
    console.warn(`[background-scrape] could not restamp the saved run of job ${jobId}:`, err)
  }
}

/** The Apify run hooks of a scrape: wait on its saved run, or save the one it starts (and wait on whichever run was saved). */
export function apifyRunHooks(runs: ScrapeRunTracker): ApifyRunHooks {
  const resumeRunId = runs.resumeIdFor("apify-run")
  return resumeRunId ? { resumeRunId } : { onRunStarted: (id) => runs.record("apify-run", id) }
}

/**
 * The idempotency key a scrape relay creates its cloud job under: this job's
 * id, in a namespace of its own, so it can never match a key the connected
 * account's other callers send (the cloud dedupes on the key alone).
 */
export const relayIdempotencyKey = (jobId: string): string => `scrape-relay:${jobId}`

/**
 * The connected cloud's job of a scrape relay: the one it already started,
 * else a new one — created under this job's idempotency key, so a
 * second create for the same job answers the same cloud job — saved before it
 * is polled. Should another attempt have saved a different one first, this
 * attempt's job is cancelled (best effort) and the saved one polled; should
 * the job no longer be running, it is cancelled (best effort) and the save's
 * error thrown.
 */
export async function cloudJobOf(runs: ScrapeRunTracker, create: (idempotencyKey: string) => Promise<string>): Promise<string> {
  const saved = runs.resumeIdFor("nodaro-cloud")
  if (saved) return saved
  const cloudJobId = await create(relayIdempotencyKey(runs.jobId))
  let kept: string
  try {
    kept = await runs.record("nodaro-cloud", cloudJobId)
  } catch (err) {
    // The job is no longer running (or another attempt saved a run of the other
    // kind): nothing will ever poll this cloud job, so it is cancelled rather
    // than left to finish on the connected account. Not on any other failure
    // (a database error): under the idempotency key a live attempt of the same
    // job may be polling this very cloud job.
    if (err instanceof ScrapeRunNotSavedError) await cancelCloudJob(cloudJobId)
    throw err
  }
  if (kept !== cloudJobId) await cancelCloudJob(cloudJobId)
  return kept
}

/** Best effort: a cancel that fails is logged, never thrown over the caller's own outcome. */
async function cancelCloudJob(cloudJobId: string): Promise<void> {
  try {
    const { nodaroCloudFetch } = await import("../nodaro-connect.js")
    await nodaroCloudFetch(`/v1/jobs/${cloudJobId}/cancel`, { method: "POST" })
  } catch (err) {
    console.warn(`[background-scrape] could not cancel the cloud job ${cloudJobId}:`, err)
  }
}
