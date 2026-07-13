import { supabase } from "../supabase.js"
import { videoQueue } from "../queue.js"
import {
  STALE_THRESHOLD_MS,
  MIN_STALE_THRESHOLD_MS,
  FINALIZE_CLAIM_TTL_MS,
  KIE_RECOVER_KINDS,
  REPLICATE_RECOVER_KINDS,
  ELEVENLABS_RECOVER_KINDS,
  FAL_RECOVER_KINDS,
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
const FAL_KINDS = FAL_RECOVER_KINDS

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
 *   - fal-request → reconcileFalJob
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
      } else if (FAL_KINDS.has(kind)) {
        const { reconcileFalJob } = await import("./fal.js")
        await reconcileFalJob({
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
  await sweepStuckOrchestratorJobs(result)

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

/** Render jobs (the "video-render" BullMQ queue) and video-director
 *  orchestrator jobs (the "video-director" queue) set status='processing' +
 *  started_at at pickup but NEVER set provider_kind / provider_call_started_at
 *  — so they are invisible to the main scan (requires provider_call_started_at
 *  NOT NULL), to sweepNeverStartedJobs (status='pending'), and to the
 *  component sweep (provider='component'). generate-video-pro multi-segment
 *  stitch jobs (the "generate-video-pro" jobName) reach that SAME invisibility
 *  a different way: the video-worker's pickup path DOES set the standard
 *  provider_kind="pre-task" + provider_call_started_at sentinel at pickup,
 *  same as every other video-worker job — but the private-plugin handler's
 *  FIRST action clears both back to null via `clearReconcileSentinel`
 *  (`lib/private-plugins/toolkit.ts`). That clearing — not an absence of
 *  initial instrumentation — is the invariant making these rows invisible to
 *  the main scan for the rest of the run, and catchable only by this 90-min
 *  sweep.
 *
 *  Render stalls: BullMQ's maxStalledCount OOM-kill scenario — handler catch never
 *  runs, row stays 'processing', reserved credits (render-video = 5cr) never refund.
 *
 *  Director stalls: video-director never sets provider_call_started_at (it calls no
 *  provider directly; sub-jobs do). A Railway deploy / OOM / SIGKILL mid-chain means
 *  the handler catch never runs, so the reserved "video-director" authoring credit
 *  is neither committed nor refunded without this sweep.
 *
 *  generate-video-pro stalls: the pro engine checkpoints its own provider task id
 *  internally instead of using the standard onTaskCreated → provider_call_started_at
 *  path every other video node uses — jobs.provider_task_id is NEVER written for
 *  this type (spec §6 linchpin, see backend/src/lib/private-plugins/types.ts). A
 *  Railway deploy / OOM / SIGKILL mid-segment-stitch means the dynamically-clamped
 *  credits reserved by computeGenerateVideoProCreditOverride are neither committed
 *  nor refunded without this sweep.
 *
 *  edit-video-pro stalls: same private-plugin engine family as generate-video-pro
 *  (same `clearReconcileSentinel` toolkit call at pickup, see
 *  backend/src/lib/private-plugins/toolkit.ts), so it reaches the same
 *  invisibility the same way — clearing provider_kind/provider_call_started_at
 *  right after the standard video-worker pickup instrumentation sets them. A
 *  crash mid-reference-bridge-stitch means the probe-at-reserve credits from
 *  computeEditVideoProCreditOverride are neither committed nor refunded without
 *  this sweep.
 *
 *  The threshold is well past the longest legitimate run (render ≈ 5 min, director
 *  chain ≈ 3 min) AND the orchestrator's 90-min node timeout (NODE_TIMEOUT_MS —
 *  generate-video-pro's multi-segment stitch is the long pole here), so a
 *  still-running job is never failed. Jobs are identified by input_data.type (set
 *  by buildJobInputData / the director route / node-executor's input_data
 *  backfill) since the jobs rows carry no job_type/provider for these queues.
 *
 *  For the CHECKPOINT_RESUMABLE_JOB_TYPES subset (gvp/evp), the sweep first
 *  tries `tryResumeCheckpointedPluginJob` — requeue-for-resume once, and skip
 *  entirely while a live BullMQ entry for the row exists — before falling
 *  back to fail+refund. See that function's doc comment. */
const RENDER_STALE_MS = 90 * 60 * 1000

/** Job types swept by `sweepStuckOrchestratorJobs` — see the doc comment on
 *  `RENDER_STALE_MS` above for why each one is invisible to the main scan.
 *  Exported so tests can assert membership directly instead of re-deriving
 *  it from a mocked query-builder chain. */
export const STUCK_ORCHESTRATOR_JOB_TYPES = ["render-video", "video-director", "generate-video-pro", "edit-video-pro"] as const

/** The subset of STUCK_ORCHESTRATOR_JOB_TYPES that checkpoints its progress
 *  (`output_data.pro`, written by the private-plugin engines on every state
 *  change) and whose handler RESUMES from that checkpoint on re-entry —
 *  completed segments are skipped, an in-flight provider task is re-polled,
 *  and only the remainder (often just the final stitch) runs. For these,
 *  failing the row is a LAST resort: job 1e209599 died to a deploy-storm
 *  worker restart with all four segments generated and only the stitch
 *  outstanding, and the sweep failed+refunded it — every segment's provider
 *  cost wasted, user told to re-run. Exported for the same test-directness
 *  reason as the list above. */
export const CHECKPOINT_RESUMABLE_JOB_TYPES: ReadonlySet<string> =
  new Set(["generate-video-pro", "edit-video-pro"])

/** One resume per job: the sweep requeues only while reconcile_attempts is 0,
 *  so a job that stalls AGAIN after its resume is swept (failed + refunded)
 *  at the next encounter instead of looping forever. */
const MAX_RESUME_ATTEMPTS = 1

interface StuckOrchestratorRow {
  id: string
  provider_kind: string | null
  reconcile_attempts: number | null
  user_id: string | null
  usage_log_id: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
}

/**
 * Resume-instead-of-fail for checkpointed private-plugin jobs.
 *
 * Returns:
 *  - "live"     — a BullMQ entry for this row still exists (queued or active):
 *                 the run is slow, not dead (a long multi-segment run can
 *                 legitimately outlive RENDER_STALE_MS). Requeuing would
 *                 double-process the checkpoint (two writers, two provider
 *                 tasks per segment), and sweeping would fail a live job —
 *                 leave it alone entirely.
 *  - "requeued" — the row had a checkpoint and a resume attempt left; a fresh
 *                 BullMQ job was enqueued. The handler re-enters, skips the
 *                 checkpoint's completed segments, and finishes the run.
 *  - "sweep"    — not resumable (wrong type, no checkpoint yet, resume
 *                 already spent, or the CAS lost): caller falls through to
 *                 the fail+refund sweep exactly as before.
 *
 * The BullMQ payload is reconstructed from the row: `input_data` carries the
 * route's full Zod-parsed body (buildJobInputData), the money-authoritative
 * pricing rides in the checkpoint (`output_data.pro.pricing` — the same
 * object the route embedded into the original payload at reservation time),
 * and usage_log_id is a dedicated column. Extra input_data keys (`type`,
 * `userPrompt`) are inert — the plugin handlers read named fields only. No
 * custom BullMQ jobId on the add (per tryRemoveFromQueue's doc, a reused id
 * would dedupe against the removeOnComplete window); the reconcile_attempts
 * CAS below is what makes concurrent cron ticks single-shot.
 */
async function tryResumeCheckpointedPluginJob(
  row: StuckOrchestratorRow, jobType: string,
): Promise<"live" | "requeued" | "sweep"> {
  if (!CHECKPOINT_RESUMABLE_JOB_TYPES.has(jobType)) return "sweep"

  // Same states tryRemoveFromQueue scans (queue.ts), plus "active".
  try {
    const live = await videoQueue.getJobs(["active", "prioritized", "waiting", "delayed"], 0, 500)
    if (live.some(j => (j?.data as { jobId?: string } | undefined)?.jobId === row.id)) return "live"
  } catch {
    // Redis hiccup — fall through to the resume attempt: the CAS still bounds
    // it to one requeue total, and a rare double-entry converges through the
    // checkpoint (segments persist idempotently by index).
  }

  const attempts = row.reconcile_attempts ?? 0
  if (attempts >= MAX_RESUME_ATTEMPTS) return "sweep"
  const checkpoint = (row.output_data as { pro?: { pricing?: unknown } } | null)?.pro
  if (!checkpoint || typeof checkpoint !== "object" || !checkpoint.pricing) return "sweep"

  // CAS on reconcile_attempts: exactly one tick wins the requeue. started_at
  // refreshes so queue-wait before pickup doesn't eat into the next
  // RENDER_STALE_MS window (the worker refreshes it again at pickup).
  const { data: updated, error } = await supabase
    .from("jobs")
    .update({
      reconcile_attempts: attempts + 1,
      reconcile_last_error: "requeued_for_resume",
      started_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "processing")
    .eq("reconcile_attempts", attempts)
    .select("id")
  if (error || !updated || updated.length === 0) return "sweep"

  await videoQueue.add(jobType, {
    jobId: row.id,
    userId: row.user_id ?? undefined,
    ...(row.input_data ?? {}),
    proPricing: checkpoint.pricing,
    usageLogId: row.usage_log_id ?? undefined,
  })
  console.log(`[reconcile/cron] requeued checkpointed ${jobType} job ${row.id} for resume`)
  return "requeued"
}

async function sweepStuckOrchestratorJobs(result: ReconcileResult): Promise<void> {
  const cutoff = new Date(Date.now() - RENDER_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, provider_kind, reconcile_attempts, user_id, usage_log_id, input_data, output_data")
    .eq("status", "processing")
    .is("provider_call_started_at", null)
    .in("input_data->>type", STUCK_ORCHESTRATOR_JOB_TYPES)
    .lt("started_at", cutoff)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error(`[reconcile/cron] stuck-orchestrator query failed:`, error.message)
    result.errors++
    return
  }

  for (const row of (data ?? []) as unknown as StuckOrchestratorRow[]) {
    result.scanned++
    try {
      const jobType = String((row.input_data as { type?: unknown } | null)?.type ?? "")
      const resume = await tryResumeCheckpointedPluginJob(row, jobType)
      if (resume === "requeued") {
        result.recovered++
        continue
      }
      if (resume === "live") {
        result.notStale++
        continue
      }
      await sweepStaleSyncJob({
        id: row.id,
        provider_kind: row.provider_kind ?? null,
        reconcile_attempts: row.reconcile_attempts ?? 0,
      })
      result.swept++
    } catch (err) {
      console.error(
        `[reconcile/cron] stuck-orchestrator sweep failed for job ${row.id}:`,
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
