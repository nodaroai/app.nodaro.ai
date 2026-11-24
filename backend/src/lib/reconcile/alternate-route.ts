/**
 * Recover a job a plugin's alternate route holds (provider_kind
 * "alternate-route", lib/alternate-route.ts) whose worker no longer waits on
 * it: a deploy drain, a crash, a run left past its read budget.
 *
 * The saved `provider_task_id` is `alt:<ref>`, the reference the route's `start`
 * returned. Recovery reads its status through the same plugin and NEVER starts
 * a task on the route:
 *   - done    → the shared recovered-generation delivery (`finalizeRecoveredMedia`),
 *               recording the route's own figure as the provider cost;
 *   - failed / expired (not charged) → the default request saved with the
 *               claim is sent to the default upstream, once (`resendDefault`:
 *               its claim swaps the held task id for a fresh token, so no
 *               other writer's compare-and-set can land after it), and the row
 *               moves to that upstream's kind, where its own recovery takes over;
 *   - done with no result file (charged) → never resent: left alone with one
 *               alert, until the age bound fails and refunds it;
 *   - running → bump `reconcile_attempts` (the inline re-pick reads on to its budget first);
 *   - claimed with no reference saved (the worker died around `start`) →
 *               past a grace, the same resend, with an alert: a task may exist;
 *   - no service in this process (every row of the kind, a bare claim
 *               included — never resent, never bumped), a status this process cannot read
 *               (`unreadable`), or no route named on the record → the row is LEFT
 *               ALONE, attempts not bumped, so the process that can read it
 *               recovers it. Past {@link ALTERNATE_ROUTE_UNREAD_LIMIT_MS} from its
 *               stamp it is failed and refunded, so no row lives forever.
 *
 * Every decision reads the row first, not the caller's snapshot: the cron and
 * a re-pick, and every environment's cron on the one database, can reach it.
 * Nothing here names an upstream beyond the default one it falls back to.
 */
import { supabase } from "../supabase.js"
import { FAILABLE_STATUSES, markJobFailed } from "../job-failure.js"
import { refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { isFinalizeJobType, type FinalizeClaimant } from "../job-finalize.js"
import { providerDetailOf, redactProviderDetail } from "../provider-error-detail.js"
import { userFacingMessage } from "../user-facing-error.js"
import {
  audioRefusedOf,
  inputImageRefusedOf,
  inputVideoRefusedOf,
  jobModelIdOf,
  promptRefusedOf,
  refusalHintFor,
  requestRefusedHintOf,
  safetyBlockOf,
  sentVideoInput,
  type ErrorHint,
} from "../safety-block.js"
import { DrainAbortError, isWorkerDraining } from "../worker-drain.js"
import { getPluginServices } from "../private-plugins/services-registry.js"
import type { PluginAlternateRoutePoll } from "../private-plugins/types.js"
import { randomUUID } from "node:crypto"
import {
  ALTERNATE_ROUTE_PROVIDER_KIND,
  ALTERNATE_ROUTE_RESENDING_PREFIX,
  isAlternateRouteResending,
  alternateRouteRecordOf,
  alternateRouteTaskRefOf,
  withAlternateRouteRecord,
  type AlternateRouteRecord,
} from "../alternate-route-request.js"
import { ALTERNATE_ROUTE_BUDGET_MS, ALTERNATE_ROUTE_MAX_READ_FAILURES, ALTERNATE_ROUTE_POLL_MS, noteDoneWithoutResult } from "../alternate-route.js"
import { KieError, MAX_POLL_ATTEMPTS, createKieTask, createUpstreamFailureError, isInputVideoRefusal } from "../../providers/kie/client.js"
import { deriveKieEgressDimensions } from "../../providers/kie/egress-dimensions.js"
import { bumpAttemptsOrExhaust } from "./bump-attempts.js"
import { finalizeRecoveredMedia, reconcileKieJob } from "./kie.js"
import { providerKindForVideoModel } from "./provider-kind.js"
import { STALE_THRESHOLD_MS } from "./types.js"
import { jobCostColumns } from "../job-cost-columns.js"

/** A row left alone (no service here, unreadable here) this long past its stamp is failed and refunded. */
export const ALTERNATE_ROUTE_UNREAD_LIMIT_MS = 2 * 60 * 60_000
/** A claim with no reference younger than this may still have its `start` in flight: left for a later look. */
export const ALTERNATE_ROUTE_CLAIM_GRACE_MS = 5 * 60_000
/** A resend younger than this is a reconciler still sending; an older one died, and the job is failed rather than sent again. */
export const ALTERNATE_ROUTE_RESEND_LIVE_MS = 2 * 60_000

/** `jobs.provider` recorded for a run the route delivered. */
const ALTERNATE_PROVIDER_USED = "alternate"

export interface AlternateRouteJobRow {
  id: string
  provider_task_id: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data?: Record<string, unknown> | null
}

interface CurrentRow {
  status: string
  job_type: string | null
  provider_kind: string | null
  provider_task_id: string | null
  provider_call_started_at: string | null
  reconcile_last_error: string | null
  input_data: Record<string, unknown> | null
}

async function readCurrent(jobId: string): Promise<CurrentRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("status, job_type, provider_kind, provider_task_id, provider_call_started_at, reconcile_last_error, input_data")
    .eq("id", jobId)
    .maybeSingle()
  if (error) {
    console.warn(`[reconcile/alternate-route] job ${jobId}: reading the row failed: ${error.message}`)
    return null
  }
  return (data as CurrentRow | null) ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function usd(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

function ageMs(stamp: string | null): number {
  const t = stamp ? Date.parse(stamp) : NaN
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY
}

function hintOf(err: unknown, input: Record<string, unknown> | null): ErrorHint | null {
  return refusalHintFor(
    safetyBlockOf(err, jobModelIdOf(input)),
    false,
    inputVideoRefusedOf(err) && sentVideoInput(input),
    inputImageRefusedOf(err),
    requestRefusedHintOf(err, input),
    promptRefusedOf(err),
    audioRefusedOf(err),
  )
}

/**
 * Fails and refunds the job for an upstream failure no fallback can follow. A
 * default-upstream error is kept as it was classified (its refusal flags feed
 * the hint); bare words go through the classifier that upstream's own poll uses.
 */
async function failForUpstream(jobId: string, failure: string | Error, input: Record<string, unknown> | null): Promise<void> {
  const err = failure instanceof KieError
    ? failure
    : (() => {
      const message = failure instanceof Error ? failure.message : failure
      return createUpstreamFailureError(message, "Video generation", { inputVideoRefused: isInputVideoRefusal(message) })
    })()
  const hint = hintOf(err, input)
  const flipped = await markJobFailed(jobId, {
    error_message: userFacingMessage(err, err.message),
    error_detail: providerDetailOf(err),
    reconcile_last_error: "upstream_failed",
    ...(hint ? { error_hint: hint } : {}),
  })
  if (flipped) await refundReservedCreditsForJob(jobId)
}

/**
 * Leaves the row for a process that can read it — attempts NOT bumped — until
 * it is {@link ALTERNATE_ROUTE_UNREAD_LIMIT_MS} past its stamp; then it is failed and refunded.
 */
async function leaveAlone(jobId: string, current: CurrentRow, why: string, opts?: { alert?: boolean }): Promise<void> {
  if (ageMs(current.provider_call_started_at) <= ALTERNATE_ROUTE_UNREAD_LIMIT_MS) return
  if (opts?.alert) console.error(`[ALERT] job ${jobId}: ${why}; failing and refunding it at the age bound.`)
  console.warn(`[reconcile/alternate-route] job ${jobId}: ${why} for over ${ALTERNATE_ROUTE_UNREAD_LIMIT_MS / 3_600_000} hours; failing and refunding it`)
  const flipped = await markJobFailed(jobId, {
    error_message: "This video could not be finished, and it will not be retried.",
    error_detail: `Alternate route task not readable: ${why}.`,
    reconcile_last_error: "alternate_route_unread",
  })
  if (flipped) await refundReservedCreditsForJob(jobId)
}

/**
 * Valid in any process. Never starts a task on the route; at most once per job
 * sends the saved default request (see the module doc).
 */
export async function reconcileAlternateRouteJob(
  row: AlternateRouteJobRow,
  opts?: {
    claimant?: FinalizeClaimant
    /** Keep reading a running task up to the worker's budget — the inline re-pick, inside a live queue handler. Without it: one read a tick (the cron). */
    pollToEnd?: boolean
  },
): Promise<void> {
  const current = await readCurrent(row.id)
  // The row moved on (another reconciler, a fallback, a finish): nothing to do.
  if (
    !current ||
    current.provider_kind !== ALTERNATE_ROUTE_PROVIDER_KIND ||
    current.provider_task_id === null ||
    current.provider_task_id !== row.provider_task_id ||
    !FAILABLE_STATUSES.includes(current.status)
  ) return
  const record = alternateRouteRecordOf(current.input_data)
  const service = getPluginServices().alternateRoutes
  if (!service) return leaveAlone(row.id, current, "no alternate route service in this process")

  if (isAlternateRouteResending(current.provider_task_id)) {
    // A resend holds the row. Live: its holder finishes it. Older: it died
    // between its claim and its move — never sent again; failed and refunded.
    if (record && Math.abs(Date.now() - record.at) < ALTERNATE_ROUTE_RESEND_LIVE_MS) return
    console.error(`[ALERT] job ${row.id}: a resend of the default request died after its claim; a default task may exist upstream (possible orphan paid task). Failing the job, not sending again.`)
    return failForUpstream(row.id, record?.message ?? "The alternate route ended and the default request could not be confirmed.", current.input_data)
  }

  const taskRef = alternateRouteTaskRefOf(current.provider_task_id)
  if (!taskRef) {
    // Claimed, no reference saved: the worker died around `start`. A start may
    // still be in flight on a worker that only lost its lock — left for a later look.
    if (ageMs(current.provider_call_started_at) < ALTERNATE_ROUTE_CLAIM_GRACE_MS) return
    console.error(`[ALERT] job ${row.id}: claimed for an alternate route with no task reference saved; a paid task may exist upstream (possible orphan paid task). Sending the default request.`)
    return resendDefault(row.id, current, record, "claimed-without-reference", "The alternate route was claimed but no task reference was saved.", opts)
  }
  if (!record?.routeId) return leaveAlone(row.id, current, "no route named on the record")

  const deadline = Date.now() + (opts?.pollToEnd ? ALTERNATE_ROUTE_BUDGET_MS : 0)
  let readFailures = 0
  let polled: PluginAlternateRoutePoll | undefined
  for (;;) {
    if (opts?.pollToEnd && isWorkerDraining()) throw new DrainAbortError()
    try {
      polled = await service.poll(record.routeId, taskRef)
      readFailures = 0
    } catch (err) {
      readFailures++
      console.warn(`[reconcile/alternate-route] job ${row.id}: status read failed: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
      if (!opts?.pollToEnd || readFailures >= ALTERNATE_ROUTE_MAX_READ_FAILURES || Date.now() >= deadline) {
        await bumpAttemptsOrExhaust(row.id, new Error("alternate route status read failed"))
        return
      }
      await sleep(ALTERNATE_ROUTE_POLL_MS)
      continue
    }
    if (polled?.state === "unreadable") return leaveAlone(row.id, current, "the task cannot be read in this process")
    if (polled?.state === "done" || polled?.state === "failed" || polled?.state === "expired") break
    if (!opts?.pollToEnd || Date.now() >= deadline) {
      await bumpAttemptsOrExhaust(row.id, new Error("alternate route task still in progress"))
      return
    }
    await sleep(ALTERNATE_ROUTE_POLL_MS)
  }

  if (polled?.state === "failed" || polled?.state === "expired") {
    return resendDefault(row.id, current, record, polled.state, polled.message, opts)
  }
  const done = polled as Extract<PluginAlternateRoutePoll, { state: "done" }>
  const url = typeof done.resultUrl === "string" && done.resultUrl.length > 0 ? done.resultUrl : undefined
  if (!url) {
    // `done` means charged: never resent. Left as it is (no bump) until the age
    // bound fails and refunds it; one alert per job.
    if (await noteDoneWithoutResult(row.id, current.provider_task_id, current.input_data, record)) {
      console.error(`[ALERT] job ${row.id}: alternate route task ${taskRef} reads done without a result file (it was charged); not sending the default request.`)
    }
    return leaveAlone(row.id, current, `alternate route task ${taskRef} read done without a result file`, { alert: true })
  }
  if (!isFinalizeJobType(row.job_type)) {
    await bumpAttemptsOrExhaust(row.id, new Error(`unknown job_type for finalize: ${row.job_type ?? "null"}`))
    return
  }
  const providerMs = usd(done.providerMs)
  await finalizeRecoveredMedia(
    {
      id: row.id,
      provider_kind: current.provider_kind,
      provider_task_id: current.provider_task_id,
      reconcile_attempts: row.reconcile_attempts,
      job_type: row.job_type,
      input_data: current.input_data,
    },
    row.job_type,
    {
      url,
      // The route's own figure; none reported leaves the planned figure saved with the reference.
      cost: usd(done.providerCostUsd) ?? null,
      providerUsed: ALTERNATE_PROVIDER_USED,
      ...(providerMs !== undefined ? { providerMs } : {}),
    },
    { claimant: opts?.claimant ?? "cron" },
  )
}

/**
 * Sends the default request saved with the claim to the default upstream,
 * once. The claim is ONE compare-and-set that replaces the held task id with a
 * fresh resend token (`alt:resending:<uuid>`), so from that moment every other
 * write keyed on the held value misses — a worker's fallback, its reference
 * save, a second reconciler's resend — and no writer can bring the old value
 * back. Then the send, then one compare-and-set on the token that moves the row
 * onto the default upstream's kind with the new task. A resend that dies after
 * its claim is never sent again (the token ages out and the job is failed and
 * refunded). With no saved request the job is failed and refunded.
 *
 * After the move the new task is read at once: polled to its end inline (a
 * re-pick inside a live queue handler), or stamped so the next cron tick reads
 * it instead of waiting out the kind's stale threshold.
 */
async function resendDefault(
  jobId: string,
  current: CurrentRow,
  record: AlternateRouteRecord | undefined,
  reason: string,
  upstreamMessage: string,
  opts?: { claimant?: FinalizeClaimant; pollToEnd?: boolean },
): Promise<void> {
  const held = current.provider_task_id as string
  const fallback = record?.fallback
  if (!record || !fallback) return failForUpstream(jobId, upstreamMessage, current.input_data)

  const token = `${ALTERNATE_ROUTE_RESENDING_PREFIX}${randomUUID()}`
  const resending: AlternateRouteRecord = { ...record, state: "resubmitting", at: Date.now(), reason, message: upstreamMessage }
  const { data: claimed, error: claimError } = await supabase
    .from("jobs")
    .update({ provider_task_id: token, input_data: withAlternateRouteRecord(current.input_data, resending) })
    .eq("id", jobId)
    .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
    .eq("provider_task_id", held)
    .in("status", [...FAILABLE_STATUSES])
    .select("id")
  if (claimError) console.warn(`[reconcile/alternate-route] job ${jobId}: claiming the resend failed: ${claimError.message}`)
  if (!claimed?.length) return

  const body = { ...fallback.body }
  let newTaskId: string
  try {
    newTaskId = (await createKieTask(fallback.taskModel, body, {
      modelKey: fallback.modelKey,
      dimensions: deriveKieEgressDimensions(body),
    })).taskId
  } catch (err) {
    console.warn(`[reconcile/alternate-route] job ${jobId}: sending the default request failed: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
    return failForUpstream(jobId, err instanceof Error ? err : String(err), current.input_data)
  }
  const kind = providerKindForVideoModel(fallback.modelKey)
  // The cron reads a row once it is past its kind's threshold: a resend the
  // cron made is stamped just past it, so the next tick reads the new task.
  const stampedAt = opts?.pollToEnd ? Date.now() : Date.now() - STALE_THRESHOLD_MS[kind] - 1_000
  const { data: moved, error: moveError } = await supabase
    .from("jobs")
    .update({
      provider_kind: kind,
      provider_task_id: newTaskId,
      provider_call_started_at: new Date(stampedAt).toISOString(),
      reconcile_attempts: 0,
      // A planned figure saved with the route's reference is not the default route's.
      ...(await jobCostColumns(null)),
      input_data: withAlternateRouteRecord(current.input_data, {
        state: "fell-back",
        at: Date.now(),
        reason,
        fallback,
        ...(record.routeId ? { routeId: record.routeId } : {}),
        ...(record.taskRef ? { taskRef: record.taskRef } : {}),
      }),
    })
    .eq("id", jobId)
    .eq("provider_task_id", token)
    .in("status", [...FAILABLE_STATUSES])
    .select("id")
  if (!moved?.length) {
    console.error(`[ALERT] job ${jobId}: default task ${newTaskId} was sent but the job moved on, so nothing waits on it (possible orphan paid task). ${moveError?.message ?? ""}`)
    return
  }
  console.warn(`[reconcile/alternate-route] job ${jobId}: alternate route ended (${reason}); sent the default request as task ${newTaskId}`)
  if (opts?.pollToEnd) {
    await reconcileKieJob(
      { id: jobId, provider_kind: kind, provider_task_id: newTaskId, reconcile_attempts: 0, job_type: current.job_type, input_data: current.input_data },
      { claimant: opts.claimant ?? "worker", pollAttempts: MAX_POLL_ATTEMPTS },
    )
  }
}
