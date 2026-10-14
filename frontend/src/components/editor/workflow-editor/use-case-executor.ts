/**
 * The canvas's own run of a use-case node (Tighten Episode, decided
 * 2026-10-13): one wrapper job on the server that runs the whole chain, polled
 * like any job, its result landed by the one mapping every lane shares
 * (lib/use-case-run-result.ts).
 *
 *  - A run: the recording wired into `media` (and the bed on `music`) with the
 *    node's settings. Nothing wired → refused here, before anything is sent.
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
 *  - A continue answered "already running" waits on the continuation it names;
 *    "superseded" (a newer generation failed too) continues that one; "still
 *    settling" asks again shortly. Every other refusal shows its message in
 *    the reader's language where the code has one.
 */
import { toast } from "sonner"
import { TIGHTEN_EPISODE } from "@nodaro/render-rules"
import { CONTINUATION_SETTLING, CONTINUATION_SUPERSEDED } from "@nodaro/shared/nodes"
import { continueUseCase, getJobStatus, tightenEpisode, type TightenEpisodeApiParams } from "@/lib/api"
import { executionErrorText } from "@/lib/execution-error-text"
import { usecaseEpisodeOf, usecaseFailedRunFields, usecaseJsonFields, usecaseTakeResultFields } from "@/lib/use-case-run-result"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import type { TightenEpisodeData, WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"
import { pollJobWithNodeUpdate } from "./poll-job"
import { WorkflowStaleError, type ExecutionContext } from "./types"

/** How long a continue answered "still settling" waits before it asks again. */
export const USE_CASE_SETTLING_RETRY_MS = 5_000
/** How many times a continue asks again while the run is still settling. */
export const USE_CASE_SETTLING_RETRIES = 12
/** How many newer failed generations a continue follows before it gives up. */
export const USE_CASE_MAX_GENERATION_HOPS = 5

const LABEL = "Tighten Episode"
const OUTPUT_KEYS = ["generatedVideoUrl", "generatedAudioUrl"] as const

/** What the canvas resolver hands a use-case node. */
export interface UseCaseInputs {
  readonly useCaseMedia?: ReadonlyArray<{ readonly nodeId: string; readonly url: string }>
  readonly useCaseMusic?: string
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
async function keepFailedRunOutputs(nodeId: string, jobId: string | undefined, err: unknown, ctx: ExecutionContext): Promise<void> {
  if (!jobId || err instanceof WorkflowStaleError || ctx.signal?.aborted || ctx.isWorkflowStale()) return
  try {
    const job = await getJobStatus(jobId)
    const od = (job?.output_data ?? null) as Record<string, unknown> | null
    if (job?.status !== "failed" || !od) return
    const kept = usecaseFailedRunFields(TIGHTEN_EPISODE, od, nodeDataOf(nodeId), jobId) ?? {}
    const executionId = typeof od._executionId === "string" ? { useCaseExecutionId: od._executionId } : {}
    useWorkflowStore.getState().updateNodeData(nodeId, { ...kept, ...executionId })
  } catch {
    // The run's failure is what the person sees; what it finished stays in its job.
  }
}

/** Poll the wrapper `start` answers with, land its result, keep a failed run's finished outputs. */
function runWrapper(nodeId: string, start: () => Promise<{ jobId: string }>, ctx: ExecutionContext): Promise<string> {
  let jobId: string | undefined
  return pollJobWithNodeUpdate(
    nodeId,
    async () => {
      const started = await start()
      jobId = started.jobId
      remember(nodeId, started.jobId)
      return started
    },
    [...OUTPUT_KEYS],
    LABEL,
    ctx,
    (od) => landedFields(nodeId, od),
    undefined,
    // The take's quality ("proxy" while it waits on review) goes on the result only.
    // The take also keeps its run's plan, transcript and settings (one mapping with the server lanes).
    { resultFields: usecaseTakeResultFields },
  ).catch(async (err: unknown) => {
    await keepFailedRunOutputs(nodeId, jobId, err, ctx)
    throw err
  })
}

export function runTightenEpisode(nodeId: string, params: TightenEpisodeApiParams, ctx: ExecutionContext, idempotencyKey?: string): Promise<string> {
  return runWrapper(nodeId, () => tightenEpisode({ ...params, userId: ctx.userId }, idempotencyKey), ctx)
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
async function startContinuation(nodeId: string, params: UseCaseContinueParams, ctx: ExecutionContext, idempotencyKey: string | undefined): Promise<{ jobId: string }> {
  let request: UseCaseContinueParams = params
  let hops = 0
  let settles = 0
  for (;;) {
    let answer
    try {
      answer = await continueUseCase({ ...request, userId: ctx.userId, nodeId }, continueAskKey(idempotencyKey, hops))
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

export function runUseCaseContinue(nodeId: string, params: UseCaseContinueParams, ctx: ExecutionContext, idempotencyKey?: string): Promise<string> {
  return runWrapper(nodeId, () => startContinuation(nodeId, params, ctx, idempotencyKey), ctx)
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

/** Runs a Tighten Episode node on the canvas: this run's Continue, else a fresh run. */
export function executeTightenEpisode(node: WorkflowNode, inputs: UseCaseInputs, ctx: ExecutionContext, opts: UseCaseRunOptions = {}): Promise<string> {
  const d = node.data as TightenEpisodeData
  // A refusal's code is the last run's: a new run starts without it.
  if ((d as { errorCode?: unknown }).errorCode !== undefined) useWorkflowStore.getState().updateNodeData(node.id, { errorCode: undefined })
  const cont = opts.usecaseContinue
  if (cont) {
    // A list-driven node runs once per item, each its own run: a Continue or a
    // Render final cannot name one of them (decided 2026-10-13). Refused here
    // too, before anything is sent — the node's own buttons hide it already.
    if (opts.listDriven) {
      const message = nodeRunError(d.label, "nodeRun.tightenContinueListDriven")
      toast.error(message)
      return Promise.reject(new Error(message))
    }
    return runUseCaseContinue(
      node.id,
      { jobId: cont.jobId, mode: cont.mode, ...(cont.mode === "render-final" && (cont.editedEdl ?? d.editedEdl) ? { editedEdl: cont.editedEdl ?? d.editedEdl } : {}) },
      ctx,
      opts.idempotencyKey,
    )
  }
  // A fresh run: the previous run is no longer this node's to continue. Its
  // job is forgotten now, so a run refused before its wrapper exists (an
  // unreadable recording, a refused fee) offers no Continue of a replaced run.
  if (d.useCaseJobId !== undefined || d.useCaseExecutionId !== undefined) {
    useWorkflowStore.getState().updateNodeData(node.id, { useCaseJobId: undefined, useCaseExecutionId: undefined })
  }
  const media = inputs.useCaseMedia?.[0]
  if (!media) {
    toast.error(nodeRunError(d.label, "nodeRun.tightenNeedsRecording"))
    return Promise.reject(new Error("No recording wired into Tighten Episode"))
  }
  return runTightenEpisode(
    node.id,
    {
      mediaUrl: media.url,
      ...(inputs.useCaseMusic ? { musicUrl: inputs.useCaseMusic } : {}),
      output: d.output,
      ...(d.framing ? { framing: d.framing } : {}),
      captions: d.captions,
      captionStyle: d.captionStyle,
      reviewBeforeRender: d.reviewBeforeRender,
      planTier: d.planTier,
      instructions: d.instructions,
      styleGuide: d.styleGuide,
      musicDuckAmount: d.musicDuckAmount,
    },
    ctx,
    opts.idempotencyKey,
  )
}
