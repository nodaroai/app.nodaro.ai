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
import { stopsAtSegmentBoundary } from "./stop-rule.js"
import { getPluginServices, pluginServicesLoaded } from "./private-plugins/services-registry.js"
import type {
  PluginAlternateRoutePoll,
  PluginAlternateRouteRequest,
  PluginAlternateRoutesService,
} from "./private-plugins/types.js"
import { supabase } from "./supabase.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"
import { beginPlannedVideoSegment } from "./video-send-start.js"
import { getJobId, throwIfJobCancelled } from "./job-cancellation.js"
import { readRouteLedger, recordRouteStart, recordRouteStartRef, recordRouteTask, recordRouteTaskOutcome, routeCostBasisOf, verifiedReportedUsd, type RouteCostBasis } from "./video-route-ledger.js"
import { DrainAbortError, isWorkerDraining } from "./worker-drain.js"
import { redactProviderDetail } from "./provider-error-detail.js"
import { jobCostColumns } from "./job-cost-columns.js"
import {
  ALTERNATE_ROUTE_CLAIM_REF,
  ALTERNATE_ROUTE_DRAFT_MESSAGE,
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
import { hasCredits } from "./config.js"
import { isRoutableVideoModel } from "./video-route-policy.js"
import { foreignVideoRouteStamp, VIDEO_ROUTE_STAMP_KEY, rowlessRouteTaskId, rowlessRunTokenFor, videoRouteRequestKey, videoRouteStamp, videoRouteStampOf, type VideoRouteStamp } from "./video-route-decision.js"
import { getAppSettings, settingsReadFailed } from "./app-settings.js"
import { noteRouteFailure } from "./video-route-failures.js"
import { probeRefVideoDurations } from "./ref-video-probe.js"

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
  const routeJob = run.reconcileOpts?.routeJob
  // A plugin's segment sent inside its parent, with its run's signed decision.
  if (!routeJob && run.reconcileOpts?.routeToken !== undefined && isRoutableVideoModel(run.provider)) {
    return runRowlessRouted(run)
  }
  if (!routeJob) return null
  const { jobId, jobType } = routeJob
  const service = getPluginServices().alternateRoutes
  // A routable model's job may carry the admin's routing decision, stored at
  // admission (lib/video-route-decision.ts): such a job runs on the route or
  // not at all — it was priced there. Only a Cloud install can route.
  // Environments share the job database. Even before this environment's first
  // policy save, another environment may already own this signed send.
  const routable = isRoutableVideoModel(run.provider) && hasCredits() && pluginServicesLoaded()
  let row: JobRead | null = null
  if (routable) {
    row = await readJobStrict(jobId)
    const stamp = row ? routedOf(row, jobId) : undefined
    if (stamp && row) {
      if (!service) throw routedFailure(jobId, stamp, "no alternate route service is loaded in this process")
      return runRoutedSend(service, run, row, stamp)
    }
    if (!row?.provider_task_id && await routingSettingSaved()) return null
  }
  if (!service) return null

  // The legacy consult: only the two lanes an older plugin knows, with
  // exactly the request it always saw (no service, no kind).
  if (jobType !== "image-to-video" && jobType !== "text-to-video") return null

  // Not offered at all: nothing (more) read.
  if (!alternateRouteRequestOf(run.body, { jobId, jobType, model: run.provider, parent: null })) return null

  row ??= await readJob(jobId)
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

/** Whether a routing setting was ever saved here (cached settings; no row read). Unreadable settings count as saved. */
async function routingSettingSaved(): Promise<boolean> {
  try {
    const settings = await getAppSettings()
    return settingsReadFailed(settings) || Boolean(settings.video_route_policy)
  } catch {
    return true
  }
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
  // A routed record carries no saved default request (a routed run never falls back): only an
  // unrouted one needs it to be read on.
  if (!taskRef || !record?.routeId || (!record.routed && !record.fallback)) throw new AlternateRoutePendingError(PENDING_MESSAGE)
  console.warn(`[alternate-route] job ${jobId}: already started; reading task ${taskRef} instead of starting another`)
  return pollToResult(service, {
    ...(record.routed ? { routed: routedOf(row, jobId), send: record.send ?? 1 } : {}),
    jobId,
    routeId: record.routeId,
    taskRef,
    held: row.provider_task_id as string,
    inputData: row.input_data,
    saved: true,
    plannedCostUsd: undefined,
    ...(record.fallback ? { fallback: record.fallback } : {}),
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
  /** The default request an unrouted run falls back to; a routed run has none (it never falls back). */
  fallback?: SavedDefaultRequest
  /** Set while the reference is not saved: the save is retried on every read. */
  unsaved?: { runningInput: Record<string, unknown> }
  /** An admin-routed run: an ended task fails the job (refunded), never falls back. */
  routed?: VideoRouteStamp
  /** Which send of the job the task belongs to (its route ledger row). */
  send?: number
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
          const record = alternateRouteRecordOf(p.inputData) ?? { state: "running" as const, at: Date.now(), routeId: p.routeId, taskRef: p.taskRef, ...(p.fallback ? { fallback: p.fallback } : {}), ...(p.routed ? { routed: true as const } : {}) }
          if (!p.saved || await noteDoneWithoutResult(p.jobId, p.held, p.inputData, record)) {
            console.error(`[ALERT] job ${p.jobId}: alternate route ${p.routeId} task ${p.taskRef} reads done without a result file (it was charged); not falling back, still reading.`)
          }
        }
        if (Date.now() >= deadline) throw leave("read done without a result file")
        await sleep(ALTERNATE_ROUTE_POLL_MS)
        continue
      }
      const providerMs = usd(polled.providerMs)
      if (p.routed && polled.billedSec !== undefined && polled.billedSec > p.routed.quotedSec) {
        console.error(`[ALERT] job ${p.jobId}: route ${p.routeId} billed ${polled.billedSec}s for ${p.routed.model} (${p.routed.factorKey}); it quoted ${p.routed.quotedSec}s.`)
      }
      // A routed run's cost is the one the route REPORTED, recorded on its route
      // ledger (what its settlement charges): its verified bill, with what it
      // is (a money receipt, or billed seconds at the agreed rate). None reported
      // stays none — never the planned figure or an estimate, which would hide it.
      const reported = usd(polled.providerCostUsd)
      if (p.routed) await recordRouteTask(p.jobId, p.send ?? 1, p.taskRef, reported ?? null, "", usd(polled.estimatedCostUsd), routeCostBasisOf(polled))
      return {
        url,
        cost: p.routed ? verifiedReportedUsd(polled) : (reported ?? p.plannedCostUsd ?? null),
        ...(providerMs !== undefined ? { providerMs } : {}),
        routedVia: p.routeId,
      }
    }
    if (polled?.state === "failed" || polled?.state === "expired") {
      console.warn(`[alternate-route] job ${p.jobId}: task ${p.taskRef} ${polled.state}: ${redactProviderDetail(polled.message) ?? "(no words)"}`)
      // A task existed: a routed run is never started again, nor sent to the default route.
      // How it ended goes on the ledger (not billed), so its settlement never waits on it.
      if (p.routed && (polled.state === "failed" || polled.state === "expired")) await recordRouteTaskOutcome(p.jobId, p.send ?? 1, "", p.taskRef, polled.state)
      if (p.routed) throw routedFailure(p.jobId, p.routed, `its task ${polled.state}`)
      // (An unrouted run always carries its default request; one without it is left to the recovery, never resent blind.)
      if (!p.fallback) throw new AlternateRoutePendingError(PENDING_MESSAGE)
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

// ── Admin-routed runs (docs/design/alternate-routes.md, "Routing per model") ──

/** What a person reads when a routed run fails: it was refunded, and nothing about where it ran. */
export const ROUTED_FAILURE_MESSAGE = "This video couldn't be generated. Your credits have been returned."

/**
 * The final error of a routed run: the job fails and is refunded through the
 * worker's normal path (deterministic: never retried by the queue, never sent
 * to the default route). Counted toward the model's failure alert.
 */
function routedFailure(jobId: string, stamp: VideoRouteStamp, why: string): Error {
  console.warn(`[alternate-route] job ${jobId}: routed ${stamp.model} run failed: ${why}`)
  void noteRouteFailure(stamp.model)
  // Only the platform's own words travel with the error: the route's text stays in the admin logs.
  return Object.assign(new Error(ROUTED_FAILURE_MESSAGE), { deterministic: true as const, routedFailure: true as const })
}

/**
 * The job's row for the routing decision; a read that FAILED is not "no
 * decision" — the run is left for a re-pick (`AlternateRoutePendingError`),
 * never sent to the default upstream on a guess.
 */
async function readJobStrict(jobId: string): Promise<JobRead | null> {
  // trash-read: a run's own lifecycle — what the job holds right now, deleted or not.
  const { data, error } = await supabase
    .from("jobs")
    .select("status, parent_job_id, provider_kind, provider_task_id, input_data")
    .eq("id", jobId)
    .maybeSingle()
  if (error) {
    console.warn(`[alternate-route] job ${jobId}: reading the job failed; leaving the run for a re-pick: ${error.message}`)
    throw new AlternateRoutePendingError(PENDING_MESSAGE)
  }
  return (data as JobRead | null) ?? null
}

function routedOf(row: JobRead, jobId: string): VideoRouteStamp | undefined {
  if (foreignVideoRouteStamp(row.input_data)) throw new AlternateRoutePendingError(PENDING_MESSAGE)
  const stamp = videoRouteStampOf(row.input_data, jobId)
  if (row.input_data?.[VIDEO_ROUTE_STAMP_KEY] !== undefined && !stamp) throw new AlternateRouteJobEndedError("The video routing decision could not be verified.")
  return stamp
}

/** The measured lengths of the request's reference clips, from the job's own probe, when they cover every clip. */
function measuredReferenceSec(input: Record<string, unknown> | null, clips: number): number[] | undefined {
  const raw = input?.refVideoDurationsSec
  if (!Array.isArray(raw) || clips === 0) return undefined
  const sec = raw.filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0)
  return sec.length === clips ? sec : undefined
}

/** The measured lengths of the clips a run sends, or undefined when any cannot be read. */
async function measuredSentSec(urls: readonly string[], provider: string): Promise<number[] | undefined> {
  if (urls.length === 0) return undefined
  try {
    const probed = await probeRefVideoDurations({ provider, referenceVideoUrls: urls })
    return probed.length === urls.length && probed.every((d) => Number.isFinite(d) && d > 0) ? probed : undefined
  } catch {
    return undefined
  }
}

/** Saves a routed run's next start attempt on its claim (a compare-and-set on the claim it holds). */
async function recordAttempt(jobId: string, inputData: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("jobs")
      .update({ input_data: inputData })
      .eq("id", jobId)
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .eq("provider_task_id", ALTERNATE_ROUTE_CLAIM_REF)
      .in("status", [...LIVE_STATUSES])
      .select("id")
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/**
 * Runs a job the admin routed, by its stored decision. Never consults
 * `accepts` again and never falls back:
 *   - a job already holding this route's task is read, never started again;
 *   - a claim with no reference (a start may be in flight) is left to the recovery;
 *   - a `start` refused before anything was created (`created: "none"`, an
 *     empty account included) is retried ONCE — the attempt is recorded on the
 *     claim first, so a re-pick never makes a third;
 *   - a second refusal, an unanswered start (a task may exist: never resent),
 *     or a task that failed after it existed fails the job, refunded.
 */
/**
 * One send of a routed job. A later send of the same job (`routeJob.send`:
 * text-to-video's rewrite after a refusal, voiced video's plain clip after its
 * voice chain failed) runs on the SAME route, freshly quoted, once the earlier
 * send's task ended in failure. A failure is recorded on the job's route
 * record with its send number, so a later send knows the earlier one is over.
 */
async function runRoutedSend(service: PluginAlternateRoutesService, run: AlternateRouteRun, row: JobRead, stamp: VideoRouteStamp): Promise<ProviderResult> {
  const { jobId } = run.reconcileOpts!.routeJob!
  const send = run.reconcileOpts?.routeJob?.send ?? 1
  let current = row
  let requote = false
  const record = alternateRouteRecordOf(row.input_data)
  if (row.provider_task_id && record?.routed && send > (record.send ?? 1)) {
    // A later send is its own start (its own ledger key), decided by what the
    // earlier send left: a task that existed and ended (failed, or delivered a
    // clip its lane could not finish) frees the job for the next start; a start
    // that got no answer (no task reference) is final — never resent.
    const earlier = record.send ?? 1
    let ledger: Awaited<ReturnType<typeof readRouteLedger>>
    try {
      ledger = await readRouteLedger(jobId)
    } catch {
      throw new AlternateRoutePendingError(PENDING_MESSAGE)
    }
    const earlierEnded = record.state === "failed" || ledger.tasks.some((t) => t.send === earlier)
    if (record.reason === "start-unanswered") throw routedFailure(jobId, stamp, `send ${earlier}'s start got no answer; a later send is never started beside it`)
    if (!earlierEnded) throw new AlternateRoutePendingError(PENDING_MESSAGE)
    const freed = await freeForNextSend(jobId, row.provider_task_id, row.input_data)
    if (!freed) throw new AlternateRoutePendingError(PENDING_MESSAGE)
    current = { ...row, provider_kind: "pre-task", provider_task_id: null, input_data: freed }
    requote = true
  }
  try {
    return await runRouted(service, run, current, stamp, undefined, { send, requote })
  } catch (err) {
    if ((err as { routedFailure?: unknown } | null)?.routedFailure === true) await noteSendFailed(jobId, send, (err as { startUnanswered?: unknown }).startUnanswered === true ? "start-unanswered" : undefined)
    throw err
  }
}

/** Clears the job's failed earlier send (a compare-and-set on the task it held) so the next send can start. The new input, or null when the row moved. */
async function freeForNextSend(jobId: string, held: string, inputData: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await supabase
      .from("jobs")
      .update({ provider_kind: "pre-task", provider_task_id: null })
      .eq("id", jobId)
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .eq("provider_task_id", held)
      .in("status", [...LIVE_STATUSES])
      .select("id")
    return Array.isArray(data) && data.length > 0 ? (inputData ?? {}) : null
  } catch {
    return null
  }
}

/** Records on the job's route record that send `send` failed (best effort: a later send reads it). */
async function noteSendFailed(jobId: string, send: number, reason?: string): Promise<void> {
  try {
    const now = await readJob(jobId)
    if (!now || now.provider_kind !== ALTERNATE_ROUTE_PROVIDER_KIND || !now.provider_task_id) return
    const record = alternateRouteRecordOf(now.input_data)
    if (!record) return
    await supabase
      .from("jobs")
      .update({ input_data: withAlternateRouteRecord(now.input_data, { ...record, state: "failed", at: Date.now(), send, ...(reason ? { reason } : {}) }) })
      .eq("id", jobId)
      .eq("provider_task_id", now.provider_task_id)
      .select("id")
  } catch {
    // The next send then reads the task it held and fails the same way: no second start.
  }
}

async function runRouted(
  service: PluginAlternateRoutesService,
  run: AlternateRouteRun,
  row: JobRead,
  stamp: VideoRouteStamp,
  /** A request built by its lane instead of from a prepared body (a draft finalize). */
  prepared?: PluginAlternateRouteRequest,
  /** Which send of the job this is, and whether it is quoted afresh (a later send). */
  sendOf: { send: number; requote: boolean } = { send: 1, requote: false },
): Promise<ProviderResult> {
  const { jobId, jobType } = run.reconcileOpts!.routeJob!
  // The decision priced THESE inputs: a job whose priced inputs changed since
  // (an edit after admission) is not run against a hold made for others.
  if (videoRouteRequestKey(row.input_data) !== stamp.requestKey) throw routedFailure(jobId, stamp, "its priced inputs changed after admission")
  if (row.provider_task_id) {
    if (row.provider_kind !== ALTERNATE_ROUTE_PROVIDER_KIND) throw routedFailure(jobId, stamp, `the job holds another kind's task (${row.provider_kind ?? "none"})`)
    const held = await resumeHeld(service, jobId, row, alternateRouteRecordOf(row.input_data))
    if (!held) throw routedFailure(jobId, stamp, "the held task could not be read")
    return held
  }
  const base = prepared ?? alternateRouteRequestOf(run.body, { jobId, jobType, model: run.provider, parent: await readParent(row.parent_job_id) })
  if (!base) throw routedFailure(jobId, stamp, "the prepared request has a setting the route cannot carry")
  // The lengths of the clips this run really sends: a finalize's are the
  // draft's (signed with the decision); a generation's are measured here,
  // after preparation (an extend sends a cut of its source, an edit a
  // re-encode), else the job's own probe.
  // The lengths the hold was quoted on (measured at admission, signed with the
  // decision — an extend's already as the shared rule sends its cut) are the
  // lengths the route is asked with, so the send is the request that was
  // priced; only a decision without them (or for a different clip count) measures here.
  const signed = stamp.referenceVideoDurationsSec && stamp.referenceVideoDurationsSec.length === base.referenceVideoUrls.length && base.referenceVideoUrls.length > 0
    ? [...stamp.referenceVideoDurationsSec]
    : undefined
  const durations = prepared
    ? (stamp.referenceVideoDurationsSec ? [...stamp.referenceVideoDurationsSec] : undefined)
    : signed ?? await measuredSentSec(base.referenceVideoUrls, run.provider) ?? measuredReferenceSec(row.input_data, base.referenceVideoUrls.length)
  const outputSec = stamp.outputSec
    ?? (base.referenceTaskType === "edit" ? durations?.[0] : base.durationSec !== undefined && base.durationSec > 0 ? base.durationSec : undefined)
  const req = {
    ...base,
    service: stamp.service,
    kind: base.kind ?? ("generate" as const),
    ...(durations ? { referenceVideoDurationsSec: durations } : {}),
    ...(outputSec !== undefined ? { outputSec } : {}),
  }

  await throwIfJobCancelled()
  // A later send is quoted afresh, and the decision re-signed with that quote
  // (its hold is not moved: a run billed above it is collected at settlement).
  if (sendOf.requote) {
    const accepted = service.accepts(req)
    if (!accepted?.routeId) throw routedFailure(jobId, stamp, "the supplier declined the next prepared send")
    let fresh: { billedSeconds: number; usd: number } | null = null
    try {
      fresh = typeof service.quote === "function" ? service.quote(req) : null
    } catch {
      fresh = null
    }
    if (!fresh || !(fresh.usd > 0)) throw routedFailure(jobId, stamp, "the route gave no quote for the next send")
    const resigned = videoRouteStamp(jobId, { route: "alternate", routeId: accepted.routeId, service: stamp.service }, {
      ...stamp,
      quotedUsd: fresh.usd,
      quotedSec: fresh.billedSeconds,
      ...(stamp.referenceVideoDurationsSec ? { referenceVideoDurationsSec: stamp.referenceVideoDurationsSec } : {}),
    })
    stamp = resigned
    row = { ...row, input_data: { ...(row.input_data ?? {}), [VIDEO_ROUTE_STAMP_KEY]: resigned } }
  }
  // A routed record carries NO default request: a routed run never falls back, and a host that
  // does not know routed runs (an older build reading the same database) finds nothing to resend
  // to the default upstream — it can only fail and refund the job.
  let claimedInput = withAlternateRouteRecord(row.input_data, { state: "claimed", at: Date.now(), routeId: stamp.routeId, routed: true, attempt: 1, send: sendOf.send })
  const claimed = await claim(jobId, claimedInput)
  if (claimed === "error") throw new AlternateRoutePendingError(PENDING_MESSAGE)
  if (claimed === "lost") {
    const now = await readJob(jobId)
    if (!now?.provider_task_id) throw new AlternateRoutePendingError(PENDING_MESSAGE)
    return runRouted(service, run, now, stamp, prepared, sendOf)
  }

  // The start is recorded on the route ledger BEFORE it goes out: a send whose
  // start is recorded already may have a paid task upstream with no saved
  // reference (a crash between the two) — it is never started again.
  const startRecord = await recordRouteStart(jobId, sendOf.send)
  if (startRecord === "error") throw new AlternateRoutePendingError(PENDING_MESSAGE)
  if (startRecord === "exists") {
    console.error(`[ALERT] job ${jobId}: send ${sendOf.send} of this routed ${stamp.model} run was started before and its task reference was never saved (possible orphan paid task). Not started again; the job fails and is refunded.`)
    throw routedFailure(jobId, stamp, "an earlier start of this send left no task reference")
  }
  let started: { taskRef?: unknown; plannedCostUsd?: unknown } | undefined
  for (let attempt = 1; ; attempt++) {
    try {
      started = await service.start(stamp.routeId, req, { jobId })
      break
    } catch (err) {
      const created = createdOf(err)
      const code = typeof (err as { code?: unknown } | null)?.code === "string" ? (err as { code: string }).code : undefined
      if (code === "insufficient_balance") {
        console.error(`[ALERT] job ${jobId}: the alternate route ${stamp.routeId} account cannot hold a ${stamp.model} run (insufficient balance); this is not a model failure.`)
      }
      if (created === "unknown") {
        console.error(`[ALERT] job ${jobId}: alternate route ${stamp.routeId} start got no answer; a paid task may exist upstream (possible orphan paid task). Not resent; the job fails and is refunded.`)
        throw Object.assign(routedFailure(jobId, stamp, "the start got no answer"), { startUnanswered: true as const })
      }
      if (attempt >= 2) {
        console.warn(`[alternate-route] job ${jobId}: route ${stamp.routeId} refused the run again: ${errText(err)}`)
        throw routedFailure(jobId, stamp, `the start was refused twice (${code ?? "refused"})`)
      }
      console.warn(`[alternate-route] job ${jobId}: route ${stamp.routeId} refused the run before creating a task; trying once more: ${errText(err)}`)
      claimedInput = withAlternateRouteRecord(row.input_data, { state: "claimed", at: Date.now(), routeId: stamp.routeId, routed: true, attempt: 2, send: sendOf.send })
      if (!(await recordAttempt(jobId, claimedInput))) throw new AlternateRoutePendingError(PENDING_MESSAGE)
      await throwIfJobCancelled()
    }
  }
  const taskRef = typeof started?.taskRef === "string" && started.taskRef.length > 0 ? started.taskRef : undefined
  if (!taskRef) {
    console.error(`[ALERT] job ${jobId}: alternate route ${stamp.routeId} start resolved without a task reference; a paid task may exist upstream (possible orphan paid task). Not resent.`)
    throw routedFailure(jobId, stamp, "the start gave no task reference")
  }
  const plannedCostUsd = usd(started?.plannedCostUsd)
  const runningInput = withAlternateRouteRecord(row.input_data, { state: "running", at: Date.now(), routeId: stamp.routeId, taskRef, routed: true, send: sendOf.send })
  let save = await saveReference(jobId, taskRef, plannedCostUsd, runningInput)
  if (save === "error") save = await saveReference(jobId, taskRef, plannedCostUsd, runningInput)
  if (save === "not-live") return refuseNotLive(jobId, stamp.routeId, taskRef)
  const saved = save === "saved"
  const result = await pollToResult(service, {
    jobId,
    routeId: stamp.routeId,
    taskRef,
    held: saved ? alternateRouteReference(taskRef) : ALTERNATE_ROUTE_CLAIM_REF,
    inputData: saved ? runningInput : claimedInput,
    saved,
    plannedCostUsd,
    routed: stamp,
    send: sendOf.send,
    ...(saved ? {} : { unsaved: { runningInput } }),
  })
  // A routed run never falls back, so a null here cannot happen; never send the default request.
  if (!result) throw routedFailure(jobId, stamp, "the run ended without a result")
  return result
}

/**
 * Finalizes (to 1080p) a Seedance draft the alternate route made, on that
 * route (`kind: "draft-finalize"` with the draft's own route reference), by
 * the job's signed decision. Same policy as every routed run: one retry of a
 * start that made nothing, never the default upstream, a failure refunded.
 */
export async function finalizeRoutedDraft(jobId: string): Promise<ProviderResult> {
  const service = getPluginServices().alternateRoutes
  const row = await readJob(jobId)
  const stamp = row ? routedOf(row, jobId) : undefined
  if (!row || !stamp?.draftRouteTaskRef || !service) {
    throw Object.assign(new Error(ALTERNATE_ROUTE_DRAFT_MESSAGE), { deterministic: true as const })
  }
  // The draft's own reference clips (the lengths are signed with the decision).
  const sourceJobId = typeof row.input_data?.sourceJobId === "string" ? row.input_data.sourceJobId : null
  const source = sourceJobId ? await readJob(sourceJobId) : null
  const refUrls = Array.isArray(source?.input_data?.referenceVideoUrls) ? (source!.input_data!.referenceVideoUrls as unknown[]).filter((u): u is string => typeof u === "string") : []
  const request: PluginAlternateRouteRequest = {
    jobId,
    jobType: "video-upscale",
    model: stamp.model,
    parent: null,
    service: stamp.service,
    kind: "draft-finalize",
    draftRouteTaskRef: stamp.draftRouteTaskRef,
    prompt: "",
    draft: false,
    resolution: "1080p",
    referenceImageUrls: [],
    referenceVideoUrls: refUrls.length === (stamp.referenceVideoDurationsSec?.length ?? 0) ? refUrls : [],
    referenceAudioUrls: [],
    ...(stamp.outputSec !== undefined ? { outputSec: stamp.outputSec } : {}),
    ...(stamp.referenceVideoDurationsSec ? { referenceVideoDurationsSec: [...stamp.referenceVideoDurationsSec] } : {}),
  }
  return runRouted(
    service,
    { provider: stamp.model, taskModel: "draft-finalize", body: {}, reconcileOpts: { routeJob: { jobId, jobType: "video-upscale" } } },
    row,
    stamp,
    request,
  )
}

// ── Rowless routed runs (a plugin's segments inside their parent) ──

/**
 * One segment a plugin sends inside its parent job (Generate Video Pro, Edit
 * Video Pro) under its run's signed decision (`routeToken`). There is no row
 * of its own to claim: the route's task reference reaches the plugin's
 * checkpoint through `onTaskCreated` (as `rowlessRouteTaskId`), and a resume
 * reads it through `tk.providers.getVideoTaskStatus`. The same policy as a
 * job's routed run: one retry of a start that made nothing, never the default
 * upstream, a failure is final for the segment.
 */
async function runRowlessRouted(run: AlternateRouteRun): Promise<ProviderResult> {
  const parentJobId = getJobId() ?? undefined
  // Only a run token `reserveRoutedRun` bound to THIS parent job (its user, this
  // environment, not expired) sends a segment: a pricing quote, another job's
  // token or an expired one sends nothing.
  const token = rowlessRunTokenFor(run.reconcileOpts?.routeToken, parentJobId)
  const failure = (why: string): Error => {
    console.warn(`[alternate-route] routed segment of ${run.provider} (job ${parentJobId ?? "?"}) failed: ${why}`)
    if (token) void noteRouteFailure(token.model)
    return Object.assign(new Error(ROUTED_FAILURE_MESSAGE), { deterministic: true as const, routedFailure: true as const })
  }
  if (!token || token.model !== run.provider || !parentJobId) throw failure("its run token does not verify for this job and model")
  const segmentKey = run.reconcileOpts?.routeSegmentKey
  if (!segmentKey) throw failure("it was sent with no segment key")
  const service = getPluginServices().alternateRoutes
  if (!service) throw failure("no alternate route service is loaded in this process")
  const base = alternateRouteRequestOf(run.body, { jobId: parentJobId, jobType: "image-to-video", model: run.provider, parent: null })
  if (!base) throw failure("the prepared request has a setting the route cannot carry")
  const durations = await measuredSentSec(base.referenceVideoUrls, run.provider)
  const req: PluginAlternateRouteRequest = {
    ...base,
    service: token.service,
    kind: "generate",
    ...(durations ? { referenceVideoDurationsSec: durations } : {}),
    ...(base.durationSec !== undefined && base.durationSec > 0 ? { outputSec: base.durationSec } : {}),
  }
  // Rate keys can change between segments (a continuation sends a reference).
  // The token binds the supplier; that supplier identifies each prepared task.
  const routeId = service.accepts(req)?.routeId
  if (!routeId) throw failure("the supplier declined the prepared segment")
  // Quote the prepared segment at its own price id before submitting it.
  // Settlement compares that quote to the confirmed receipt.
  let quote: { priceId: string; quotedUsd: number; chargedCredits: number }
  try {
    const { quoteRowlessSegment } = await import("../ee/billing/video-route-runs.js")
    quote = await quoteRowlessSegment(token, req)
  } catch {
    throw failure("the route gave no quote for it")
  }
  // Recorded on the parent's route ledger BEFORE the start: a segment whose
  // start is recorded already may have a paid task with no checkpoint (a crash
  // between the start and `onTaskCreated`) — it is never started again.
  const startRecord = await recordRouteStart(parentJobId, 1, segmentKey, quote)
  if (startRecord === "error") throw new AlternateRoutePendingError(PENDING_MESSAGE)
  if (startRecord === "exists") {
    console.error(`[ALERT] job ${parentJobId}: routed segment ${segmentKey} was started before and never checkpointed (possible orphan paid task); not started again.`)
    throw failure("an earlier start of this segment left no checkpoint")
  }
  let started: { taskRef?: unknown } | undefined
  for (let attempt = 1; ; attempt++) {
    await throwIfJobCancelled()
    if (stopsAtSegmentBoundary({ job_type: token.service })) await beginPlannedVideoSegment(parentJobId, true)
    try {
      started = await service.start(routeId, req, { jobId: parentJobId })
      break
    } catch (err) {
      const created = createdOf(err)
      if (created === "unknown") throw failure("the start got no answer (a task may exist; never resent)")
      if (attempt >= 2) throw failure("the start was refused twice")
    }
  }
  const taskRef = typeof started?.taskRef === "string" && started.taskRef.length > 0 ? started.taskRef : undefined
  if (!taskRef) throw failure("the start gave no task reference")
  // The supplier has already accepted this task. A failed ledger write must
  // still give the parent's checkpoint the reference it needs to resume.
  try {
    await recordRouteStartRef(parentJobId, 1, segmentKey, taskRef)
  } finally {
    await run.reconcileOpts?.onTaskCreated?.(rowlessRouteTaskId(routeId, taskRef, segmentKey))
  }
  const deadline = Date.now() + ALTERNATE_ROUTE_BUDGET_MS
  let readFailures = 0
  for (;;) {
    await throwIfJobCancelled({ finishStartedVideo: true })
    let polled: PluginAlternateRoutePoll | undefined
    try {
      polled = await service.poll(routeId, taskRef)
      readFailures = 0
    } catch {
      if (++readFailures >= ALTERNATE_ROUTE_MAX_READ_FAILURES) throw new AlternateRoutePendingError(PENDING_MESSAGE)
    }
    if (polled?.state === "done" && polled.resultUrl) {
      const receipt = usd(polled.providerCostUsd) ?? null
      return { url: polled.resultUrl, cost: verifiedReportedUsd(polled), routedVia: routeId, routedCredits: await rowlessSegmentDone(parentJobId, segmentKey, taskRef, receipt, usd(polled.estimatedCostUsd), routeCostBasisOf(polled)) }
    }
    if (polled?.state === "failed" || polled?.state === "expired") {
      // How the segment ended goes on the parent's ledger (not billed), so the run's settlement never waits on it.
      await recordRouteTaskOutcome(parentJobId, 1, segmentKey, taskRef, polled.state)
      throw failure(`its task ${polled.state}`)
    }
    // Past the budget the segment is left for the plugin's own resume (its checkpoint holds the task).
    if (Date.now() >= deadline) throw new AlternateRoutePendingError(PENDING_MESSAGE)
    await sleep(nextPollMs(polled))
  }
}

/**
 * A routed segment whose task read done: its reported billed cost recorded on
 * the parent's route ledger (what the parent's settle charges), and the
 * credits it charges when the route has reported a bill. Shared by the send and a resume's status read.
 */
export async function rowlessSegmentDone(parentJobId: string, segmentKey: string, taskRef: string, costUsd: number | null, estimatedUsd?: number | null, basis?: RouteCostBasis): Promise<number | null> {
  await recordRouteTask(parentJobId, 1, taskRef, costUsd, segmentKey, estimatedUsd ?? undefined, basis)
  if (!hasCredits()) return null
  try {
    const ledger = await readRouteLedger(parentJobId)
    const seg = ledger.segments.find((s) => s.key === segmentKey)
    if (!seg) return null
    const { rowlessSegmentCharge } = await import("../ee/billing/video-route-runs.js")
    const charge = rowlessSegmentCharge(seg, await getAppSettings())
    if (!charge.reported) console.error(`[ALERT] job ${parentJobId}: routed segment ${segmentKey} reported no verified bill; settlement awaits it.`)
    return charge.reported ? charge.credits : null
  } catch {
    return null
  }
}
