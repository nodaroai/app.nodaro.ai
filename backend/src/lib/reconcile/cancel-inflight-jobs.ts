import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { declaredJobBudgetMs } from "../job-budget.js"
import type { AdoptedJobClocks } from "../../services/workflow-engine/types.js"
import { STALE_THRESHOLD_MS } from "./types.js"
import { noteSlotWaitColumnError, withSlotWaitColumn } from "../jobs-slot-wait-column.js"
import { UGC_JOB_TYPES } from "../../services/workflow-engine/ugc-sync-nodes.js"
import { isExecutionRequestKey } from "../../services/workflow-engine/idempotency-key.js"

/** An in-flight child job a re-picked orchestrator should ADOPT (resume
 *  polling) instead of cancel+re-run. Keyed by owning node id. Two kinds:
 *  a provider job whose call already went out and was paid for (audit A2),
 *  and a budgeted local render whose worker is still heartbeating (podcast
 *  Track 0.11 follow-up, product decision 2026-09-24). */
export interface AdoptableChildJob {
  jobId: string
  usageLogId?: string
  creditsReserved?: number
  /** The budget the job's row declares (`lib/job-budget.ts`, read off
   *  `job_type` + `input_data` exactly as the orchestrator read the dispatched
   *  payload), so the adopting poll runs under the ceilings the original
   *  dispatch had. Undefined → the default ceilings. */
  budgetMs?: number
  /** Where the adopting poll's clocks start — set for a live budgeted render
   *  only: the row's ORIGINAL dispatch (`created_at`) and pickup
   *  (`started_at`), so a re-pick never hands the render a fresh budget.
   *  Undefined for a provider-task adoption, whose clocks start at adoption
   *  exactly as before. */
  clocks?: AdoptedJobClocks
}

export interface NeutralizeResult {
  cancelled: number
  /** node_id → adoptable in-flight job. */
  adoptable: Map<string, AdoptableChildJob>
}

export interface CancelInFlightOptions {
  /** Orchestrator RESUME only: adopt a budgeted render — or a UGC node's own
   *  job — whose worker is still heartbeating (class 3 below) instead of
   *  cancelling it. Off for the component-timeout cleanup, where the parent has
   *  given up on the inner run and cancelling it is the point. */
  readonly adoptLiveBudgetedRenders?: boolean
}

/**
 * How recent a `pre-task` heartbeat must be for its worker to count as alive:
 * the reconcile cron's own staleness threshold for the kind. One rule for both
 * readers — a row the orchestrator adopts is one the cron still treats as
 * live, and a row the cron would fail + refund is one the orchestrator cancels
 * and re-dispatches. (Beats land every `PRE_TASK_HEARTBEAT_MS` = 60 s; the
 * video worker's stall re-pick — 300 s lock + 60 s check — re-stamps the row
 * and resumes the render under the SAME jobId, so a render caught between its
 * last beat and that re-pick is still adopted.)
 */
export const LIVE_PRE_TASK_STAMP_MS = STALE_THRESHOLD_MS["pre-task"]

interface InFlightRow {
  id?: unknown
  status?: unknown
  provider_kind?: unknown
  provider_call_started_at?: unknown
  created_at?: unknown
  started_at?: unknown
  usage_log_id?: unknown
  credits?: unknown
  slot_wait_ms?: unknown
}

/** Is this row a render its worker is still running? `processing`, still on
 *  the `pre-task` sentinel the dispatch-site heartbeat refreshes
 *  (`workers/pre-task-heartbeat.ts` — a CAS on exactly that kind + status),
 *  and stamped within `LIVE_PRE_TASK_STAMP_MS`. An absent stamp, a cleared or
 *  replaced kind, or a stale stamp is not live. Exported for its unit test. */
export function isLiveRenderRow(row: InFlightRow, nowMs: number): boolean {
  if (row.status !== "processing" || row.provider_kind !== "pre-task") return false
  const stampMs = typeof row.provider_call_started_at === "string" ? Date.parse(row.provider_call_started_at) : NaN
  return Number.isFinite(stampMs) && nowMs - stampMs < LIVE_PRE_TASK_STAMP_MS
}

function epochMs(v: unknown): number | undefined {
  const ms = typeof v === "string" ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : undefined
}

/** A `jobs` read that also names `slot_wait_ms` once migration 451 has
 *  reached this shared database. Without the column the whole statement
 *  fails, so on a missing-column error it is retried without it (a wait of 0).
 *  Every read in this file that can adopt a render goes through here, so their
 *  column lists cannot drift apart: a read that drops the wait leaves the
 *  adopting poll's absolute clock uncredited, and that cancels a live render
 *  on its first tick. */
async function readJobsWithSlotWait<T>(
  columns: string,
  run: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let { data, error } = await run(withSlotWaitColumn(columns))
  if (error && noteSlotWaitColumnError(error)) ({ data, error } = await run(columns))
  // A runtime column list loses the typed row; the caller names the columns.
  return { data: (data ?? null) as T | null, error }
}

function adoptedRender(row: InFlightRow, budgetMs: number | undefined): AdoptableChildJob {
  return {
    jobId: row.id as string,
    usageLogId: typeof row.usage_log_id === "string" ? row.usage_log_id : undefined,
    creditsReserved: typeof row.credits === "number" ? row.credits : undefined,
    budgetMs,
    clocks: {
      dispatchedAtMs: epochMs(row.created_at),
      processingStartedAtMs: epochMs(row.started_at),
      // Credited from the FIRST tick: the adopting poll's absolute clock runs
      // from dispatch, before it has read the row once (Track 0.13).
      slotWaitMs: Number(row.slot_wait_ms ?? 0) || 0,
    },
  }
}

/**
 * Neutralize every still-in-flight (pending/processing) child job of an
 * execution. Called by the orchestrator at the start of a (re-)pick, AFTER
 * reconcileNodeStatesFromJobs + carry-forward have decided which nodes are done.
 *
 * Three classes (plus the metered rule's own, below):
 *
 * 1. Everything not adopted below (pre-provider rows, fan-out iterations,
 *    orphans, a render whose worker is gone) — cancel + refund, exactly the
 *    original double-charge fix: without it, the prior attempt's job is later
 *    recovered by the reconcile cron and COMMITTED while the re-run charges
 *    again. Cancelling is free here — no provider work has been paid for.
 *
 * 2. POST-provider rows (`provider_task_id` set, single-shot — no fan-out
 *    `iterationIndex`) — ADOPTED (audit A2). The provider is already rendering
 *    this exact node's output; cancelling + re-running paid the provider twice
 *    for the same content. The node executor polls the adopted job to
 *    completion (executeWorkerNode), and the reconcile system owns its terminal
 *    outcome if the worker never finishes it (complete via cron, or exhaust →
 *    refund + anomaly), so adoption can never strand the node: the poll sees a
 *    terminal status either way. Fan-out iterations keep the cancel+refund
 *    path — adopting them would need iteration-index matching against the
 *    re-derived fan-out (completed iterations are already reused via
 *    loadCompletedFanOutIterations; in-flight ones are rare enough to eat).
 *
 * 3. LIVE BUDGETED RENDERS (`opts.adoptLiveBudgetedRenders`, the resume only):
 *    a single-shot row whose job declares a budget (`declaredJobBudgetMs` —
 *    apply-edl today, which never sets `provider_task_id`), `processing`, with
 *    a fresh `pre-task` heartbeat (`isLiveRenderRow`) — ADOPTED. Product
 *    decision 2026-09-24: the render never restarts because of an orchestrator
 *    restart. Its worker keeps rendering under the same jobId (and resumes from
 *    its jobId-keyed checkpoints if the video worker is itself re-picked), and
 *    the adopting poll runs under the SAME budget, on clocks that start at the
 *    row's original dispatch and pickup (`clocks`) — never a fresh budget per
 *    re-pick, which is what bounds a re-pick loop. If the worker dies after
 *    adoption and BullMQ never re-picks it, the 30-min `pre-task` sweep fails
 *    + refunds the row and the adopting poll reports that failure: the node
 *    fails rather than re-rendering (stated residual). A row whose heartbeat is
 *    stale, absent, or cleared takes class 1, as before.
 *
 *    Race — the supersede-cancel never hits a render that came alive between
 *    the read and the write: a class-1 cancel of a budgeted row is pinned to
 *    the heartbeat stamp we judged dead (`.eq` / `.is(null)` on
 *    `provider_call_started_at`). A beat, or a video-worker pickup, rewrites
 *    the stamp, the CAS misses, and the re-read adopts the now-live row — so
 *    there is never a live render AND a re-dispatch for the same node.
 *
 * A metered LLM job the sweep's rule leaves live (`retry`: its call may be in
 * flight, or a billed hold is not settled yet) is never cancelled; on the
 * RESUME it is ADOPTED like a live render (single-shot, owning node known), so
 * the node is not re-run and the model is not paid twice.
 *
 * CRITICAL — we still STRIP `input_data.node_id` from each CANCELLED job:
 *   reconcileNodeStatesFromJobs' Path-2 maps a `cancelled` job back to its node
 *   via `input_data.node_id` and marks that node "skipped". Without stripping it,
 *   a superseded job would be mapped onto the node that is RE-RUNNING right now —
 *   wrongly marking it "skipped" and letting the periodic workflow-executions
 *   cron prematurely flip the whole execution to "completed" while the re-run is
 *   still in flight. Nulling node_id (keeping `superseded_node_id` for tracing)
 *   makes Path-2 ignore these rows (`if (!nodeId) continue`). Adopted rows KEEP
 *   their node_id — they are owned by the node that is about to poll them.
 *
 * …and a CANCELLED job gives back the idempotency key THIS run sent for it
 *   (`isExecutionRequestKey`), for the same reason: the re-run sends the SAME
 *   key, and the dedup hands back whichever row holds it, whatever its status —
 *   the re-run would poll the cancelled job and fail on it instead of running.
 *   A key a route wrote for its own reasons stays: UGC Clip's column holds the
 *   clip's CONTENT key (its request key rides in `input_data`), which the clip
 *   route answers the re-render from. Adopted rows keep their key too — the
 *   re-run polls them.
 *
 * Ordering invariant: MUST run AFTER reconcileNodeStatesFromJobs + carry-forward.
 * Cancelling BEFORE reconcile would make reconcile map these jobs to "skipped"
 * and carry their nodes forward as done — leaving them un-executed.
 *
 * Residual races (both narrow, both strictly better than the prior multi-minute
 * crash→cron window):
 *   1. A job that commits in the sub-ms window between the SELECT and the CAS
 *      below re-runs AND committed (one extra charge).
 *   2. If a *live* prior instance is still polling this job (BullMQ lock lapse
 *      while alive — rare), the adopted path is now HARMLESS (both instances
 *      poll the same row); for the cancelled class the old mis-reported-status
 *      race remains. A fully race-free fix needs execution-level fencing.
 *
 * No-op on a first pick (no child jobs exist yet).
 */
export async function cancelInFlightChildJobs(
  executionId: string,
  /** The execution's owner: only their jobs are this run's (decided 2026-10-06; migration 474). */
  ownerId: string,
  opts: CancelInFlightOptions = {},
): Promise<NeutralizeResult> {
  const result: NeutralizeResult = { cancelled: 0, adoptable: new Map() }
  const { data: inFlight, error: selErr } = await readJobsWithSlotWait<Array<Record<string, unknown>>>(
    "id, status, input_data, provider, provider_task_id, provider_kind, provider_call_started_at, created_at, started_at, usage_log_id, credits, job_type, idempotency_key, reconcile_attempts, reconcile_last_error",
    (columns) => supabase
      .from("jobs")
      .select(columns)
      .eq("workflow_execution_id", executionId)
      // A row naming this execution is not proof it is this run's: adopting
      // one would make its result the node's output.
      .eq("user_id", ownerId)
      .in("status", ["pending", "processing"]),
  )

  if (selErr) {
    console.error(
      `[orchestrator/resume] failed to query in-flight jobs for ${executionId}:`,
      selErr.message,
    )
    return result
  }
  if (!inFlight || inFlight.length === 0) return result

  let adoptedRenders = 0
  for (const row of inFlight) {
    const id = row.id as string
    // A use-case wrapper is never adopted and never bulk-flipped: the shared
    // single-job cancel refunds its fee AND stops the hidden run it owns
    // (a bare flip would refund nothing and leave that run billing). Dynamic:
    // cancel-job.ts pulls the queue, and it reaches back here for the inner run.
    if (row.provider === "use-case") {
      const { cancelOwnedJob } = await import("../cancel-job.js")
      const outcome = await cancelOwnedJob(id, ownerId).catch((err: unknown) => {
        console.warn(`[orchestrator/resume] use-case wrapper ${id} not cancelled:`, err)
        return null
      })
      if (outcome?.kind === "cancelled") result.cancelled++
      continue
    }
    const prevInput = (row.input_data as Record<string, unknown> | null) ?? {}
    const nodeId = typeof prevInput.node_id === "string" ? prevInput.node_id : null
    const singleShot = prevInput.iterationIndex === undefined
    const budgetMs = typeof row.job_type === "string" ? declaredJobBudgetMs(row.job_type, prevInput) : undefined

    // Class 2 — adoptable: provider already paid, single-shot node, owning
    // node known. First-wins if multiple rows somehow point at one node.
    if (row.provider_task_id && nodeId && singleShot && !result.adoptable.has(nodeId)) {
      result.adoptable.set(nodeId, {
        jobId: id,
        usageLogId: typeof row.usage_log_id === "string" ? row.usage_log_id : undefined,
        creditsReserved: typeof row.credits === "number" ? row.credits : undefined,
        budgetMs,
      })
      continue
    }

    // Class 3 — a budgeted render its worker is still running, or a UGC node's
    // own job (UGC Script, UGC Clip: its route started it, its worker pays the
    // model and the provider calls, and a re-run would pay them again). Its
    // worker beats like any other, so a live one is adopted on its original
    // clocks and a dead one is cancelled + refunded for the re-run.
    // `renderCandidate` also governs the pinned cancel below: only a row that
    // COULD be adopted needs protecting from a cancel that races its heartbeat.
    const ugcJob = typeof row.job_type === "string" && UGC_JOB_TYPES.has(row.job_type)
    const renderCandidate =
      opts.adoptLiveBudgetedRenders === true && (budgetMs !== undefined || ugcJob) && nodeId !== null && singleShot &&
      !result.adoptable.has(nodeId)
    if (renderCandidate && isLiveRenderRow(row, Date.now())) {
      result.adoptable.set(nodeId, adoptedRender(row, budgetMs))
      adoptedRenders++
      continue
    }

    // Class 1 — cancel + refund (pre-provider, fan-out iteration, orphan, or a
    // render whose worker is gone).
    //
    // D10 first, BEFORE the flip: a metered LLM hold whose job recorded a
    // billed cost is committed, never refunded — the reconcile sweep's own
    // rule (`settleMeteredHoldsBeforeCancel`). One that cannot be committed
    // yet is left exactly as it is, still sweepable, for the sweep to settle.
    const { settleMeteredHoldsBeforeCancel } = await import("../cancel-job.js")
    const metered = await settleMeteredHoldsBeforeCancel(id, {
      reconcile_attempts: typeof row.reconcile_attempts === "number" ? row.reconcile_attempts : 0,
      reconcile_last_error: typeof row.reconcile_last_error === "string" ? row.reconcile_last_error : null,
    })
    if (metered === "retry") {
      // A metered call may be in flight (it started, or its evidence could
      // not be read), or its billed hold is not settled yet: the job is left
      // live — never cancelled, never refunded on a guess (D10). On the
      // RESUME it is ADOPTED, as a live render is (class 3): re-running the
      // node would pay the model a second time while this job's own settle
      // charges the first call at its actual. Its worker finishes it, or the
      // reconcile sweep settles + fails it and the adopting poll reports that
      // failure (the node fails rather than re-running — the same residual
      // as an adopted render). Fresh clocks, as a provider-task adoption: an
      // LLM job declares no render budget its original dispatch would bound.
      if (opts.adoptLiveBudgetedRenders === true && nodeId !== null && singleShot && !result.adoptable.has(nodeId)) {
        result.adoptable.set(nodeId, {
          jobId: id,
          usageLogId: typeof row.usage_log_id === "string" ? row.usage_log_id : undefined,
          creditsReserved: typeof row.credits === "number" ? row.credits : undefined,
          budgetMs,
        })
        console.warn(`[orchestrator/resume] job ${id}: its metered call may be in flight — adopted for node ${nodeId}, not re-run`)
        continue
      }
      console.warn(`[orchestrator/resume] job ${id}: a billed metered hold is not settled yet — left for the reconcile sweep, not cancelled`)
      continue
    }
    const { node_id: prevNodeId, ...restInput } = prevInput
    let cas = supabase
      .from("jobs")
      .update({
        status: "cancelled",
        error_message: "Superseded by orchestrator resume (stale in-flight attempt)",
        completed_at: new Date().toISOString(),
        // node_id stripped (see docstring); keep the original for traceability.
        input_data: { ...restInput, superseded_node_id: prevNodeId ?? null },
        // This run's own request key is given back (see docstring); a route's own key stays.
        ...(isExecutionRequestKey(row.idempotency_key, executionId) ? { idempotency_key: null } : {}),
      })
      .eq("id", id)
      .in("status", ["pending", "processing"]) // CAS — don't trample a row that just finished
    if (renderCandidate) {
      // Pinned to the stamp we judged dead — a beat or a pickup since the read
      // rewrites it, and a render that came alive is never cancelled (see the
      // class-3 race note).
      const seen = row.provider_call_started_at
      cas = typeof seen === "string" ? cas.eq("provider_call_started_at", seen) : cas.is("provider_call_started_at", null)
    }
    const { data: upd, error: updErr } = await cas.select("id")

    if (updErr || !upd || upd.length === 0) {
      if (renderCandidate && !updErr) {
        const { data: now } = await readJobsWithSlotWait<InFlightRow>(
          "id, status, provider_kind, provider_call_started_at, created_at, started_at, usage_log_id, credits",
          (columns) => supabase.from("jobs").select(columns).eq("id", id).maybeSingle(),
        )
        if (now && isLiveRenderRow(now, Date.now())) {
          result.adoptable.set(nodeId, adoptedRender(now, budgetMs))
          adoptedRenders++
        }
      }
      continue
    }
    result.cancelled++
    // 554: the job's metered SIDE holds settle on their own call-start markers, after the flip.
    const { settleSideHoldsAfterFlip } = await import("../llm-side-hold.js")
    await settleSideHoldsAfterFlip([id])
    // R38 / N1: a not-started verdict committed nothing before the flip; now
    // that the row is cancelled, a worker that sent its first call in between
    // keeps its hold (kept and reported; it settles the hold when the call
    // ends), and a hold an earlier attempt billed is settled at its actual —
    // the refund below then touches only what is still reserved.
    if (metered === "not-started") {
      const { settleMeteredHoldAfterFlip } = await import("../cancel-job.js")
      if ((await settleMeteredHoldAfterFlip(id)) === "kept") continue
    }
    await refundReservedCreditsForJob(id).catch(() => {})
  }

  if (result.cancelled > 0 || result.adoptable.size > 0) {
    console.log(
      `[orchestrator/resume] execution ${executionId}: cancelled+refunded ${result.cancelled} ` +
      `stale job(s), ${result.adoptable.size - adoptedRenders} in-flight provider job(s) and ` +
      `${adoptedRenders} live budgeted render(s) marked for adoption`,
    )
  }
  return result
}
