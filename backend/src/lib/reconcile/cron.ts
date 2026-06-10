import { supabase } from "../supabase.js"
import {
  STALE_THRESHOLD_MS,
  MIN_STALE_THRESHOLD_MS,
  FINALIZE_CLAIM_TTL_MS,
  KIE_RECOVER_KINDS,
  REPLICATE_RECOVER_KINDS,
  ELEVENLABS_RECOVER_KINDS,
  isSyncKind,
  type ProviderKind,
} from "./types.js"
import { sweepStaleSyncJob } from "./sync-sweep.js"

export interface ReconcileResult {
  scanned: number
  swept: number
  /** Async kinds successfully dispatched to a per-provider handler. */
  recovered: number
  notStale: number
  errors: number
}

/** Per-tick scan cap. Sized to drain a thousands-of-rows backfill in a few
 *  ticks without blowing the 5-min cadence. Each row costs 2-3 DB roundtrips
 *  (CAS UPDATE + refund lookups), so 500 × ~30ms ≈ 15s wall-clock per tick. */
const BATCH_LIMIT = 500

/** SQL pre-filter buffer: rows newer than this are unconditionally skipped at
 *  the DB layer. Half the minimum threshold gives the planner a useful index
 *  cut without risking a missed-stale row when per-kind precision applies in
 *  `isStale()` below. */
const SQL_PREFILTER_BUFFER_MS = Math.floor(MIN_STALE_THRESHOLD_MS / 2)

interface CandidateRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  provider_call_started_at: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data: Record<string, unknown> | null
  finalize_claimed_at: string | null
}

// Dispatch sets live in types.ts (single source of truth, audit M5) — shared
// with workers/inline-reconcile.ts and the worker's leave-for-reconcile
// predicate, parity-tested against the sync/async classification.
const KIE_KINDS = KIE_RECOVER_KINDS
const REPLICATE_KINDS = REPLICATE_RECOVER_KINDS
const ELEVENLABS_KINDS = ELEVENLABS_RECOVER_KINDS

function sqlCutoff(): string {
  return new Date(Date.now() - SQL_PREFILTER_BUFFER_MS).toISOString()
}

function isStale(row: CandidateRow): boolean {
  if (!row.provider_call_started_at) return false
  const elapsed = Date.now() - new Date(row.provider_call_started_at).getTime()
  if (row.provider_kind && row.provider_kind in STALE_THRESHOLD_MS) {
    return elapsed > STALE_THRESHOLD_MS[row.provider_kind as ProviderKind]
  }
  return elapsed > MIN_STALE_THRESHOLD_MS
}

/**
 * True when a finalizer (the worker, or a previous cron tick) holds an
 * unexpired finalize claim on this job — it is mid-download/upload RIGHT NOW.
 * Dispatching a second finalizer would double-download the provider result
 * and race the same deterministic R2 key, so the cron defers to the next tick.
 * A crashed claimant self-heals: the claim ages past FINALIZE_CLAIM_TTL_MS and
 * the row becomes dispatchable again.
 */
function hasFreshFinalizeClaim(row: CandidateRow): boolean {
  if (!row.finalize_claimed_at) return false
  return Date.now() - new Date(row.finalize_claimed_at).getTime() < FINALIZE_CLAIM_TTL_MS
}

/**
 * Reconciliation cron entrypoint. Scans inflight `jobs` rows whose
 * `provider_call_started_at` is past their kind's threshold and dispatches
 * by `provider_kind`:
 *   - sync kinds + null → sweepStaleSyncJob (mark failed + refund)
 *   - kie-* → reconcileKieJob
 *   - replicate-* → reconcileReplicateJob
 *   - elevenlabs-async → reconcileElevenLabsJob
 *
 * Async per-provider handlers either complete the job (via finalizeJobWithMedia),
 * fail it (markFailed + refund), or bump reconcile_attempts and try next tick.
 */
export async function reconcileInflightJobs(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    scanned: 0,
    swept: 0,
    recovered: 0,
    notStale: 0,
    errors: 0,
  }

  const candidateScan = (columns: string) =>
    supabase
      .from("jobs")
      .select(columns)
      .in("status", ["pending", "processing"])
      .not("provider_call_started_at", "is", null)
      .lt("provider_call_started_at", sqlCutoff())
      .limit(BATCH_LIMIT)

  const BASE_COLUMNS =
    "id, provider_kind, provider_task_id, provider_call_started_at, reconcile_attempts, job_type, input_data"
  let { data, error } = await candidateScan(`${BASE_COLUMNS}, finalize_claimed_at`)

  // Migration-window resilience (audit H2): if migration 210/211 hasn't
  // applied yet, the claim column doesn't exist and the SELECT fails with
  // 42703 — retry WITHOUT it (pre-claim semantics: all claims treated as
  // absent) rather than disabling the entire reconcile pass. Standing
  // pattern for any future cron-consumed column.
  if (error && (error as { code?: string }).code === "42703") {
    console.warn(
      "[reconcile/cron] finalize_claimed_at column missing (migration pending) — retrying scan without it",
    )
    ;({ data, error } = await candidateScan(BASE_COLUMNS))
  }

  let rows: CandidateRow[] = []
  if (error) {
    // Scan failure must NOT short-circuit the function — the auxiliary
    // sweeps below (never-started / component-wrapper / stuck-render) are
    // independent refund paths and previously died with this early return.
    console.error(`[reconcile/cron] candidate query failed:`, error.message)
  } else {
    rows = (data ?? []) as unknown as CandidateRow[]
  }
  result.scanned = rows.length

  for (const row of rows) {
    if (!isStale(row)) {
      result.notStale++
      continue
    }
    if (hasFreshFinalizeClaim(row)) {
      // A finalizer is actively completing this job — not actually stuck.
      result.notStale++
      continue
    }

    const kind = row.provider_kind as ProviderKind | null

    try {
      if (kind === null || isSyncKind(kind)) {
        await sweepStaleSyncJob({
          id: row.id,
          provider_kind: row.provider_kind,
          reconcile_attempts: row.reconcile_attempts,
        })
        result.swept++
      } else if (KIE_KINDS.has(kind)) {
        const { reconcileKieJob } = await import("./kie.js")
        await reconcileKieJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
          input_data: row.input_data,
        })
        result.recovered++
      } else if (REPLICATE_KINDS.has(kind)) {
        const { reconcileReplicateJob } = await import("./replicate.js")
        await reconcileReplicateJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
          input_data: row.input_data,
        })
        result.recovered++
      } else if (ELEVENLABS_KINDS.has(kind)) {
        const { reconcileElevenLabsJob } = await import("./elevenlabs.js")
        await reconcileElevenLabsJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
          input_data: row.input_data,
        })
        result.recovered++
      } else {
        // Unknown provider_kind (e.g., a future variant added to types.ts
        // without updating the dispatch sets above). Spec §5.5 catch-all:
        // sweep stale rows so they don't accumulate forever.
        await sweepStaleSyncJob({
          id: row.id,
          provider_kind: row.provider_kind,
          reconcile_attempts: row.reconcile_attempts,
        })
        result.swept++
      }
    } catch (err) {
      console.error(`[reconcile/cron] handler failed for job ${row.id}:`, err)
      result.errors++
    }
  }

  await sweepNeverStartedJobs(result)
  await sweepStuckComponentWrappers(result)
  await sweepStuckRenderJobs(result)

  return result
}

/** Jobs created but never picked up by a worker sit at `status='pending'` with
 *  `provider_call_started_at IS NULL` — past this age they're orphaned. Long
 *  enough that a legitimately-queued job (even behind a busy worker) has had
 *  ample time to start; workers normally claim within seconds. */
const NEVER_STARTED_STALE_MS = 30 * 60 * 1000

/**
 * Sweep jobs that were created but never started a provider call. The main scan
 * above requires `provider_call_started_at IS NOT NULL` (it reconciles against
 * an upstream task), so a job whose creating drive died before the worker
 * claimed it is invisible there and accumulates forever — thousands piled up
 * from pipeline drives killed by deploys / hard-timeouts. Mark each failed +
 * refund its reserved credits via the same `sweepStaleSyncJob` path.
 */
async function sweepNeverStartedJobs(result: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - NEVER_STARTED_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, provider_kind, reconcile_attempts")
    .eq("status", "pending")
    .is("provider_call_started_at", null)
    .lt("created_at", cutoff)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error(`[reconcile/cron] never-started query failed:`, error.message)
    result.errors++
    return
  }

  for (const row of data ?? []) {
    result.scanned++
    try {
      await sweepStaleSyncJob({
        id: row.id as string,
        provider_kind: (row.provider_kind as string | null) ?? null,
        reconcile_attempts: (row.reconcile_attempts as number | null) ?? 0,
      })
      result.swept++
    } catch (err) {
      console.error(
        `[reconcile/cron] never-started sweep failed for job ${row.id}:`,
        err,
      )
      result.errors++
    }
  }
}

/** Render jobs (the "video-render" BullMQ queue) set status='processing' +
 *  started_at at pickup but NO provider_kind / provider_call_started_at — so they
 *  are invisible to the main scan (requires provider_call_started_at NOT NULL),
 *  to sweepNeverStartedJobs (status='pending'), and to the component sweep
 *  (provider='component'). If a render stalls past BullMQ's maxStalledCount
 *  (default 1) — e.g. the container OOM-kills mid-render while holding the lock —
 *  BullMQ abandons the job WITHOUT running the handler's catch, so the row stays
 *  'processing' forever and its reserved credits (render-video = 15cr) never
 *  refund. Mark each one failed + refund via the shared sync-sweep path.
 *
 *  The threshold is well past the longest legitimate render AND the orchestrator's
 *  30-min node timeout (which already cancels+refunds workflow-embedded renders),
 *  so a still-running render is never failed. Render jobs are identified by
 *  input_data.type (set by buildJobInputData) since the jobs row carries no
 *  job_type/provider for renders. */
const RENDER_STALE_MS = 90 * 60 * 1000

async function sweepStuckRenderJobs(result: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - RENDER_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, provider_kind, reconcile_attempts")
    .eq("status", "processing")
    .is("provider_call_started_at", null)
    .filter("input_data->>type", "eq", "render-video")
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error(`[reconcile/cron] stuck-render query failed:`, error.message)
    result.errors++
    return
  }

  for (const row of data ?? []) {
    result.scanned++
    try {
      await sweepStaleSyncJob({
        id: row.id as string,
        provider_kind: (row.provider_kind as string | null) ?? null,
        reconcile_attempts: (row.reconcile_attempts as number | null) ?? 0,
      })
      result.swept++
    } catch (err) {
      console.error(
        `[reconcile/cron] stuck-render sweep failed for job ${row.id}:`,
        err,
      )
      result.errors++
    }
  }
}

/** Component wrapper jobs (provider="component") run their inner workflow in a
 *  server-side background loop and poll it to completion. They carry NO
 *  provider_call_started_at (skipped by the main scan) and are status="processing"
 *  (skipped by sweepNeverStartedJobs) — so if THAT server process dies mid-poll
 *  the wrapper is invisible to reconcile and strands. The common case self-heals
 *  (the orchestrator's 30-min poll timeout / BullMQ re-pick re-runs the component
 *  node), but an orphaned wrapper otherwise sits "processing" forever.
 *
 *  This backstop only acts once the wrapper is well past EVERY timeout (90 min)
 *  AND its nested execution is itself terminal/gone — so it never fails a
 *  legitimately long-running (deeply nested) component. It relies on the
 *  `_executionId` stamped on the wrapper at nested-execution-create time
 *  (routes/component-execute.ts). */
const COMPONENT_WRAPPER_STALE_MS = 90 * 60 * 1000

async function sweepStuckComponentWrappers(result: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - COMPONENT_WRAPPER_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, input_data")
    .eq("provider", "component")
    .eq("status", "processing")
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error(`[reconcile/cron] component-wrapper query failed:`, error.message)
    result.errors++
    return
  }

  for (const row of data ?? []) {
    result.scanned++
    try {
      const nestedId = (row.input_data as Record<string, unknown> | null)?._executionId
      let nestedStatus: string | null = null
      if (typeof nestedId === "string") {
        const { data: nested } = await supabase
          .from("workflow_executions")
          .select("status")
          .eq("id", nestedId)
          .maybeSingle()
        nestedStatus = (nested?.status as string | undefined) ?? null
      }
      // Only act once the nested execution is itself TERMINAL (or gone). Never
      // fail a wrapper whose inner workflow is still legitimately running.
      const nestedTerminal =
        nestedStatus === null ||
        ["completed", "failed", "cancelled", "abandoned"].includes(nestedStatus)
      if (!nestedTerminal) continue

      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error_message:
            nestedStatus === "completed"
              ? "Component wrapper orphaned (server crash mid-poll); inner run finished — re-run to collect output"
              : `Component inner execution ${nestedStatus ?? "missing"}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id as string)
        .eq("status", "processing") // CAS — don't trample a wrapper that just finished
      result.swept++
    } catch (err) {
      console.error(`[reconcile/cron] component-wrapper sweep failed for job ${row.id}:`, err)
      result.errors++
    }
  }
}
