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
 * completed row on `completed`; throws on `failed` / `cancelled` / timeout.
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
