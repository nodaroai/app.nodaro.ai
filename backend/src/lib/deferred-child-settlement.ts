import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { heldCommitArgs, type HeldCommitReplay } from "./job-policy.js"
import { coveredMarkOf } from "./covered-step.js"
import { getAppSettings } from "./app-settings.js"
import { commitJobCredits, refundLoopTrimAddon } from "../workers/shared.js"
import { DEFER_SETTLEMENT_INPUT_KEY } from "./deferred-child-request.js"
import { refundUsageLogConfirmed } from "./credits-job-lifecycle.js"
import { IN_FLIGHT_JOB_STATUSES } from "./job-status.js"

/**
 * DEFERRED CHILD SETTLEMENT — a plugin's engine child that stays HELD after it
 * completes.
 *
 * A private plugin's run makes its steps as child jobs (`tk.http.workerRequest`),
 * and every child reserves credits and settles them when it finishes. The
 * platform can only give back a reservation that is still open (`refund_credits`
 * works on a `reserved` usage log; nothing refunds a committed one). A plugin
 * that may throw a take away after looking at it (Video Remake's face check)
 * therefore asks for its engine child to be DEFERRED: the child completes as
 * usual (status, output, `credits_actual` showing what it will cost) but its
 * usage log stays `reserved` until the plugin says
 *  - settle  (`tk.jobs.settleDeferredChild`): committed exactly as its worker
 *    would have committed it at completion, from the same replay the review
 *    approve uses (`HeldCommitReplay` + `heldCommitArgs`), or
 *  - release (`tk.jobs.releaseDeferredChild`): refunded through the atomic
 *    `refund_credits` RPC (payer-aware), recorded with its reason, and
 *    `credits_actual` 0.
 * The sweep (`deferred-child-settlement-sweep.ts`) resolves any child the
 * plugin left held, by its parent's state; a delete of the child's run
 * releases it first (`releaseHeldChildrenBeforeDelete`).
 *
 * WHERE THE STATE LIVES (no new column, so staging — which runs ahead of the
 * shared database's migrations — needs none):
 *  - the request: `input_data.__deferSettlement: true` (lib/deferred-child-request.ts);
 *  - the replay, the decision and whether money is still open:
 *    `held_completion_fields.deferredSettlement`. That column is outside the
 *    `authenticated` grant and never on Realtime, and a child job is never
 *    hold-eligible (job-policy-gate.ts), so on a child it is free; every other
 *    reader of it is gated on `status = 'pending_review'`. `open` is true until
 *    the log is confirmed no longer `reserved` (migration 693 indexes the open
 *    ones, so the sweep reads only those).
 *
 * THE USAGE LOG IS THE TRUTH. Commit and refund are each exactly-once by their
 * own compare-and-set on `usage_logs.status = 'reserved'`. The row's decision
 * is claimed first (a CAS on `deferredSettlement.state = 'held'`), so a settle
 * and a release never both act; the row is closed only once the log confirms
 * the outcome, and any child whose row and log disagree is healed.
 */

/** The key inside `held_completion_fields` that holds the record. */
export const DEFERRED_SETTLEMENT_KEY = "deferredSettlement"

export type DeferredSettlementState = "held" | "settled" | "released"

export interface DeferredSettlementRecord {
  readonly version: 1
  readonly state: DeferredSettlementState
  /** True until the usage log is confirmed settled (committed or refunded). */
  readonly open: boolean
  /** The settlement inputs finalize built, replayed verbatim on settle. */
  readonly commit: HeldCommitReplay
  /** The provider USD cost finalize had on hand (`result.cost`). */
  readonly providerCost: number | null
  readonly deferredAt: string
  readonly decidedAt?: string
  readonly decidedBy?: "plugin" | "sweep" | "delete"
  /** Why it was released (the plugin's words, or the platform's). */
  readonly reason?: string
}

/**
 * What a settle or release did, as `tk.jobs.settleDeferredChild` /
 * `releaseDeferredChild` answer it:
 *  - `settled` / `released`: the child ends so (now, or already);
 *  - `not_deferred`: not a deferred child, or it did not complete (a failed
 *    child is refunded by its failure path);
 *  - `already_decided`: the other decision was taken first; nothing was done;
 *  - `scheduled`: a release asked before the child completed; it is released
 *    when it completes (a failed child is refunded by its failure path);
 *  - `pending`: the decision is recorded but the commit or refund did not land;
 *    the sweep retries it.
 */
export type DeferredSettleOutcome = "settled" | "released" | "scheduled" | "not_deferred" | "already_decided" | "pending"

/**
 * A release asked for BEFORE the child completed (its run failed or timed out
 * while the engine was still working): `input_data.__deferredRelease =
 * { reason, at }`, server-only. Not in `held_completion_fields`, because the
 * completion writes that column whole. The completion releases the child at
 * once (`releaseIfScheduled`, from finalize), the sweep backs it up, and a
 * child that FAILS instead is refunded by its failure path alone.
 */
export const DEFERRED_RELEASE_INPUT_KEY = "__deferredRelease"

/** The live statuses a release can be scheduled on (a child is never held for review). */
const LIVE_STATUSES = IN_FLIGHT_JOB_STATUSES

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The most of a release reason that is kept. */
const MAX_REASON_CHARS = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Whether a job row asked for a deferred settlement (and can have one). */
export function isDeferredSettlementJob(row: {
  parent_job_id?: string | null
  input_data: Record<string, unknown> | null
}): boolean {
  return hasCredits() && typeof row.parent_job_id === "string" && row.input_data?.[DEFER_SETTLEMENT_INPUT_KEY] === true
}

/** The record on a row, or null when it has none (a job that was not deferred). */
export function deferredSettlementOf(heldCompletionFields: unknown): DeferredSettlementRecord | null {
  if (!isRecord(heldCompletionFields)) return null
  const rec = heldCompletionFields[DEFERRED_SETTLEMENT_KEY]
  if (!isRecord(rec)) return null
  if (rec.state !== "held" && rec.state !== "settled" && rec.state !== "released") return null
  return rec as unknown as DeferredSettlementRecord
}

/**
 * Finalize's step-5 settlement, shared verbatim with a deferred child's settle
 * so the two cannot drift: the loop-trim add-on comes off (reserved − add-on)
 * when the smart-loop-cut failed on a single-node run, else the commit
 * through `heldCommitArgs` — the mapping the review approve replays too.
 */
export async function settleFinalizedJobCredits(args: {
  jobId: string
  usageLogId: string | null
  workflowExecutionId: string | null
  commit: HeldCommitReplay
  providerCost: number | null | undefined
}): Promise<void> {
  const loopTrimRefund = args.commit.loopTrimAddonRefundCredits ?? 0
  if (args.commit.meteredBaseCredits == null && loopTrimRefund > 0 && !args.workflowExecutionId) {
    await refundLoopTrimAddon(args.jobId, args.usageLogId, loopTrimRefund)
  } else {
    await commitJobCredits(args.usageLogId, args.jobId, ...heldCommitArgs(args.commit, args.providerCost))
  }
}

/**
 * What {@link settleFinalizedJobCredits} would commit for this log, without
 * committing: the figure a deferred child shows as `credits_actual` while it
 * is held. DISPLAY ONLY — the settle overwrites it with what it commits. The
 * same branches `commitJobCredits` takes (a covered step → 0; a metered USD
 * cost → its actual plus the add-on, also with `collectOverHold`, where the
 * settle charges that actual above the hold when the payer can pay it; a
 * count-based measure → its marked-up base, never above the reservation;
 * otherwise the reservation). A parity test holds it to the real settle.
 * Undefined when it cannot be told (a managed reservation, which settles
 * itself, or an unreadable log).
 */
export async function plannedCommitCredits(
  usageLogId: string,
  commit: HeldCommitReplay,
  providerCost: number | null,
  workflowExecutionId: string | null,
): Promise<number | undefined> {
  const { data: log, error } = await supabase
    .from("usage_logs")
    .select("credits_used, action, metadata")
    .eq("id", usageLogId)
    .maybeSingle()
  if (error || !log) return undefined
  const row = log as { credits_used?: unknown; action?: unknown; metadata?: unknown }
  const reserved = typeof row.credits_used === "number" ? row.credits_used : undefined
  const action = typeof row.action === "string" ? row.action : ""
  if (isRecord(row.metadata) && row.metadata.reservation_mode === "job-once") return undefined
  if (coveredMarkOf(row.metadata)) return 0
  const loopTrimRefund = commit.loopTrimAddonRefundCredits ?? 0
  if (commit.meteredBaseCredits == null && loopTrimRefund > 0 && !workflowExecutionId) {
    return reserved === undefined ? undefined : Math.max(0, reserved - loopTrimRefund)
  }
  const [cost, extra, metered] = heldCommitArgs(commit, providerCost)
  if (metered && cost && cost > 0) {
    const { computeActualCredits } = await import("../ee/billing/credit-anomaly.js")
    return (await computeActualCredits(cost, action || undefined)) + Math.max(0, extra ?? 0)
  }
  if (metered && (extra ?? 0) > 0) {
    const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
    const markedUp = applyServiceMarkup(Math.max(0, extra ?? 0), await getAppSettings(), action)
    return reserved !== undefined ? Math.min(markedUp, reserved) : markedUp
  }
  return reserved
}

/**
 * The completion columns of a deferred child: its record (state `held`, open)
 * and the `credits_actual` it will cost. Written in finalize's completion CAS,
 * so the job is never completed without them.
 */
export async function deferredCompletionFields(args: {
  usageLogId: string
  commit: HeldCommitReplay
  providerCost: number | null
  workflowExecutionId: string | null
}): Promise<Record<string, unknown>> {
  const record: DeferredSettlementRecord = {
    version: 1,
    state: "held",
    open: true,
    commit: args.commit,
    providerCost: args.providerCost,
    deferredAt: new Date().toISOString(),
  }
  let planned: number | undefined
  try {
    planned = await plannedCommitCredits(args.usageLogId, args.commit, args.providerCost, args.workflowExecutionId)
  } catch (err) {
    console.warn(`[deferred-settlement] could not tell what log ${args.usageLogId} will cost: ${err instanceof Error ? err.message : String(err)}`)
  }
  return {
    held_completion_fields: { [DEFERRED_SETTLEMENT_KEY]: record },
    ...(planned !== undefined ? { credits_actual: planned } : {}),
  }
}

// ── resolving a held child ──────────────────────────────────────────────────

export interface DeferredChildRow {
  id: string
  status: string
  input_data: Record<string, unknown> | null
  user_id: string | null
  parent_job_id: string | null
  workflow_execution_id: string | null
  held_completion_fields: Record<string, unknown> | null
  credits_actual: number | null
  billing_force_refund: boolean | null
}

const CHILD_COLUMNS = "id, status, input_data, user_id, parent_job_id, workflow_execution_id, held_completion_fields, credits_actual, billing_force_refund"

export async function readDeferredChild(jobId: string): Promise<DeferredChildRow | null> {
  // trash-read: the platform's own settlement of a job it holds credits for.
  const { data, error } = await supabase.from("jobs").select(CHILD_COLUMNS).eq("id", jobId).maybeSingle()
  if (error) throw new Error(`Failed to read job ${jobId}: ${error.message}`)
  return (data as DeferredChildRow | null) ?? null
}

type LogTruth = { kind: "reserved"; id: string } | { kind: "committed" } | { kind: "refunded" } | { kind: "none" }

/** Where the job's money stands: an open hold first, else what its logs ended as. */
export async function readLogTruth(jobId: string): Promise<LogTruth> {
  const { data, error } = await supabase.from("usage_logs").select("id, status").eq("job_id", jobId)
  if (error) throw new Error(`Failed to read the usage logs of job ${jobId}: ${error.message}`)
  const logs = (data ?? []) as Array<{ id: string; status: string }>
  const open = logs.find((l) => l.status === "reserved")
  if (open) return { kind: "reserved", id: open.id }
  if (logs.some((l) => l.status === "committed")) return { kind: "committed" }
  if (logs.some((l) => l.status === "refunded")) return { kind: "refunded" }
  return { kind: "none" }
}

/**
 * Write the record's new value, only while its state still reads `from` (a
 * CAS). A release that is confirmed (`released`) zeroes the job's charge and
 * marks it a platform refund in the same write.
 */
async function casRecord(
  row: DeferredChildRow,
  rec: DeferredSettlementRecord,
  from: DeferredSettlementState,
  next: Partial<DeferredSettlementRecord>,
  released: boolean,
): Promise<boolean> {
  const updated: DeferredSettlementRecord = { ...rec, ...next }
  const { data, error } = await supabase
    .from("jobs")
    .update({
      held_completion_fields: { ...(row.held_completion_fields ?? {}), [DEFERRED_SETTLEMENT_KEY]: updated },
      ...(released ? { credits_actual: 0, billing_force_refund: true } : {}),
    })
    .eq("id", row.id)
    .eq("status", "completed")
    .eq(`held_completion_fields->${DEFERRED_SETTLEMENT_KEY}->>state`, from)
    .select("id")
  if (error) throw new Error(`Failed to record the settlement of job ${row.id}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/**
 * Close a record whose log is no longer `reserved`, agreeing with it: a
 * committed log reads `settled`, a refunded one `released` (charge 0). A log
 * another path settled is reported, never undone. Answers the state it ends in,
 * or null when the job has no log at all.
 */
async function closeToLog(row: DeferredChildRow, rec: DeferredSettlementRecord, truth: LogTruth, by: DeferredSettlementRecord["decidedBy"]): Promise<"settled" | "released" | null> {
  if (truth.kind === "reserved") return null
  const ends = truth.kind === "committed" ? "settled" : truth.kind === "refunded" ? "released" : null
  if (ends === null) return null
  if (rec.state === "released" && ends === "settled") console.error(`[ALERT] [deferred-settlement] job ${row.id} was released but its hold ended committed — left charged`)
  const needsWrite = rec.open !== false || rec.state !== ends
    || (ends === "released" && (row.credits_actual !== 0 || row.billing_force_refund !== true))
  if (needsWrite) {
    await casRecord(row, rec, rec.state, {
      state: ends,
      open: false,
      decidedAt: rec.decidedAt ?? new Date().toISOString(),
      decidedBy: rec.decidedBy ?? by,
      ...(ends === "released" && rec.reason === undefined ? { reason: "the hold was refunded by another path" } : {}),
    }, ends === "released")
  }
  return ends
}

/**
 * Settle or release ONE held child. Idempotent, and safe against a concurrent
 * settle/release/sweep/delete: the decision is claimed on the row first, the
 * money moves through the log's own compare-and-set, and the row is closed
 * only on what the log confirms. Never refunds a committed log.
 */
export async function resolveDeferredChild(
  childJobId: string,
  decision: "settled" | "released",
  opts: { reason?: string; by: "plugin" | "sweep" | "delete" },
): Promise<DeferredSettleOutcome> {
  if (!hasCredits()) return "not_deferred"
  let row = await readDeferredChild(childJobId)
  if (!row) return "not_deferred"
  if (row.status !== "completed") {
    if (decision === "settled") return scheduledReleaseOf(row.input_data) ? "already_decided" : "not_deferred"
    return scheduleRelease(row, opts)
  }
  let rec = deferredSettlementOf(row.held_completion_fields)
  if (!rec) return "not_deferred"
  // A release scheduled before completion wins over a later settle: the run
  // already discarded this take.
  const scheduled = scheduledReleaseOf(row.input_data)
  if (scheduled && decision === "settled" && rec.state === "held") {
    const done = await resolveDeferredChild(childJobId, "released", { reason: scheduled.reason, by: scheduled.by })
    return done === "pending" ? "pending" : "already_decided"
  }

  const truth = await readLogTruth(childJobId)
  if (truth.kind !== "reserved") {
    const ends = await closeToLog(row, rec, truth, opts.by)
    if (ends === null) return "not_deferred"
    return ends === decision ? ends : "already_decided"
  }

  if (rec.state === "held") {
    const reason = decision === "released" ? (opts.reason ?? "").trim().slice(0, MAX_REASON_CHARS) || "released" : undefined
    const claimed = await casRecord(row, rec, "held", {
      state: decision,
      decidedAt: new Date().toISOString(),
      decidedBy: opts.by,
      ...(reason !== undefined ? { reason } : {}),
    }, false)
    row = await readDeferredChild(childJobId)
    rec = row ? deferredSettlementOf(row.held_completion_fields) : null
    if (!row || !rec || rec.state === "held") return "pending"
    if (!claimed && rec.state !== decision) return "already_decided"
  }
  if (rec.state !== decision) return "already_decided"

  if (decision === "settled") {
    await settleFinalizedJobCredits({
      jobId: row.id,
      usageLogId: truth.id,
      workflowExecutionId: row.workflow_execution_id,
      commit: rec.commit ?? {},
      providerCost: rec.providerCost,
    })
  } else {
    // The atomic, payer-aware refund (`refund_credits`), confirmed by a read.
    await refundUsageLogConfirmed(truth.id)
  }

  const after = await readLogTruth(childJobId)
  if (after.kind === "reserved") {
    console.error(`[deferred-settlement] job ${row.id}: ${decision} is recorded but its hold is still open — the sweep retries`)
    return "pending"
  }
  const ends = await closeToLog(row, rec, after, opts.by)
  return ends === decision ? decision : "already_decided"
}

/** A child's scheduled release, or null. */
export function scheduledReleaseOf(inputData: unknown): { reason: string; by: "plugin" | "sweep" | "delete" } | null {
  if (!isRecord(inputData)) return null
  const marker = inputData[DEFERRED_RELEASE_INPUT_KEY]
  if (!isRecord(marker)) return null
  return { reason: typeof marker.reason === "string" ? marker.reason : "released", by: "plugin" }
}

/**
 * Record a release on a deferred child that has not completed yet. Written
 * only while it is still live (a CAS on its status), then read back: a child
 * that completed meanwhile is released now (its completion may have missed
 * the marker); one that failed or was cancelled is its failure path's, which
 * refunds it once.
 */
async function scheduleRelease(row: DeferredChildRow, opts: { reason?: string; by: "plugin" | "sweep" | "delete" }): Promise<DeferredSettleOutcome> {
  if (row.input_data?.[DEFER_SETTLEMENT_INPUT_KEY] !== true) return "not_deferred"
  // A failed or cancelled child is its failure path's (refunded once, there).
  if (!(LIVE_STATUSES as readonly string[]).includes(row.status)) return "not_deferred"
  if (scheduledReleaseOf(row.input_data)) return "scheduled"
  const reason = (opts.reason ?? "").trim().slice(0, MAX_REASON_CHARS) || "released"
  const { error } = await supabase
    .from("jobs")
    .update({ input_data: { ...(row.input_data ?? {}), [DEFERRED_RELEASE_INPUT_KEY]: { reason, at: new Date().toISOString() } } })
    .eq("id", row.id)
    .in("status", [...LIVE_STATUSES])
  if (error) throw new Error(`Failed to schedule the release of job ${row.id}: ${error.message}`)
  const after = await readDeferredChild(row.id)
  if (!after) return "not_deferred"
  if (after.status === "completed") {
    if (!scheduledReleaseOf(after.input_data)) {
      // Completed before the marker landed (the CAS matched no row): an ordinary release.
      return resolveDeferredChild(row.id, "released", { reason, by: opts.by })
    }
    const done = await resolveDeferredChild(row.id, "released", { reason, by: opts.by })
    return done === "released" ? "released" : done
  }
  return scheduledReleaseOf(after.input_data) ? "scheduled" : "not_deferred"
}

/**
 * Finalize's call right after a deferred child completed held: a release the
 * plugin scheduled while it ran is carried out now. Never throws (the sweep
 * backs it up).
 */
export async function releaseIfScheduled(jobId: string): Promise<void> {
  try {
    const row = await readDeferredChild(jobId)
    const scheduled = row ? scheduledReleaseOf(row.input_data) : null
    if (!scheduled) return
    await resolveDeferredChild(jobId, "released", { reason: scheduled.reason, by: scheduled.by })
  } catch (err) {
    console.error(`[deferred-settlement] the scheduled release of job ${jobId} did not run — the sweep retries:`, err instanceof Error ? err.message : err)
  }
}

/**
 * The caller's own child, or a throw: the plugin's running job
 * (`callerJobId`, the job whose handler is running — `getJobId()`) must be
 * the child's parent. A plugin can never settle or release a job that is not
 * its own child.
 */
export async function assertOwnDeferredChild(callerJobId: string | undefined, childJobId: string, callerUserId: string | undefined): Promise<void> {
  if (callerJobId === undefined) throw new Error("A deferred child can only be settled or released from its parent job's handler")
  if (typeof childJobId !== "string" || !JOB_ID.test(childJobId)) throw new Error("childJobId must be a job id")
  const row = await readDeferredChild(childJobId)
  if (!row || row.parent_job_id !== callerJobId || (callerUserId !== undefined && row.user_id !== callerUserId)) {
    throw new Error(`Job ${childJobId} is not a child of the running job`)
  }
}

// ── the open children (the sweep and the delete read them) ──────────────────

export interface OpenDeferredChild {
  id: string
  input_data: Record<string, unknown> | null
  parent_job_id: string | null
  workflow_id: string | null
  user_id: string | null
  completed_at: string | null
  held_completion_fields: Record<string, unknown> | null
  credits_actual: number | null
  billing_force_refund: boolean | null
}

const OPEN_PAGE = 200

/**
 * Every deferred child whose money is still open (the `open` flag, which
 * migration 693's partial index covers), oldest first. Null when the read failed.
 */
export async function listOpenDeferredChildren(): Promise<OpenDeferredChild[] | null> {
  const out: OpenDeferredChild[] = []
  for (let from = 0; ; from += OPEN_PAGE) {
    // trash-read: a held step in the Trash still holds credits that must be settled or released.
    const { data, error } = await supabase
      .from("jobs")
      .select("id, input_data, parent_job_id, workflow_id, user_id, completed_at, held_completion_fields, credits_actual, billing_force_refund")
      .eq(`held_completion_fields->${DEFERRED_SETTLEMENT_KEY}->>open`, "true")
      .order("completed_at", { ascending: true })
      .range(from, from + OPEN_PAGE - 1)
    if (error) {
      console.error(`[deferred-settlement] listing the open held children failed: ${error.message}`)
      return null
    }
    const rows = (data ?? []) as OpenDeferredChild[]
    out.push(...rows)
    if (rows.length < OPEN_PAGE) return out
  }
}
