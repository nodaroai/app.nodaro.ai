/**
 * The stop rule for a video run whose provider task already started ("finish
 * it, deliver it, charge it"): a workflow Stop, an app run's cancel, or a
 * node's timeout does not cancel such a job. It keeps running, its clip lands
 * in the owner's library, and it is charged as any finished run is — the
 * provider is paid for it whatever we do. The node reads as stopped on the
 * canvas (`STOPPED_FINISHING_CODE`); nothing reaches the nodes after it.
 *
 * Before a task exists (nothing was sent), a stop cancels the job and returns
 * its credits, as always.
 *
 * Pure, no I/O. ONE predicate decides which models follow it:
 * {@link followsStartedRunToEnd}.
 */
import { isSeedanceExtendProvider } from "@nodaro/shared/models"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import { isRoutableVideoModel } from "./video-route-policy.js"
import { ALTERNATE_ROUTE_JOB_TYPES } from "./alternate-route-request.js"

/** A node stopped while its video was already being made: it finishes in the library, charged. */
export const STOPPED_FINISHING_CODE = "stopped_finishing"

/** The same when the node stopped waiting (a timeout): the run itself goes on. */
export const TIMED_OUT_FINISHING_CODE = "timed_out_finishing"

/** The node's error for a Stop (English; the editor shows `nodeRun.stoppedFinishing`). */
export const STOPPED_FINISHING_MESSAGE = "Stopped. This video had already started, so it will finish in My Library and be charged."

/** The node's error when it stopped waiting (a timeout; the editor shows `nodeRun.timedOutFinishing`). */
export const TIMED_OUT_FINISHING_MESSAGE = "Stopped waiting. This video had already started, so it will finish in My Library and be charged."

/**
 * THE predicate: the models whose started run is finished, delivered and
 * charged when it is stopped — the Seedance 2.x family today. Extending the
 * rule to every video model is a change of this one line.
 */
export function followsStartedRunToEnd(model: unknown): boolean {
  return isRoutableVideoModel(model) || isSeedanceExtendProvider(model) || model === SEEDANCE_DRAFT_FINALIZE_PROVIDER
}

const VIDEO_LANES: ReadonlySet<string> = new Set(ALTERNATE_ROUTE_JOB_TYPES)

/** The columns the rule reads: `model` is the job's `input_data->>provider` (never `jobs.provider`, a different column). */
export interface StopRuleRow {
  readonly status?: unknown
  readonly job_type?: unknown
  readonly inputType?: unknown
  readonly provider_task_id?: unknown
  readonly video_send_started_at?: unknown
  readonly model?: unknown
}

/** A video lane of a model the rule follows (whether or not its task started yet). */
export function followedLane(row: StopRuleRow): boolean {
  const type = row.job_type ?? row.inputType
  return typeof type === "string" && VIDEO_LANES.has(type) && followsStartedRunToEnd(row.model)
}

/** Jobs that deliver their current render on Stop and suppress any later segments or takes. */
export const VIDEO_SEGMENT_STOP_JOB_TYPES = ["generate-video-pro", "edit-video-pro", "ugc-clip"] as const


export function stopsAtSegmentBoundary(row: StopRuleRow): boolean {
  const type = row.job_type ?? row.inputType
  return VIDEO_SEGMENT_STOP_JOB_TYPES.some(jobType => jobType === type)
}

/** Queued parents with no submit can release their hold immediately. Already processing jobs also read durable checkpoints in the worker. */
export function unstartedSegmentJob(row: StopRuleRow): boolean {
  return stopsAtSegmentBoundary(row) && (row.status === "pending" || row.status === "queued")
    && !row.video_send_started_at && !row.provider_task_id
}

/** Whether a stop leaves this job running to its end (its task started: any task id, a route's claim included). */
export function finishesWhenStopped(row: StopRuleRow): boolean {
  return Boolean(row.video_send_started_at) || (followedLane(row) && typeof row.provider_task_id === "string" && row.provider_task_id.length > 0)
}

/** The columns to select for the rule (one read). */
export const STOP_RULE_COLUMNS = "job_type, provider_task_id, video_send_started_at, model:input_data->>provider, inputType:input_data->>type"

/** The same read on a database that does not have `video_send_started_at` yet (the code is ahead of its migration). */
export const STOP_RULE_COLUMNS_BEFORE_MIGRATION = "job_type, provider_task_id, model:input_data->>provider, inputType:input_data->>type"

/** The node's error for a stopped job that finishes on its own. */
export function stoppedFinishingError(timedOut: boolean): Error & { errorCode: string } {
  return Object.assign(new Error(timedOut ? TIMED_OUT_FINISHING_MESSAGE : STOPPED_FINISHING_MESSAGE), { errorCode: timedOut ? TIMED_OUT_FINISHING_CODE : STOPPED_FINISHING_CODE })
}
