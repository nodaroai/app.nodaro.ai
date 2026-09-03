import type { SupabaseClient } from "@supabase/supabase-js"
import { PIPELINE_STAGE_TIMEOUT_MS } from "@nodaro/shared"

/**
 * Initial poll cadence. The fast majority of jobs (image-gen, extract-frame)
 * complete in 5-30s; starting at 1s catches the fast path without spinning.
 * The backoff ramps to MAX_POLL_INTERVAL_MS for long-running jobs (lip-sync,
 * Suno music, video combine) so we don't poll wastefully.
 */
const INITIAL_POLL_INTERVAL_MS = 1000
const MAX_POLL_INTERVAL_MS = 5000
const POLL_BACKOFF_FACTOR = 1.5

/**
 * Extra grace window after `jobs.status` flips to "completed" during which we
 * keep polling `assets` for the row written by `createAssetFromJob` in the
 * worker (see backend/src/workers/video-worker.ts — the asset insert runs AFTER
 * the handler resolves, so observing `status=completed` does not guarantee the
 * asset row exists yet).
 */
export const ASSET_POLL_GRACE_MS = 15_000
const INITIAL_ASSET_POLL_INTERVAL_MS = 250
const MAX_ASSET_POLL_INTERVAL_MS = 1500

export interface JobPollRow {
  status: string
  output_data: Record<string, unknown> | null
  error_message: string | null
  credits_actual: number | null
}

/**
 * A pipeline child job was parked in `pending_review` — generated, but its
 * output is withheld pending a human decision (spec
 * 2026-09-03-job-policy-hook-design §6.4).
 *
 * Distinct from a timeout ON PURPOSE. Waiting out the 30-minute stage budget
 * would (a) report "timed out" for a job that is perfectly healthy, and (b)
 * leave the pipeline to fail with a cause that names the wrong stage — a
 * critic, usually. Failing fast with `failureReason` lets the pipeline row
 * record `policy_hold` (see stage-utils.ts :: CriticFailureReason).
 *
 * UNREACHABLE IN V1: `holdEligible` excludes every job carrying a
 * `pipeline_id` (D8), so no pipeline child can be held. This is the contract
 * guard that keeps the failure honest if eligibility ever widens — and the
 * reason the orphan-approve problem (a review approving a job whose pipeline
 * already moved on) is listed as a prerequisite for that widening, not solved
 * here.
 */
export class JobHeldError extends Error {
  readonly failureReason = "policy_hold" as const
  constructor(readonly jobId: string) {
    super(`Job ${jobId} is awaiting human review — its output is withheld, so this stage cannot continue`)
    this.name = "JobHeldError"
  }
}

export interface PollJobOptions {
  /** Override the canonical 30-min per-stage timeout (rare). */
  timeoutMs?: number
  /** Override the initial polling cadence (rare — useful for tests that
   *  drive timers manually). When set, backoff is disabled and the cadence
   *  stays at this value for the whole loop. */
  pollIntervalMs?: number
}

/**
 * Polls a `jobs` row until it reaches a terminal status. Resolves with the
 * completed row on `completed`; throws on `failed` / `cancelled` / timeout,
 * and throws {@link JobHeldError} at once on `pending_review`.
 *
 * Uses exponential backoff (1s → 1.5s → 2.25s → … capped at 5s) so fast jobs
 * settle quickly while long-running ones don't hammer the DB. Override via
 * `pollIntervalMs` to disable backoff (tests with fake timers).
 *
 * Shared across every pipeline-service wrapper (animate-shot, generate-speech,
 * lip-sync, combine-videos, extract-frame, generate-image). All wrappers use
 * the same shape: insert jobs row → reserve credits → enqueue worker →
 * pollJobUntilComplete. The worker commits/refunds credits on its own — the
 * wrappers never double-commit here.
 */
export async function pollJobUntilComplete(
  supabase: SupabaseClient,
  jobId: string,
  opts: PollJobOptions = {},
): Promise<JobPollRow> {
  const timeoutMs = opts.timeoutMs ?? PIPELINE_STAGE_TIMEOUT_MS
  // When the caller overrides the interval (test path), pin to that value
  // and skip the exponential ramp — tests advance fake timers in fixed steps.
  const fixedInterval = opts.pollIntervalMs
  const deadline = Date.now() + timeoutMs
  let intervalMs = fixedInterval ?? INITIAL_POLL_INTERVAL_MS

  while (Date.now() < deadline) {
    await sleep(intervalMs)
    if (fixedInterval === undefined) {
      intervalMs = Math.min(Math.floor(intervalMs * POLL_BACKOFF_FACTOR), MAX_POLL_INTERVAL_MS)
    }
    const { data: row } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, credits_actual")
      .eq("id", jobId)
      .maybeSingle()
    if (!row) continue
    const r = row as JobPollRow
    // BEFORE the terminal checks and before the deadline can expire: a held
    // job is neither failed nor completed, and it will not become either
    // without a human. See JobHeldError above.
    if (r.status === "pending_review") {
      throw new JobHeldError(jobId)
    }
    if (r.status === "failed" || r.status === "cancelled") {
      throw new Error(`Job ${r.status}: ${r.error_message ?? "unknown"}`)
    }
    if (r.status === "completed") return r
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`)
}

/**
 * Polls the `assets` table for a row produced by the worker's
 * `createAssetFromJob` step. The asset is inserted AFTER the handler resolves,
 * so we briefly poll past job-completion to give it time to land. Returns the
 * asset id, or null if the grace window elapses (rare — the output URL is
 * still usable from `jobs.output_data`).
 *
 * Same backoff strategy as `pollJobUntilComplete` but with a shorter window
 * (15s) and starting cadence (250ms) — typical asset-write latency is sub-1s.
 */
export async function pollForAssetId(
  supabase: SupabaseClient,
  jobId: string,
  assetType: "image" | "video" | "audio",
): Promise<string | null> {
  const deadline = Date.now() + ASSET_POLL_GRACE_MS
  let intervalMs = INITIAL_ASSET_POLL_INTERVAL_MS
  while (Date.now() < deadline) {
    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("job_id", jobId)
      .eq("type", assetType)
      .maybeSingle()
    if (asset?.id) return asset.id as string
    await sleep(intervalMs)
    intervalMs = Math.min(Math.floor(intervalMs * POLL_BACKOFF_FACTOR), MAX_ASSET_POLL_INTERVAL_MS)
  }
  return null
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
