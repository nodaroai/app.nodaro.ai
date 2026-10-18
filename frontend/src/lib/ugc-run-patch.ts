/**
 * What a finished UGC node writes onto its own data — ONE mapping for every
 * lane that lands a run on the canvas: the canvas executors themselves
 * (ugc-execute.ts) and the three lanes that paint a server run
 * (`syncNodeStatesToStore` while it runs, `applyBackendExecutionState` and
 * `applyCompletedExecutionResults` on reopen). A lane that fell back to the
 * generic writes would leave a UGC node without its outputs: Run up to here
 * would buy UGC Script again (it reads as not run), and Run from here would
 * start UGC Clips with no script.
 *
 * One invariant every writer keeps: options written ⇒ nothing handed on. A UGC
 * Creator holding options carries no creator wire and no older image, so no
 * node below it can read an older creator.
 *
 * A finished UGC Script or UGC Clip JOB lands the same way on every lane that
 * lands one — the canvas run, the poll restored after a reload, the reload's
 * recovery (`ugcJobResultPatch`) — stamped with the job (`resultsRunMark`), so
 * a reload lane can tell an older result from a newer one (`ugcJobMayLand`).
 */
import {
  UGC_CREATOR_CANDIDATES_KEY,
  readUgcWire,
  ugcAwaitsPick,
  ugcClipOutputs,
  ugcPickPending,
  ugcScriptOutputs,
  ugcScriptResult,
  type UgcOutputs,
} from "@nodaro/shared/ugc"
import { UGC_FINISH_NODE_TYPES, ugcFinishNodeIds } from "@nodaro/render-rules"
import { RESULTS_RUN_ENDED_AT_KEY, RESULTS_RUN_ID_KEY, resultsRunMark } from "@/components/editor/workflow-editor/triggered-run-follow"
import { serverNowIso } from "@/lib/server-clock"
import type { GeneratedResult } from "@/types/nodes"

type Out = Readonly<Record<string, unknown>>
/** A wire, as the chain reading takes it. */
type WorkflowEdgeLike = { readonly source?: string; readonly target?: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const outputsOf = (o: Out): UgcOutputs | undefined => (isObject(o.ugcOutputs) ? (o.ugcOutputs as UgcOutputs) : undefined)

/** The UGC types whose patch replaces a lane's generic writes; UGC Clip's (a video) rides after them. */
export const UGC_PATCH_REPLACES_GENERIC: ReadonlySet<string> = new Set(["ugc-creator", "ugc-script", "ugc-clips", "ugc-cards"])

/**
 * What a finished UGC node writes to its own data from its run output, on every lane: exactly
 * the canvas executor's writes. A key written as `undefined` clears it (every lane merges).
 * Undefined for a type that is not a UGC node.
 */
export function ugcRunPatch(type: string | null | undefined, output: Out): Record<string, unknown> | undefined {
  const outputs = outputsOf(output)
  switch (type) {
    case "ugc-creator": {
      const optionFailed = output.ugcOptionFailed === true ? true : undefined
      // Options waiting: the options, and nothing handed on — no creator wire, no older image.
      if (ugcAwaitsPick(output)) {
        return { [UGC_CREATOR_CANDIDATES_KEY]: output.ugcCandidates, ugcOutputs: undefined, generatedImageUrl: undefined, optionFailed }
      }
      const record = outputs?.creator !== undefined ? readUgcWire(outputs.creator) : undefined
      return {
        [UGC_CREATOR_CANDIDATES_KEY]: undefined,
        ugcOutputs: outputs,
        ...(record && "value" in record ? { result: record.value } : {}),
        // The image the creator wire names (one source), never a separate field.
        ...(outputs?.image ? { generatedImageUrl: outputs.image } : {}),
        optionFailed,
      }
    }
    case "ugc-script":
      return { ugcOutputs: outputs, ...(isObject(output.ugcResult) ? { result: output.ugcResult } : {}) }
    case "ugc-clips":
      // A server run fetches no quote: an earlier run's quote goes.
      return { ugcOutputs: outputs, __listResults: Array.isArray(output.listResults) ? output.listResults : undefined, quote: undefined }
    case "ugc-clip":
      // Rides AFTER the generic video writes (generatedVideoUrl, generatedResults, __listResults).
      // The node's clips rendered: their Re-render marks ("will re-render on the next run") go,
      // whichever editor, device or client started the run.
      // A run that did not fan out leaves no batch behind (its list is then the take it shows).
      return { ugcOutputs: outputs, clipWarnings: output.clipWarnings, durationSec: output.durationSec, __listResultMeta: output.listResultMeta, __listResults: Array.isArray(output.listResults) ? output.listResults : undefined, rerenderPending: undefined }
    case "ugc-finish-clips":
      // Rides AFTER the generic video writes: its finished clips in order, and each clip's notes.
      return { __listResults: Array.isArray(output.listResults) ? output.listResults : undefined, __listResultMeta: output.listResultMeta }
    case "ugc-cards":
      return {
        ugcOutputs: outputs,
        ...(outputs ? { result: { layerPlan: outputs.layerPlan, captionPlan: outputs.captionPlan, report: outputs.report }, generatedText: outputs.report } : {}),
      }
    default:
      return undefined
  }
}

/**
 * A finished UGC Script or UGC Clip job's row (`output_data`) → the run output both engines
 * read it as (the orchestrator's job-row mapping): the script's outputs and its result; the
 * clip's video, its warnings, its length when known and its outputs. Undefined for another type.
 */
export function ugcJobRunOutput(type: string | null | undefined, outputData: Out): Record<string, unknown> | undefined {
  if (type === "ugc-script") {
    const result = ugcScriptResult(outputData)
    return { ugcOutputs: ugcScriptOutputs(outputData as Record<string, unknown>), ...(result ? { ugcResult: result } : {}) }
  }
  if (type === "ugc-clip") {
    const clip = ugcClipOutputs(outputData as Record<string, unknown>)
    return {
      videoUrl: clip.videoUrl,
      ...(clip.durationSec !== null ? { durationSec: clip.durationSec } : {}),
      clipWarnings: clip.clipWarnings,
      ugcOutputs: clip.outputs,
    }
  }
  return undefined
}

/**
 * The stamp of a canvas run that is no one job — UGC Creator, Clips, Cards, and a UGC Clip fanned
 * out over its tickets (each ticket a job of its own, the batch none): which run, and when it ended
 * on the server's clock. What a reopen compares with the runs the server lists, so a newer run's
 * result replaces this one and an older run's never does.
 */
export function ugcCanvasRunMark(nodeId: string): Record<string, unknown> {
  const endedAt = serverNowIso()
  return resultsRunMark(`canvas:${nodeId}:${endedAt}`, endedAt)
}

/** A UGC Creator that failed on a credits stop: the options it kept (and no creator wire), else nothing. */
export function ugcStopPatch(output: Out | null | undefined): Record<string, unknown> {
  const kept = output && Array.isArray(output.ugcCandidates) && output.ugcCandidates.length > 0 ? output.ugcCandidates : undefined
  return kept ? { [UGC_CREATOR_CANDIDATES_KEY]: kept, ugcOutputs: undefined, generatedImageUrl: undefined, optionFailed: undefined } : {}
}

/** The node already holds a UGC result of its own (its outputs, or options waiting): a reopen lane leaves it. */
export function holdsUgcRunResult(data: Out): boolean {
  return (isObject(data.ugcOutputs) && Object.keys(data.ugcOutputs).length > 0) || ugcPickPending(data)
}

/** This node already shows run `runId` (its stamp), read before a lane stamps it: a repaint of that run must not undo a pick. */
export function ugcCreatorShowsRun(data: Out, runId: string | null | undefined): boolean {
  return typeof runId === "string" && runId !== "" && data[RESULTS_RUN_ID_KEY] === runId
}

const timeOf = (t: unknown): number => (typeof t === "string" && t !== "" ? Date.parse(t) : Number.NaN)

/**
 * `run` ended after the run the node shows, or the node shows none: its options may land over
 * older outputs. A node that already shows `run` — picked or not — is never repainted by it, and
 * an unreadable time on either side proves nothing (the node keeps what it shows).
 */
export function ugcRunIsNewer(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  const shown = data[RESULTS_RUN_ID_KEY]
  if (typeof shown !== "string" || shown === "") return true
  if (shown === run.id) return false
  const shownEnded = timeOf(data[RESULTS_RUN_ENDED_AT_KEY])
  const thisEnded = timeOf(run.completedAt)
  return Number.isFinite(shownEnded) && Number.isFinite(thisEnded) && thisEnded > shownEnded
}

// ── The newer run wins: UGC Script, UGC Clips, UGC Cards and UGC Clip's take on reopen ──

/**
 * The UGC types whose result a NEWER run replaces when the editor reopens, as UGC Creator's
 * options do: a run that ended while the editor was closed lands its script, its clip tickets,
 * its cards over the older ones. UGC Clip follows the same rule for its take (`UGC_NEWER_TAKE_WINS_TYPE`),
 * landed through the video writes every video node shares.
 */
export const UGC_NEWER_RUN_WINS_TYPES: ReadonlySet<string> = new Set(["ugc-script", "ugc-clips", "ugc-cards"])

/**
 * The UGC video node whose take a newer run replaces on reopen, as the UGC types above. So do the
 * video's join, overlay and captions, by their place in the chain (`holdsUgcFinishVideo` below);
 * no other video node does.
 */
export const UGC_NEWER_TAKE_WINS_TYPE = "ugc-clip"

/**
 * The reopen of an ENDED run (`applyCompletedExecutionResults`): its result for one of these nodes
 * lands where the node holds none, holds one stamped with an older run, or holds one no lane
 * stamped (a stamped result outranks an unstamped one, as UGC Creator's options do) — never over
 * the run the node already shows (an edit made since stays), a newer one, or a stamped one whose
 * end cannot be read: that may be the newer one, and is kept.
 */
export function ugcEndedRunMayLand(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  if (!holdsUgcRunResult(data)) return true
  return ugcRunIsNewer(data, run)
}

/** The node's stamp names this run, or a run that provably ended no earlier (both ends readable). */
function stampShowsThisOrNewer(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  const shown = data[RESULTS_RUN_ID_KEY]
  if (typeof shown !== "string" || shown === "") return false
  if (shown === run.id) return true
  const shownEnded = timeOf(data[RESULTS_RUN_ENDED_AT_KEY])
  const thisEnded = timeOf(run.completedAt)
  return Number.isFinite(shownEnded) && Number.isFinite(thisEnded) && shownEnded >= thisEnded
}

/**
 * The reopen while a run is still going (`applyBackendExecutionState`, whose states are the node's
 * result): it paints over everything but a node that provably shows this run or a newer one — the
 * same run's stamp, or both ends readable and the shown one not the earlier — which is left as it
 * is, its stamp included. A time that cannot be read proves nothing here: the lane paints, as it
 * always did.
 */
export function ugcRunShowsThisOrNewer(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  return holdsUgcRunResult(data) && stampShowsThisOrNewer(data, run)
}

// ── The newer run wins over the whole video: its join, overlay and captions ───

/**
 * A UGC video's finish nodes — the join of its clips, the overlay drawing its screenshot cards,
 * the captions on its caption plan, each the video's only by its place in the chain
 * (`ugcFinishNodeIds`, @nodaro/render-rules) — follow the same rule as UGC Clip's take, by the same
 * stamp: a newer run's video lands over an older one on reopen, a stamped one over one no lane
 * stamped, never over the run the node shows, a newer one, or a stamped one whose end cannot be
 * read. Every other video node — a Combine Videos, Video Overlay or Add Captions outside a UGC
 * video included — keeps the fill-only rule.
 */
export function holdsUgcFinishVideo(data: Out): boolean {
  return (typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl !== "") || (Array.isArray(data.generatedResults) && data.generatedResults.length > 0)
}

/** The reopen of an ENDED run (`applyCompletedExecutionResults`): may its video land on this finish node? */
export function ugcFinishEndedRunMayLand(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  if (!holdsUgcFinishVideo(data)) return true
  return ugcRunIsNewer(data, run)
}

/** The reopen while a run is still going (`applyBackendExecutionState`): this finish node provably shows that run or a newer one. */
export function ugcFinishShowsThisOrNewer(data: Out, run: { readonly id: string; readonly completedAt?: string | null }): boolean {
  return holdsUgcFinishVideo(data) && stampShowsThisOrNewer(data, run)
}

/**
 * Is `nodeId` a finish node of a UGC video in the graph as it is now — the lanes that land one job
 * (a canvas run, the poll restored after a reload, the reload's recovery) stamp it, so a reopen can
 * tell its video from an older or a newer run's.
 */
export function isUgcFinishNode(nodeId: string, type: string | null | undefined, graph: { readonly nodes: readonly { readonly id: string; readonly type?: string | null; readonly data?: unknown }[]; readonly edges?: readonly WorkflowEdgeLike[] }): boolean {
  return typeof type === "string" && UGC_FINISH_NODE_TYPES.has(type) && ugcFinishNodeIds(graph.nodes, graph.edges ?? []).has(nodeId)
}

// ── A finished UGC Script or UGC Clip job ─────────────────────────────────────

/** The UGC types one job of their own finishes (UGC Script's script, UGC Clip's clip): the reload lanes recover them. */
export const UGC_JOB_RESULT_TYPES: ReadonlySet<string> = new Set(["ugc-script", "ugc-clip"])

/** A job that finished holding nothing the node hands on fails the node — the orchestrator's own sentence. */
export const ugcJobNoOutputMessage = (jobId: string): string =>
  `Job ${jobId} completed but produced no output — provider may have returned an empty result`

/**
 * A finished UGC Script or UGC Clip job as its node holds it, on every lane that lands one: the
 * outputs through `ugcRunPatch`; UGC Clip, a video, with its take ahead of the takes the node
 * holds (`priorResults`, the same clip never twice); and the job's stamp (`resultsRunMark`).
 * A fanned-out clip's row (`batchRow`) writes neither the batch's notes nor the stamp: the batch is
 * the list run's, and no one job stands for it. Null when the job holds nothing the node hands on
 * (a script without its plan, a clip without its video).
 */
export function ugcJobResultPatch(
  type: string | null | undefined,
  outputData: Out | null | undefined,
  job: { readonly id: string; readonly endedAt: string },
  opts: {
    readonly priorResults?: unknown
    readonly batchRow?: boolean
    /** UGC Clip: the Re-render count its job was sent (`nonce`), recorded on the take (`ugcClipNonce`). */
    readonly clipNonce?: number
  } = {},
): Record<string, unknown> | null {
  const output = ugcJobRunOutput(type, outputData ?? {})
  if (!output) return null
  const stamp = opts.batchRow ? {} : resultsRunMark(job.id, job.endedAt)
  if (type === "ugc-script") {
    if (!(output.ugcOutputs as UgcOutputs).plan) return null
    return { executionStatus: "completed", ...ugcRunPatch(type, output), ...stamp }
  }
  const videoUrl = output.videoUrl as string
  if (!videoUrl) return null
  const prior = (Array.isArray(opts.priorResults) ? (opts.priorResults as GeneratedResult[]) : []).filter((r) => r?.url !== videoUrl)
  const thumbnailUrl = typeof outputData?.thumbnailUrl === "string" ? outputData.thumbnailUrl : undefined
  const { __listResultMeta, __listResults, rerenderPending, ...clipFields } = ugcRunPatch(type, output)!
  return {
    executionStatus: "completed",
    generatedVideoUrl: videoUrl,
    generatedResults: [
      {
        url: videoUrl,
        timestamp: job.endedAt,
        jobId: job.id,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(type === "ugc-clip" && typeof opts.clipNonce === "number" ? { ugcClipNonce: opts.clipNonce } : {}),
      },
      ...prior,
    ],
    activeResultIndex: 0,
    ...clipFields,
    // A batch row is one clip of the batch: the batch's notes and Re-render marks stay the run's.
    ...(opts.batchRow ? {} : { __listResultMeta, __listResults, rerenderPending }),
    ...stamp,
  }
}

/** A UGC Clip holding a fanned-out batch: each of its clips is a job of its own. */
const holdsClipBatch = (data: Out): boolean =>
  (Array.isArray(data.__listResults) && data.__listResults.length > 0) || (Array.isArray(data.__listResultMeta) && data.__listResultMeta.length > 0)

/**
 * A finished UGC Script or UGC Clip job may land on its node from a reload lane: the node holds no
 * result, or the one it holds came from an OLDER job or run — one that ended before this job did,
 * by the stamp every lane writes. Never over this job's own result (it already landed), a newer
 * one, or a UGC Clip's fanned-out batch (one job is one of its clips, never the batch).
 *
 * A result no lane stamped gives way to the stamped job, as UGC Creator's options do. A stamped
 * result whose end cannot be read may be the newer one, and is kept — except where the job is
 * the run the node shows in flight (`inFlight`: the poll restored after a reload, the node still
 * pointing at the job): what the node holds was there before that run began.
 */
export function ugcJobMayLand(
  data: Out,
  job: { readonly id: string; readonly endedAt?: string | null },
  opts: { readonly inFlight?: boolean } = {},
): boolean {
  if (holdsClipBatch(data)) return false
  const holds = holdsUgcRunResult(data) || (typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl !== "")
  if (!holds) return true
  const shown = data[RESULTS_RUN_ID_KEY]
  if (shown === job.id) return false
  if (typeof shown !== "string" || shown === "") return true
  const shownEnded = timeOf(data[RESULTS_RUN_ENDED_AT_KEY])
  if (!Number.isFinite(shownEnded)) return opts.inFlight === true
  const jobEnded = timeOf(job.endedAt)
  return Number.isFinite(jobEnded) && shownEnded < jobEnded
}
