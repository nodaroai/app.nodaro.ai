/**
 * Alternate routes (docs/design/alternate-routes.md): a deployment's plugin may
 * run a prepared video generation through another upstream it owns, at the
 * same price to the person. The plugin owns the rule and the upstream
 * (`PluginAlternateRoutesService`); this module owns the job.
 *
 * `takeAlternateRoute` is called by the video provider once the default
 * route's request is fully prepared, right before it is sent. It answers null
 * — "send the default request, unchanged" — or the run's result:
 *
 *   - No service registered ⇒ null at once: no read, no log, no write.
 *   - No `routeJob` on the call ⇒ null: the route is an explicit opt-in of the
 *     handler that owns the job, never read from ambient job context.
 *   - The body has a key the request table does not map, or the plugin's
 *     `accepts` says no ⇒ null.
 *   - The job is CLAIMED before `start` (a compare-and-set on
 *     `provider_task_id IS NULL`, the default request saved with the claim);
 *     the task reference replaces the claim. From then on a queue re-pick finds
 *     a task id and goes to the recovery (lib/reconcile/alternate-route.ts),
 *     which never starts a task.
 *   - Fallback (`start` refused, no answer, or the task failed or expired
 *     without being charged) is ONE compare-and-set that clears the claim and
 *     records the decision; only when it lands does the default request go out.
 *     A job that records a fallback never tries the route again.
 *   - A task still running when the budget runs out, a status that cannot be
 *     read here, or a fallback write that did not land ⇒
 *     `AlternateRoutePendingError`: the run is checked again by the recovery,
 *     and the default request is NOT sent.
 */
import { getPluginServices } from "./private-plugins/services-registry.js"
import type {
  PluginAlternateRoutePoll,
  PluginAlternateRoutesService,
} from "./private-plugins/types.js"
import { supabase } from "./supabase.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"
import { throwIfJobCancelled } from "./job-cancellation.js"
import { DrainAbortError, isWorkerDraining } from "./worker-drain.js"
import { redactProviderDetail } from "./provider-error-detail.js"
import { jobCostColumns } from "./job-cost-columns.js"
import {
  ALTERNATE_ROUTE_CLAIM_REF,
  ALTERNATE_ROUTE_KEY,
  ALTERNATE_ROUTE_PROVIDER_KIND,
  alternateRouteRecordOf,
  alternateRouteReference,
  alternateRouteRequestOf,
  alternateRouteTaskRefOf,
  withAlternateRouteRecord,
  type AlternateRouteRecord,
  type SavedDefaultRequest,
} from "./alternate-route-request.js"
import type { ProviderResult, ReconcileOpts } from "../providers/provider.interface.js"

/** How long the worker reads a running task before leaving it to the recovery. */
export const ALTERNATE_ROUTE_BUDGET_MS = 20 * 60_000
/** The read cadence when the plugin names none, and its bounds when it does. */
export const ALTERNATE_ROUTE_POLL_MS = 10_000
const MIN_POLL_MS = 1_000
const MAX_POLL_MS = 60_000
/** Status reads that may fail in a row before the worker leaves the task to the recovery. */
export const ALTERNATE_ROUTE_MAX_READ_FAILURES = 5
/**
 * `unreadable` answers the worker accepts in a row, one read cadence apart
 * (~40 s), before leaving its task to the recovery: a read right after the
 * task was created can miss it for a moment.
 */
export const ALTERNATE_ROUTE_MAX_UNREADABLE_READS = 4

/** The statuses a claim, a reference or a fallback may be written on: in flight and not parked. */
const LIVE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * A run left to the recovery: its task may still be running (or its status
 * cannot be read here), so the default request is not sent. NOT final: on a
 * non-final queue attempt the re-pick goes to the recovery (the row holds a
 * task id); on the final attempt the worker leaves the row for the reconcile
 * cron (workers/video-worker.ts).
 */
export class AlternateRoutePendingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AlternateRoutePendingError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isAlternateRoutePending(err: unknown): boolean {
  return err instanceof AlternateRoutePendingError
}

/**
 * The job was ended (or taken) by someone else while `start` ran: nothing may
 * be sent, and the row is left as it is. Final.
 */
export class AlternateRouteJobEndedError extends Error {
  readonly deterministic = true
  constructor(message: string) {
    super(message)
    this.name = "AlternateRouteJobEndedError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const PENDING_MESSAGE = "The video is still being made; it will be checked again."

export interface AlternateRouteRun {
  /** The catalog model id the run was priced on. */
  readonly provider: string
  /** The default upstream's task model. */
  readonly taskModel: string
  /** The default route's prepared request: read, never changed. */
  readonly body: Readonly<Record<string, unknown>>
  readonly reconcileOpts?: ReconcileOpts
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function usd(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

function errText(err: unknown): string {
  return redactProviderDetail(err instanceof Error ? err.message : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : String(err)) ?? "(no words)"
}

/** What a `start` rejection says about the upstream: only an explicit "none" is "nothing was created". */
function createdOf(err: unknown): "none" | "unknown" {
  return typeof err === "object" && err !== null && (err as { created?: unknown }).created === "none" ? "none" : "unknown"
}

interface JobRead {
  status?: string
  parent_job_id: string | null
  provider_kind: string | null
  provider_task_id: string | null
  input_data: Record<string, unknown> | null
}

async function readJob(jobId: string): Promise<JobRead | null> {
  // trash-read: a run's own lifecycle — what the job holds right now, deleted or not.
  const { data, error } = await supabase
    .from("jobs")
    .select("status, parent_job_id, provider_kind, provider_task_id, input_data")
    .eq("id", jobId)
    .maybeSingle()
  if (error) {
    console.warn(`[alternate-route] job ${jobId}: reading the job failed: ${error.message}`)
    return null
  }
  return (data as JobRead | null) ?? null
}

async function readParent(parentId: string | null): Promise<{ jobId: string; jobType: string } | null> {
  if (!parentId) return null
  // trash-read: the parent's type is part of the route's rule, whatever its state.
  const { data } = await supabase.from("jobs").select("job_type").eq("id", parentId).maybeSingle()
  const jobType = (data as { job_type?: unknown } | null)?.job_type
  return { jobId: parentId, jobType: typeof jobType === "string" ? jobType : "" }
}

/**
 * The one write before a fallback: the claim (or reference) this run holds is
 * cleared, the row goes back to the pickup kind with a fresh stamp, and the
 * decision is recorded. A compare-and-set on the exact value this run wrote:
 * true only when it landed — anything else and the default request must not go out.
 */
async function recordFallback(
  jobId: string,
  held: string,
  inputData: Record<string, unknown> | null,
  record: AlternateRouteRecord,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_kind: "pre-task",
        provider_task_id: null,
        provider_call_started_at: new Date().toISOString(),
        input_data: withAlternateRouteRecord(inputData, record),
        // A planned figure saved with the reference is not the default route's.
        ...(await jobCostColumns(null)),
      })
      .eq("id", jobId)
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .eq("provider_task_id", held)
      // Belt and braces: a recovery's resend claim already changed the task id
      // this compares on, and its record says so too.
      .neq(`input_data->${ALTERNATE_ROUTE_KEY}->>state`, "resubmitting")
      .in("status", [...LIVE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[alternate-route] job ${jobId}: recording the fallback failed: ${error.message}`)
      return false
    }
    return Array.isArray(data) && data.length > 0
  } catch (err) {
    console.warn(`[alternate-route] job ${jobId}: recording the fallback failed: ${errText(err)}`)
    return false
  }
}

/**
 * Records, once per job, that the route's task read done with no result file:
 * `done` means charged, so the run is never fallen back from; it stays the
 * recovery's until the age bound ends it. True when this caller recorded it
 * (and so should raise the one alert). A compare-and-set on the held task id.
 */
export async function noteDoneWithoutResult(
  jobId: string,
  held: string,
  inputData: Record<string, unknown> | null,
  record: AlternateRouteRecord,
): Promise<boolean> {
  if (record.doneWithoutResultAt !== undefined) return false
  try {
    const { data } = await supabase
      .from("jobs")
      .update({ input_data: withAlternateRouteRecord(inputData, { ...record, doneWithoutResultAt: Date.now() }) })
      .eq("id", jobId)
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .eq("provider_task_id", held)
      .in("status", [...LIVE_STATUSES])
      .select("id")
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/** Saves the task reference over the claim. "not-live": the row no longer holds this run's claim. */
async function saveReference(
  jobId: string,
  taskRef: string,
  plannedCostUsd: number | undefined,
  inputData: Record<string, unknown>,
): Promise<"saved" | "not-live" | "error"> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_task_id: alternateRouteReference(taskRef),
        provider_call_started_at: new Date().toISOString(),
        input_data: inputData,
        ...(plannedCostUsd !== undefined ? await jobCostColumns(plannedCostUsd) : {}),
      })
      .eq("id", jobId)
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .eq("provider_task_id", ALTERNATE_ROUTE_CLAIM_REF)
      .in("status", [...LIVE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[alternate-route] job ${jobId}: saving the task reference failed: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "saved" : "not-live"
  } catch (err) {
    console.warn(`[alternate-route] job ${jobId}: saving the task reference failed: ${errText(err)}`)
    return "error"
  }
}

/**
 * The default route's request, or the alternate route's result (see the
 * module doc). Throws `AlternateRoutePendingError` when the run must be left to
 * the recovery, `DrainAbortError` on a drain once the reference is saved, and
 * the cancel path's error on a cancel.
 */
export async function takeAlternateRoute(run: AlternateRouteRun): Promise<ProviderResult | null> {
  const service = getPluginServices().alternateRoutes
  if (!service) return null
  const routeJob = run.reconcileOpts?.routeJob
  if (!routeJob) return null
  const { jobId, jobType } = routeJob

  // Not offered at all: nothing read.
  if (!alternateRouteRequestOf(run.body, { jobId, jobType, model: run.provider, parent: null })) return null

  const row = await readJob(jobId)
  if (!row) return null
  const record = alternateRouteRecordOf(row.input_data)
  // A job that fell back never tries the route again.
  if (record?.state === "fell-back") return null
  if (row.provider_task_id) return resumeHeld(service, jobId, row, record)

  const req = alternateRouteRequestOf(run.body, { jobId, jobType, model: run.provider, parent: await readParent(row.parent_job_id) })
  if (!req) return null
  let routeId: string | undefined
  try {
    routeId = service.accepts(req)?.routeId
  } catch (err) {
    console.warn(`[alternate-route] job ${jobId}: accepts threw; taking the default route: ${errText(err)}`)
    return null
  }
  if (typeof routeId !== "string" || routeId.length === 0) return null

  // A job cancelled while it was checked is never started.
  await throwIfJobCancelled()
  const fallback: SavedDefaultRequest = { taskModel: run.taskModel, modelKey: run.provider, body: run.body }
  const claimedInput = withAlternateRouteRecord(row.input_data, { state: "claimed", at: Date.now(), routeId, fallback })
  const claimed = await claim(jobId, claimedInput)
  if (claimed === "error") return null
  if (claimed === "lost") {
    const now = await readJob(jobId)
    if (!now?.provider_task_id) return null
    return resumeHeld(service, jobId, now, alternateRouteRecordOf(now.input_data))
  }

  let started: { taskRef?: unknown; plannedCostUsd?: unknown } | undefined
  try {
    started = await service.start(routeId, req, { jobId })
  } catch (err) {
    const created = createdOf(err)
    if (created === "unknown") {
      console.error(`[ALERT] job ${jobId}: alternate route ${routeId} start got no answer; a paid task may exist upstream (possible orphan paid task). Falling back to the default route.`)
    } else {
      console.warn(`[alternate-route] job ${jobId}: route ${routeId} refused the run before creating a task; falling back: ${errText(err)}`)
    }
    return fallBack(jobId, ALTERNATE_ROUTE_CLAIM_REF, claimedInput, { state: "fell-back", at: Date.now(), routeId, reason: created === "none" ? "start-refused" : "start-unanswered", fallback })
  }
  const taskRef = typeof started?.taskRef === "string" && started.taskRef.length > 0 ? started.taskRef : undefined
  if (!taskRef) {
    console.error(`[ALERT] job ${jobId}: alternate route ${routeId} start resolved without a task reference; a paid task may exist upstream (possible orphan paid task). Falling back to the default route.`)
    return fallBack(jobId, ALTERNATE_ROUTE_CLAIM_REF, claimedInput, { state: "fell-back", at: Date.now(), routeId, reason: "start-without-reference", fallback })
  }
  const plannedCostUsd = usd(started?.plannedCostUsd)
  const runningInput = withAlternateRouteRecord(row.input_data, { state: "running", at: Date.now(), routeId, taskRef, fallback })
  let save = await saveReference(jobId, taskRef, plannedCostUsd, runningInput)
  if (save === "error") save = await saveReference(jobId, taskRef, plannedCostUsd, runningInput)
  if (save === "not-live") return refuseNotLive(jobId, routeId, taskRef)
  const saved = save === "saved"
  if (!saved) {
    console.error(`[ALERT] job ${jobId}: alternate route ${routeId} task ${taskRef} is running but its reference could not be saved yet; retrying the save while it is read.`)
  }
  return pollToResult(service, {
    jobId,
    routeId,
    taskRef,
    held: saved ? alternateRouteReference(taskRef) : ALTERNATE_ROUTE_CLAIM_REF,
    inputData: saved ? runningInput : claimedInput,
    saved,
    plannedCostUsd,
    fallback,
    ...(saved ? {} : { unsaved: { runningInput } }),
  })
}

/**
 * The task reference could not be saved because the row no longer holds this
 * run's claim. An ended job is final (nothing to deliver to); a job something
 * else now holds (a recovery resent it) is left to that holder — never failed
 * from here under a task that may be running.
 */
async function refuseNotLive(jobId: string, routeId: string, taskRef: string): Promise<never> {
  console.error(`[ALERT] job ${jobId}: the job was ended or taken while alternate route ${routeId} started task ${taskRef}; the task is not read and the row is left as it is (possible orphan paid task).`)
  const now = await readJob(jobId)
  if (now?.status && LIVE_STATUSES.includes(now.status)) throw new AlternateRoutePendingError(PENDING_MESSAGE)
  throw new AlternateRouteJobEndedError("This run was ended while it was being started.")
}

/**
 * A task this run started but could never record: no recovery can read it, so
 * leaving the run "for later" would have the recovery send the default request
 * beside it. Final instead — the job fails and is refunded — with an alert.
 */
function unrecordedTaskError(jobId: string, taskRef: string, why: string): Error {
  console.error(`[ALERT] job ${jobId}: alternate route task ${taskRef} ${why}, and its reference was never saved; failing the job rather than sending the default request beside it (possible orphan paid task).`)
  return Object.assign(new Error("This video could not be finished, and it will not be retried."), { deterministic: true as const })
}

/** The claim: a compare-and-set on a live row with no task id yet. */
async function claim(jobId: string, inputData: Record<string, unknown>): Promise<"claimed" | "lost" | "error"> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({
        provider_kind: ALTERNATE_ROUTE_PROVIDER_KIND,
        provider_task_id: ALTERNATE_ROUTE_CLAIM_REF,
        provider_call_started_at: new Date().toISOString(),
        input_data: inputData,
      })
      .eq("id", jobId)
      .is("provider_task_id", null)
      .in("status", [...LIVE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[alternate-route] job ${jobId}: claiming the job failed; taking the default route: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "claimed" : "lost"
  } catch (err) {
    console.warn(`[alternate-route] job ${jobId}: claiming the job failed; taking the default route: ${errText(err)}`)
    return "error"
  }
}

/**
 * A job that already holds a task id when the route is reached (a second run of
 * the lane in this process, or a lost claim): another kind's task is not this
 * module's (null — today's behaviour); this route's saved reference is read,
 * never started again; this route's claim with no reference may have a start
 * in flight, so it is left to the recovery.
 */
async function resumeHeld(
  service: PluginAlternateRoutesService,
  jobId: string,
  row: JobRead,
  record: AlternateRouteRecord | undefined,
): Promise<ProviderResult | null> {
  if (row.provider_kind !== ALTERNATE_ROUTE_PROVIDER_KIND) return null
  const taskRef = alternateRouteTaskRefOf(row.provider_task_id)
  if (!taskRef || !record?.routeId || !record.fallback) throw new AlternateRoutePendingError(PENDING_MESSAGE)
  console.warn(`[alternate-route] job ${jobId}: already started; reading task ${taskRef} instead of starting another`)
  return pollToResult(service, {
    jobId,
    routeId: record.routeId,
    taskRef,
    held: row.provider_task_id as string,
    inputData: row.input_data,
    saved: true,
    plannedCostUsd: undefined,
    fallback: record.fallback,
  })
}

async function fallBack(
  jobId: string,
  held: string,
  inputData: Record<string, unknown> | null,
  record: AlternateRouteRecord,
): Promise<null> {
  if (await recordFallback(jobId, held, inputData, record)) {
    console.warn(`[alternate-route] job ${jobId}: taking the default route (${record.reason ?? "fallback"})`)
    return null
  }
  // Not recorded: the row moved (a recovery, a cancel) or the write failed. The
  // default request must not go out beside whatever holds the row now.
  console.warn(`[alternate-route] job ${jobId}: the fallback could not be recorded; leaving the run to the recovery`)
  throw new AlternateRoutePendingError(PENDING_MESSAGE)
}

interface Polling {
  jobId: string
  routeId: string
  taskRef: string
  /** The `provider_task_id` this run holds (the reference, or the claim when the save failed). */
  held: string
  inputData: Record<string, unknown> | null
  saved: boolean
  plannedCostUsd: number | undefined
  fallback: SavedDefaultRequest
  /** Set while the reference is not saved: the save is retried on every read. */
  unsaved?: { runningInput: Record<string, unknown> }
}

function nextPollMs(polled: PluginAlternateRoutePoll | undefined): number {
  const asked = polled?.state === "running" ? polled.nextPollMs : undefined
  if (typeof asked !== "number" || !Number.isFinite(asked)) return ALTERNATE_ROUTE_POLL_MS
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, asked))
}

async function pollToResult(service: PluginAlternateRoutesService, polling: Polling): Promise<ProviderResult | null> {
  let p = polling
  const deadline = Date.now() + ALTERNATE_ROUTE_BUDGET_MS
  let readFailures = 0
  let unreadableReads = 0
  let doneWithoutResultNoted = false
  /** Leave the run to the recovery — or, when the reference was never saved, end it (see `unrecordedTaskError`). */
  const leave = (why: string): Error =>
    p.unsaved ? unrecordedTaskError(p.jobId, p.taskRef, why) : new AlternateRoutePendingError(PENDING_MESSAGE)
  for (;;) {
    if (p.unsaved) {
      const save = await saveReference(p.jobId, p.taskRef, p.plannedCostUsd, p.unsaved.runningInput)
      if (save === "saved") {
        p = { ...p, held: alternateRouteReference(p.taskRef), inputData: p.unsaved.runningInput, saved: true, unsaved: undefined }
      } else if (save === "not-live") {
        return refuseNotLive(p.jobId, p.routeId, p.taskRef)
      }
    }
    // A cancel ends the job through the cancel path (refunded there).
    await throwIfJobCancelled()
    // A drain hands the job back once a re-pick can find the task.
    if (p.saved && isWorkerDraining()) throw new DrainAbortError()
    let polled: PluginAlternateRoutePoll | undefined
    try {
      polled = await service.poll(p.routeId, p.taskRef)
      readFailures = 0
    } catch (err) {
      readFailures++
      console.warn(`[alternate-route] job ${p.jobId}: status read ${readFailures} of task ${p.taskRef} failed: ${errText(err)}`)
      if (readFailures >= ALTERNATE_ROUTE_MAX_READ_FAILURES) throw leave("stopped answering")
    }
    if (polled?.state === "done") {
      const url = typeof polled.resultUrl === "string" && polled.resultUrl.length > 0 ? polled.resultUrl : undefined
      if (!url) {
        // `done` means charged: never fall back from it. Keep reading (the file
        // may yet appear); the recovery's age bound ends a run that never has one.
        if (!doneWithoutResultNoted) {
          doneWithoutResultNoted = true
          const record = alternateRouteRecordOf(p.inputData) ?? { state: "running" as const, at: Date.now(), routeId: p.routeId, taskRef: p.taskRef, fallback: p.fallback }
          if (!p.saved || await noteDoneWithoutResult(p.jobId, p.held, p.inputData, record)) {
            console.error(`[ALERT] job ${p.jobId}: alternate route ${p.routeId} task ${p.taskRef} reads done without a result file (it was charged); not falling back, still reading.`)
          }
        }
        if (Date.now() >= deadline) throw leave("read done without a result file")
        await sleep(ALTERNATE_ROUTE_POLL_MS)
        continue
      }
      const providerMs = usd(polled.providerMs)
      return {
        url,
        cost: usd(polled.providerCostUsd) ?? p.plannedCostUsd ?? null,
        ...(providerMs !== undefined ? { providerMs } : {}),
        routedVia: p.routeId,
      }
    }
    if (polled?.state === "failed" || polled?.state === "expired") {
      console.warn(`[alternate-route] job ${p.jobId}: task ${p.taskRef} ${polled.state}: ${redactProviderDetail(polled.message) ?? "(no words)"}`)
      return fallBack(p.jobId, p.held, p.inputData, { state: "fell-back", at: Date.now(), routeId: p.routeId, taskRef: p.taskRef, reason: polled.state, fallback: p.fallback })
    }
    if (polled?.state === "unreadable") {
      unreadableReads++
      if (unreadableReads >= ALTERNATE_ROUTE_MAX_UNREADABLE_READS || Date.now() >= deadline) {
        console.warn(`[alternate-route] job ${p.jobId}: task ${p.taskRef} cannot be read in this process; leaving it to the recovery`)
        throw leave("cannot be read in this process")
      }
      await sleep(ALTERNATE_ROUTE_POLL_MS)
      continue
    }
    unreadableReads = 0
    if (Date.now() >= deadline) throw leave("did not finish within the read budget")
    await sleep(nextPollMs(polled))
  }
}
