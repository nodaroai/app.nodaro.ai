/**
 * The canvas's own run of a use-case node (Tighten Episode and the rest,
 * decided 2026-10-13/14): one wrapper job on the server that runs the whole
 * chain, polled like any job, its result landed by the one mapping every lane
 * shares (lib/use-case-run-result.ts). The type's descriptor
 * (`@nodaro/render-rules`) names its route, label, inputs and settings;
 * nothing here names a type.
 *
 *  - A run: the recording wired into `media` (and the bed on `music`, the
 *    card on `introCard`, for a type that takes them) with the node's
 *    settings. Nothing wired → refused here, before anything is sent.
 *  - A Continue (the node's Continue button): a run option of THAT run only
 *    (`UseCaseRunOptions.usecaseContinue`, threaded from the click), never
 *    node data — so a click that never starts (a declined confirm, a refused
 *    balance) leaves nothing behind, and the next plain Run is a fresh run.
 *    It continues the run it names from where it failed. (Render final is a
 *    server run with a this-run-only input override, use-case-render-final.ts.)
 *  - The wrapper job is kept on the node (`useCaseJobId`) from the moment it
 *    starts, so Continue / Render final can address it even after it fails.
 *    A fresh run forgets the previous run's job first: a run refused before
 *    its wrapper exists leaves nothing for Continue to resume.
 *  - A run that fails keeps what it finished — its plan and transcript — on
 *    the node.
 *  - How the result lands follows the type's result kind: an episode as a
 *    take (`landEpisode`), a list (Trailer's formats) as the rows of one run
 *    (`landList`), text — Chapters' show notes and list — straight onto the
 *    node (`landText`).
 *  - A continue answered "already running" waits on the continuation it names;
 *    "superseded" (a newer generation failed too) continues that one; "still
 *    settling" asks again shortly. Every other refusal shows its message in
 *    the reader's language where the code has one.
 */
import { toast } from "sonner"
import {
  usecaseDescriptor,
  usecaseKindHasPlan,
  usecaseListsItsResult,
  usecaseRunRecordings,
  usecaseSentSettings,
  type UseCaseNodeType,
  type UseCaseResultKind,
} from "@nodaro/render-rules"
import { CONTINUATION_SETTLING, CONTINUATION_SUPERSEDED } from "@nodaro/shared/nodes"
import { continueUseCase, getJobStatus, runUseCase, type UseCaseApiParams } from "@/lib/api"
import { executionErrorText } from "@/lib/execution-error-text"
import { usecaseMulticamOffered } from "@/lib/use-case-multicam-viewer"
import { usecaseFramesOffered } from "@/lib/use-case-frames-viewer"
import { usecaseEpisodeOf, usecaseFailedRunFields, usecaseJsonFields, usecaseListLandingFields, usecaseRunResultFields, usecaseTakeResultFields } from "@/lib/use-case-run-result"
import { isInputWarningCode } from "@/lib/input-warning-codes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { usecaseLabelVars } from "@/lib/use-case-request-body"
import type { WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"
import { RUN_START_RESET, getJobStatusLeanForNode, guardedToast, pollJobWithNodeUpdate } from "./poll-job"
import { jobGoneMessage, shouldStopPolling } from "./poll-connection"
import { pollUseCaseTextJob } from "./use-case-text-poll"
import { shouldAbandonNode } from "./abandon-guard"
import { localizeJobLabel } from "./job-label"
import { WorkflowStaleError, type ExecutionContext } from "./types"

/** How long a continue answered "still settling" waits before it asks again. */
export const USE_CASE_SETTLING_RETRY_MS = 5_000
/** How many times a continue asks again while the run is still settling. */
export const USE_CASE_SETTLING_RETRIES = 12
/** How many newer failed generations a continue follows before it gives up. */
export const USE_CASE_MAX_GENERATION_HOPS = 5
/**
 * When a run whose result is text (Chapters: a transcription and a plan of up
 * to 3 hours of recording) counts as taking longer than usual: the node says
 * so once and keeps following it, less often, until it ends.
 */
export const USE_CASE_TEXT_LONG_RUN_MS = 4 * 60 * 60_000

const OUTPUT_KEYS = ["generatedVideoUrl", "generatedAudioUrl"] as const

/** What the canvas resolver hands a use-case node. */
export interface UseCaseInputs {
  readonly useCaseMedia?: ReadonlyArray<{ readonly nodeId: string; readonly url: string }>
  readonly useCaseMusic?: string
  readonly useCaseIntroCard?: string
  readonly useCaseMasterAudio?: string
  readonly useCaseMasterAudioNodeId?: string
}

export interface UseCaseContinueParams {
  readonly jobId: string
  readonly mode: "from-failed" | "render-final"
  readonly editedEdl?: unknown
}

const nodeDataOf = (nodeId: string): Readonly<Record<string, unknown>> | undefined =>
  useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as Readonly<Record<string, unknown>> | undefined

/** The run's wrapper job, kept on the node so Continue / Render final can address it. */
function remember(nodeId: string, jobId: string): void {
  useWorkflowStore.getState().updateNodeData(nodeId, { useCaseJobId: jobId })
}

/**
 * What a finished run writes beside the episode `pollJobWithNodeUpdate` lands:
 * the plan (under the review rule) and transcript, the other medium cleared,
 * and the run that made it. Also rides on the new take.
 */
function landedFields(nodeId: string, od: Record<string, unknown>): Record<string, unknown> {
  const episode = usecaseEpisodeOf(od)
  return {
    ...usecaseJsonFields(od, nodeDataOf(nodeId)),
    ...(episode ? { [episode.medium === "video" ? "generatedAudioUrl" : "generatedVideoUrl"]: undefined } : {}),
    ...(typeof od._executionId === "string" ? { useCaseExecutionId: od._executionId } : {}),
  }
}

/**
 * A failed run keeps what it finished on the node — the episode its render
 * made, its plan and transcript — through the mapping the server-run lanes
 * land a failure with (`usecaseFailedRunFields`). Never throws.
 */
async function keepFailedRunOutputs(nodeId: string, nodeType: UseCaseNodeType, jobId: string | undefined, err: unknown, ctx: ExecutionContext): Promise<void> {
  if (!jobId || err instanceof WorkflowStaleError || ctx.signal?.aborted || ctx.isWorkflowStale()) return
  try {
    const job = await getJobStatus(jobId)
    const od = (job?.output_data ?? null) as Record<string, unknown> | null
    if (job?.status !== "failed" || !od) return
    const kept = usecaseFailedRunFields(nodeType, od, nodeDataOf(nodeId), jobId) ?? {}
    const executionId = typeof od._executionId === "string" ? { useCaseExecutionId: od._executionId } : {}
    useWorkflowStore.getState().updateNodeData(nodeId, { ...kept, ...executionId })
  } catch {
    // The run's failure is what the person sees; what it finished stays in its job.
  }
}

/** Polls a started run to its end and lands its result on the node; resolves with what the node hands on. */
type Landing = (nodeId: string, nodeType: UseCaseNodeType, start: () => Promise<{ jobId: string }>, ctx: ExecutionContext) => Promise<string>

/** A run whose result is an episode (video or audio): landed as a take, with its plan and transcript. */
const landEpisode: Landing = (nodeId, nodeType, start, ctx) =>
  pollJobWithNodeUpdate(
    nodeId,
    start,
    [...OUTPUT_KEYS],
    usecaseDescriptor(nodeType).label,
    ctx,
    (od) => landedFields(nodeId, od),
    undefined,
    // The take's quality ("proxy" while it waits on review) goes on the result only.
    // The take also keeps its run's plan, transcript and settings (one mapping with the server lanes).
    { resultFields: (od) => usecaseTakeResultFields(nodeType, od) },
  )

/** What a finished list run writes: `landedFields`, then its rows and list (`usecaseListLandingFields`). */
function landedListFields(nodeId: string, nodeType: UseCaseNodeType, od: Record<string, unknown>): Record<string, unknown> {
  const own = landedFields(nodeId, od)
  const rows = usecaseListLandingFields(nodeType, od, nodeDataOf(nodeId), new Date().toISOString())
  return { ...own, ...rows }
}

/**
 * A run whose result is a list (Trailer's formats): its deliveries land as
 * the rows of ONE run (lib/use-case-list-result.ts) — each naming the run's
 * wrapper (kept on the node from the moment it started) and its quality,
 * with the plan, transcript and settings every take of the run keeps — ahead
 * of the node's earlier results, the first on show; the node's list (what an
 * Each wire reads) and the deliveries it could not make beside them. The
 * poll lane's own single take is replaced by these rows.
 */
const landList: Landing = (nodeId, nodeType, start, ctx) =>
  pollJobWithNodeUpdate(
    nodeId,
    start,
    [...OUTPUT_KEYS],
    usecaseDescriptor(nodeType).label,
    ctx,
    (od) => landedListFields(nodeId, nodeType, od),
  )

/** Stop pressed: never a failure on the node. */
const isStop = (err: unknown, ctx: ExecutionContext): boolean =>
  (err as { name?: unknown } | null)?.name === "AbortError" || ctx.signal?.aborted === true

/**
 * A run whose result is text (Chapters' show notes, and its list on `json`):
 * no file to land, so it is polled to its end and landed through the mapping
 * every lane shares (`usecaseRunResultFields`). The previous run's result goes
 * at the start, so a failed run never shows an older one as its own. A job
 * cancelled elsewhere (another tab, the jobs list, the API) leaves the node
 * idle, as a restored cancelled job does — never failed.
 */
const landText: Landing = async (nodeId, nodeType, start, ctx) => {
  const write = (patch: Record<string, unknown>) => useWorkflowStore.getState().updateNodeData(nodeId, patch)
  const label = localizeJobLabel(usecaseDescriptor(nodeType).label)
  write({ ...RUN_START_RESET, generatedText: undefined, generatedJson: undefined })
  let jobId: string | undefined
  try {
    const started = await start()
    jobId = started.jobId
    guardedToast.info(tx("run.jobStarted", { label }), { description: tx("run.jobIdLine", { id: started.jobId }) })
    write({ currentJobId: started.jobId })
    const outcome = await pollUseCaseTextJob(started.jobId, nodeId, ctx, {
      status: getJobStatusLeanForNode,
      gaveUp: (err, failures) => (shouldStopPolling(err, failures, { nodeId, jobId: started.jobId }) ? jobGoneMessage() : null),
      stale: () => new WorkflowStaleError(),
      onProgress: (progress) => write({ currentJobProgress: progress }),
    }, {
      longRunMs: USE_CASE_TEXT_LONG_RUN_MS,
      onLongRun: () => guardedToast.info(tx("nodeRun.usecaseStillRunning", { label })),
    })
    if (ctx.isWorkflowStale()) throw new WorkflowStaleError()
    // Discarded or replaced while it ran: the result stays in its job (My Library), never on the node.
    if (shouldAbandonNode(nodeId, started.jobId)) return ""
    if (outcome.kind === "cancelled") {
      write({ executionStatus: "idle", currentJobId: undefined, currentJobProgress: undefined, jobAwaitingReview: undefined })
      guardedToast.info(tx("nodeRun.usecaseCancelled", { label }))
      return ""
    }
    const output = outcome.output
    const fields = usecaseRunResultFields(nodeType, output, nodeDataOf(nodeId), started.jobId) ?? {}
    write({
      ...fields,
      ...(typeof output._executionId === "string" ? { useCaseExecutionId: output._executionId } : {}),
      executionStatus: "completed",
      errorMessage: undefined,
      currentJobId: undefined,
      currentJobProgress: undefined,
      jobAwaitingReview: undefined,
    })
    guardedToast.success(tx("nodeRun.complete", { label }))
    return typeof fields.generatedText === "string" ? fields.generatedText : ""
  } catch (err) {
    if (err instanceof WorkflowStaleError) throw err
    if (isStop(err, ctx) || (jobId !== undefined && shouldAbandonNode(nodeId, jobId))) return ""
    const message = err instanceof Error && err.message ? err.message : tx("lib.unknownError")
    const code = (err as { code?: unknown } | null)?.code
    // The episode lane's rules (pollJobWithNodeUpdate): a request-gate block carries the
    // result gate's hint, an input the person can fix keeps its code and warns.
    const blocked = code === "job_blocked"
    const warning = isInputWarningCode(code)
    write({
      executionStatus: "failed",
      errorMessage: message,
      errorHint: blocked ? { kind: "policy-block", policyId: "", reason: message, hookPoint: "request" } : ((err as { errorHint?: unknown } | null)?.errorHint ?? undefined),
      ...(warning ? { errorCode: code } : {}),
      currentJobId: undefined,
      currentJobProgress: undefined,
      jobAwaitingReview: undefined,
    })
    if (blocked) guardedToast.warning(tx("run.jobBlocked", { label }))
    else if (warning) guardedToast.warning(message)
    else guardedToast.error(tx(jobId === undefined ? "nodeRun.failedToStart" : "nodeRun.failed", { label }), { description: message })
    throw err
  }
}

/** How a run's result lands, by the type's result kind (`landEpisode` for a kind with no landing of its own). */
const LANDINGS: Readonly<Partial<Record<UseCaseResultKind, Landing>>> = { chapters: landText }

/**
 * Start the wrapper (kept on the node from the moment it exists), land its
 * result by the type's result kind, and keep a failed run's finished outputs.
 */
function runWrapper(nodeId: string, nodeType: UseCaseNodeType, start: () => Promise<{ jobId: string }>, ctx: ExecutionContext): Promise<string> {
  let jobId: string | undefined
  const tracked = async () => {
    const started = await start()
    jobId = started.jobId
    remember(nodeId, started.jobId)
    return started
  }
  const land = LANDINGS[usecaseDescriptor(nodeType).resultKind] ?? (usecaseListsItsResult(nodeType) ? landList : landEpisode)
  return land(nodeId, nodeType, tracked, ctx).catch(async (err: unknown) => {
    await keepFailedRunOutputs(nodeId, nodeType, jobId, err, ctx)
    throw err
  })
}

/** A fresh run of a use-case node on the recording and settings in `params`. */
export function runUseCaseFresh(node: WorkflowNode, params: UseCaseApiParams, ctx: ExecutionContext, idempotencyKey?: string): Promise<string> {
  const type = node.type as UseCaseNodeType
  return runWrapper(node.id, type, () => runUseCase(type, { ...params, userId: ctx.userId }, idempotencyKey), ctx)
}

/** A refusal whose code has words of its own, in the reader's language; any other error as it was. */
function refusalOf(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code !== "string") return err
  const text = executionErrorText(code)
  return text && text !== code ? Object.assign(new Error(text), { code }) : err
}

/** Wait before asking again, unless the run was stopped or the workflow left. */
function waitUnlessStopped(ms: number, ctx: ExecutionContext): Promise<void> {
  if (ctx.isWorkflowStale()) return Promise.reject(new WorkflowStaleError())
  if (ctx.signal?.aborted) return Promise.reject(new Error(tx("exec.cancelled")))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal?.removeEventListener("abort", onAbort)
      if (ctx.isWorkflowStale()) reject(new WorkflowStaleError())
      else resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error(tx("exec.cancelled")))
    }
    ctx.signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * The Idempotency-Key of one ask: the click's key for the first request, a key
 * of its own for each hop to a newer generation (another request). A settling
 * retry is the same request again (nothing was created), so it keeps its key.
 */
export function continueAskKey(base: string | undefined, hop: number): string | undefined {
  if (!base) return undefined
  return hop === 0 ? base : `${base}:hop:${hop}`
}

/** Start a continuation, following the route to the run that answers it. */
async function startContinuation(
  nodeId: string,
  nodeType: UseCaseNodeType,
  params: UseCaseContinueParams,
  ctx: ExecutionContext,
  idempotencyKey: string | undefined,
): Promise<{ jobId: string }> {
  let request: UseCaseContinueParams = params
  let hops = 0
  let settles = 0
  for (;;) {
    let answer
    try {
      answer = await continueUseCase({ nodeType, ...request, userId: ctx.userId, nodeId }, continueAskKey(idempotencyKey, hops))
    } catch (err) {
      // A refused Render final keeps its code on the node (its words, no Continue), as the server lanes land it.
      const code = (err as { code?: unknown } | null)?.code
      if (request.mode === "render-final" && typeof code === "string") useWorkflowStore.getState().updateNodeData(nodeId, { errorCode: code })
      throw refusalOf(err)
    }
    if (answer.kind === "started" || answer.kind === "running") return { jobId: answer.jobId }
    if (answer.kind === "superseded") {
      // A newer generation of this run failed too: continue that one, from where it failed.
      if (++hops > USE_CASE_MAX_GENERATION_HOPS) throw Object.assign(new Error(executionErrorText(CONTINUATION_SUPERSEDED)!), { code: CONTINUATION_SUPERSEDED })
      request = { jobId: answer.jobId, mode: "from-failed" }
      continue
    }
    // Still settling (the failed run's fee not refunded yet): ask again shortly.
    if (++settles > USE_CASE_SETTLING_RETRIES) throw Object.assign(new Error(executionErrorText(CONTINUATION_SETTLING)!), { code: CONTINUATION_SETTLING })
    await waitUnlessStopped(USE_CASE_SETTLING_RETRY_MS, ctx)
  }
}

export function runUseCaseContinue(nodeId: string, nodeType: UseCaseNodeType, params: UseCaseContinueParams, ctx: ExecutionContext, idempotencyKey?: string): Promise<string> {
  return runWrapper(nodeId, nodeType, () => startContinuation(nodeId, nodeType, params, ctx, idempotencyKey), ctx)
}

/** How the canvas runs this node now: its call's Idempotency-Key, whether a list drives it, and a Continue. */
export interface UseCaseRunOptions {
  /** The call's key (the click's, `:iter:N` for a fan-out iteration). */
  readonly idempotencyKey?: string
  /** A list feeds the node (one run per item): no one run for a Continue to name. */
  readonly listDriven?: boolean
  /** This run continues the node's earlier run (its Continue): this run's only, never saved. */
  readonly usecaseContinue?: UseCaseContinueParams
}

/** The node data a use-case run reads, beside its settings. */
type UseCaseRunData = Readonly<Record<string, unknown>> & {
  readonly label?: string
  readonly editedEdl?: unknown
  readonly useCaseJobId?: string
  readonly useCaseExecutionId?: string
  readonly errorCode?: unknown
}

/** Runs any use-case node on the canvas: this run's Continue, else a fresh run. */
export function executeUseCase(node: WorkflowNode, inputs: UseCaseInputs, ctx: ExecutionContext, opts: UseCaseRunOptions = {}): Promise<string> {
  const type = node.type as UseCaseNodeType
  const d = usecaseDescriptor(type)
  const data = node.data as UseCaseRunData
  // A refusal's code is the last run's: a new run starts without it.
  if (data.errorCode !== undefined) useWorkflowStore.getState().updateNodeData(node.id, { errorCode: undefined })
  const cont = opts.usecaseContinue
  if (cont) {
    // A list-driven node runs once per item, each its own run: a Continue or a
    // Render final cannot name one of them (decided 2026-10-13). Refused here
    // too, before anything is sent — the node's own buttons hide it already.
    if (opts.listDriven) {
      const message = nodeRunError(data.label, "nodeRun.tightenContinueListDriven")
      toast.error(message)
      return Promise.reject(new Error(message))
    }
    // A kind with no plan (a layout) has no edit to send: the server refuses one (`use_case_no_plan`), so a stray edit on the node is never sent.
    const edit = cont.mode === "render-final" && usecaseKindHasPlan(d.resultKind) ? (cont.editedEdl ?? data.editedEdl) : undefined
    return runUseCaseContinue(node.id, type, { jobId: cont.jobId, mode: cont.mode, ...(edit ? { editedEdl: edit } : {}) }, ctx, opts.idempotencyKey)
  }
  // A fresh run: the previous run is no longer this node's to continue. Its
  // job is forgotten now, so a run refused before its wrapper exists (an
  // unreadable recording, a refused fee) offers no Continue of a replaced run.
  if (data.useCaseJobId !== undefined || data.useCaseExecutionId !== undefined) {
    useWorkflowStore.getState().updateNodeData(node.id, { useCaseJobId: undefined, useCaseExecutionId: undefined })
  }
  // The recordings in the node's order, the master and the Cameras settings — the server's engine's rule
  // (usecaseRunRecordings): several recordings and a master only for a viewer who may use Speaker Map, an
  // `auto` framing source as the even split for one Speaker Frames is withheld from.
  const run = usecaseRunRecordings({
    wired: inputs.useCaseMedia,
    data,
    maxRecordings: d.maxRecordings,
    takesMaster: d.inputs.includes("masterAudio"),
    master: inputs.useCaseMasterAudio ? { nodeId: inputs.useCaseMasterAudioNodeId ?? "", url: inputs.useCaseMasterAudio } : undefined,
    multicam: usecaseMulticamOffered(),
    framesAvailable: usecaseFramesOffered(),
    absentFramingSource: d.absentFramingSource,
    // Both engines' rule (usecaseSentSettings): unset not sent, a null or "" only where the body takes one, the rest as held.
    settings: usecaseSentSettings(type, d.settingKeys, data),
  })
  if (run.recordings.length === 0) {
    // Names the node's type in the reader's language; the node's own name heads the message.
    toast.error(nodeRunError(data.label, "nodeRun.usecaseNeedsRecording", usecaseLabelVars(type)))
    return Promise.reject(new Error(`No recording wired into ${d.label}`))
  }
  const settings = run.settings
  const mediaUrls = run.recordings.map((m) => m.url)
  const masterAudioUrl = run.masterAudioUrl
  return runUseCaseFresh(
    node,
    {
      mediaUrls,
      ...(inputs.useCaseMusic && d.inputs.includes("music") ? { musicUrl: inputs.useCaseMusic } : {}),
      ...(inputs.useCaseIntroCard && d.inputs.includes("introCard") ? { introCardUrl: inputs.useCaseIntroCard } : {}),
      ...(masterAudioUrl ? { masterAudioUrl } : {}),
      settings,
    },
    ctx,
    opts.idempotencyKey,
  )
}
