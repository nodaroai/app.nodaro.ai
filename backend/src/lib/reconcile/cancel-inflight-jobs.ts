import { supabase } from "../supabase.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { declaredJobBudgetMs } from "../job-budget.js"
import type { AdoptedJobClocks } from "../../services/workflow-engine/types.js"
import { STALE_THRESHOLD_MS } from "./types.js"

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
  /** Orchestrator RESUME only: adopt a budgeted render whose worker is still
   *  heartbeating (class 3 below) instead of cancelling it. Off for the
   *  component-timeout cleanup, where the parent has given up on the inner run
   *  and cancelling it is the point. */
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

function adoptedRender(row: InFlightRow, budgetMs: number): AdoptableChildJob {
  return {
    jobId: row.id as string,
    usageLogId: typeof row.usage_log_id === "string" ? row.usage_log_id : undefined,
    creditsReserved: typeof row.credits === "number" ? row.credits : undefined,
    budgetMs,
    clocks: { dispatchedAtMs: epochMs(row.created_at), processingStartedAtMs: epochMs(row.started_at) },
  }
}

/**
 * Neutralize every still-in-flight (pending/processing) child job of an
 * execution. Called by the orchestrator at the start of a (re-)pick, AFTER
 * reconcileNodeStatesFromJobs + carry-forward have decided which nodes are done.
 *
 * Three classes:
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
  opts: CancelInFlightOptions = {},
): Promise<NeutralizeResult> {
  const result: NeutralizeResult = { cancelled: 0, adoptable: new Map() }
  const { data: inFlight, error: selErr } = await supabase
    .from("jobs")
    .select("id, status, input_data, provider_task_id, provider_kind, provider_call_started_at, created_at, started_at, usage_log_id, credits, job_type")
    .eq("workflow_execution_id", executionId)
    .in("status", ["pending", "processing"])

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

    // Class 3 — a budgeted render its worker is still running. `renderCandidate`
    // also governs the pinned cancel below: only a row that COULD be adopted
    // needs protecting from a cancel that races its heartbeat.
    const renderCandidate =
      opts.adoptLiveBudgetedRenders === true && budgetMs !== undefined && nodeId !== null && singleShot &&
      !result.adoptable.has(nodeId)
    if (renderCandidate && isLiveRenderRow(row, Date.now())) {
      result.adoptable.set(nodeId, adoptedRender(row, budgetMs))
      adoptedRenders++
      continue
    }

    // Class 1 — cancel + refund (pre-provider, fan-out iteration, orphan, or a
    // render whose worker is gone).
    const { node_id: prevNodeId, ...restInput } = prevInput
    let cas = supabase
      .from("jobs")
      .update({
        status: "cancelled",
        error_message: "Superseded by orchestrator resume (stale in-flight attempt)",
        completed_at: new Date().toISOString(),
        // node_id stripped (see docstring); keep the original for traceability.
        input_data: { ...restInput, superseded_node_id: prevNodeId ?? null },
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
        const { data: now } = await supabase
          .from("jobs")
          .select("id, status, provider_kind, provider_call_started_at, created_at, started_at, usage_log_id, credits")
          .eq("id", id)
          .maybeSingle()
        if (now && isLiveRenderRow(now, Date.now())) {
          result.adoptable.set(nodeId, adoptedRender(now, budgetMs))
          adoptedRenders++
        }
      }
      continue
    }
    result.cancelled++
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
