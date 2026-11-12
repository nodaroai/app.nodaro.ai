/**
 * A video generation node's Seedance reference task type (`referenceTaskType`,
 * "Use the reference video as") as its run will resolve it, from what an
 * ESTIMATE knows of the graph: the one answer the editor's price of the node,
 * its settings panel and both estimators' reading of the video it makes share.
 *
 * The run resolves `referenceTaskType` before it prices, by the shared rule
 * (`resolveSeedanceTaskType`, @nodaro/shared): a declared Edit runs at
 * automatic length, an Extend at automatic length runs at the model's default,
 * and anything it cannot honour moves nothing. This module only hands that rule
 * what the graph knows — never restates it.
 *
 * What the graph knows of each wired reference video is its recorded length
 * (`forwardedVideoLengthSec`: an upload's measured length, a generated clip's
 * recorded or configured length). A clip it does not know — none recorded, or
 * its source re-runs in this run, so the run sends a new clip — counts as the
 * model's longest accepted clip (`VIDEO_REF_VIDEO_DURATION_LIMITS`), as the
 * server counts a clip it cannot measure: the declaration holds and the quote
 * is the higher one. A quote may be above the charge, never below it.
 */
import {
  listedSeedanceTaskType,
  resolveSeedanceTaskType,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  type DeclaredSeedanceTaskType,
} from "@nodaro/shared/models"
import { referenceModalityForHandle } from "@nodaro/shared/workflow"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { bypassTeleports } from "./teleport-bypass"
import { forwardedVideoLengthSec } from "./utility-wire-length"

const NO_RERUNS: ReadonlySet<string> = new Set()

/**
 * One entry per reference-video wire into `nodeId`, in wire order: the clip's
 * recorded length in seconds, or `undefined` when it is not known (none
 * recorded, or its source is in `rerunIds`, so the run sends a new clip).
 */
export function wiredReferenceVideoSec(
  nodeId: string,
  nodes: readonly EstimateGraphNode[],
  rawEdges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string> = NO_RERUNS,
): Array<number | undefined> {
  const edges = bypassTeleports(nodes, rawEdges)
  return edges
    .filter((e) => e.target === nodeId && referenceModalityForHandle(e.targetHandle) === "video")
    .map((e) => {
      const origin = resolveGraphOrigin(nodes.find((n) => n.id === e.source), nodes, edges)
      return !origin || rerunIds.has(origin.id) ? undefined : forwardedVideoLengthSec(origin)
    })
}

/**
 * Whether a run's Edit or Extend holds, and the length it runs (and is priced)
 * at — what the panel's locks, the price id and the length estimate need. Not
 * the full declaration: the image and audio wired in are not read (only Edit
 * and Extend move a lock or the length, and both need a reference video).
 */
export interface SeedanceTaskTypeAsRun {
  /**
   * `edit` or `extend` when that declaration holds for the wired clips;
   * `reference` only while a reference video is wired (a run that declares it
   * with only images or audio wired reads `undefined` here, and it moves
   * nothing either way); `undefined` otherwise.
   */
  readonly taskType: DeclaredSeedanceTaskType | undefined
  /** The node's own `duration`, exactly as given, unless the declaration moves it. */
  readonly duration: number | string | undefined
}

/**
 * The ONE answer to "does this node's run edit or extend, and at what length":
 * the shared `resolveSeedanceTaskType` fed what the graph knows.
 *
 * @param provider the model the run uses.
 * @param duration the length the node asks for.
 * @param data the node's data: `referenceTaskType`, `aspectRatio` (a draft
 *   declares as any other run does, so Draft is not read).
 * @param referenceVideoSec one entry per wired reference video
 *   ({@link wiredReferenceVideoSec}); `undefined` = its length is not known,
 *   counted as the model's longest accepted clip, as the server counts it.
 */
export function seedanceTaskTypeAsRun(args: {
  readonly provider: string | undefined
  readonly duration: number | string | undefined
  readonly data: Readonly<Record<string, unknown>>
  readonly referenceVideoSec: ReadonlyArray<number | undefined>
}): SeedanceTaskTypeAsRun {
  const { provider, duration, data } = args
  // A node that never touches the setting runs, and is priced, exactly as before.
  if (!provider || listedSeedanceTaskType(provider, data.referenceTaskType) === undefined) return { taskType: undefined, duration }
  const longest = VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.maxSec
  const parsed = typeof duration === "string" ? parseInt(duration, 10) : duration
  const asked = parsed === undefined || Number.isNaN(parsed) ? undefined : parsed
  const run = resolveSeedanceTaskType({
    provider,
    requested: data.referenceTaskType,
    // Only Edit and Extend move anything, and both need a reference video, so
    // the other media counts change nothing read here.
    referenceImageCount: 0,
    referenceAudioCount: 0,
    referenceVideoSec: args.referenceVideoSec.map((sec) => sec ?? longest),
    aspectRatio: typeof data.aspectRatio === "string" ? data.aspectRatio : undefined,
    duration: asked,
  })
  // Unmoved: the length exactly as the node gave it, so its id is today's.
  return { taskType: run.taskType, duration: run.duration === asked ? duration : run.duration }
}
