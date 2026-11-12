/**
 * How long the video a GENERATION node hands on is, when a run that charges
 * the step after it by that length (Trim, Loop, Combine Videos) is estimated
 * (decided 2026-11-11). A length-following run (`lengthFollowingBoundSec`: an
 * automatic length, a Seedance Edit / Extend) records the length its video
 * really is, at most its upper bound, and the step after it is charged by that.
 * So, before the video exists, every quote reads that bound; afterwards, the
 * recorded length. The editor's run estimate and the server's both read a
 * generation source through this one rule.
 */
import {
  applyDefaultVideoSelection,
  DEFAULT_VIDEO_TO_VIDEO_PROVIDER,
  isSeedanceVideoEditProvider,
  resolveVideoProviderForMode,
  SEEDANCE_VIDEO_EDIT_SHAPE,
} from "@nodaro/shared/models"
import { withWiredSettings } from "@nodaro/shared/nodes"
import type { EstimateGraphEdge, EstimateGraphNode } from "./apply-edl-estimate"
import { LENGTH_RECORDING_VIDEO_NODE_TYPES, lengthFollowingBoundSec, withoutRecordedVideoLength, type VideoRunRequest } from "./length-following-video"
import { nodeProviders } from "./node-fan-out"
import { seedanceTaskTypeAsRun, wiredReferenceVideoSec } from "./seedance-task-type-as-run"

/** The model a legacy Image to Video / Text to Video node runs when it names none (the workflow run's own default). */
export const LEGACY_VIDEO_NODE_DEFAULT_PROVIDER = "kling"

const positiveSec = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/**
 * The requests a generation node's run sends, one per model it runs (several
 * when it names several; Generate Video's model may be its image or its text
 * twin, decided by what is wired at run time, so both are read), each with the
 * length and reference task type the run resolves for the clips wired in.
 */
function generationRunRequests(
  origin: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
): VideoRunRequest[] {
  const type = origin.type ?? ""
  // A wired Settings input (Provider, Duration) is part of what the run sends.
  const data = (withWiredSettings({ id: origin.id, type, data: origin.data }, nodes, edges).data ?? {}) as Record<string, unknown>
  if (type === "video-to-video") {
    // Its Seedance lane is an edit, always at an automatic length.
    const provider = str(data.provider) ?? DEFAULT_VIDEO_TO_VIDEO_PROVIDER
    return isSeedanceVideoEditProvider(provider) ? [{ provider, duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration }] : []
  }
  const asked = data.duration as number | string | undefined
  const selected = applyDefaultVideoSelection({ provider: str(data.provider), duration: asked })
  const named = nodeProviders(type, data) ?? [type === "generate-video" ? selected.provider : (str(data.provider) ?? LEGACY_VIDEO_NODE_DEFAULT_PROVIDER)]
  const providers = type === "generate-video"
    ? named.flatMap((p) => [resolveVideoProviderForMode(p, "image-to-video"), resolveVideoProviderForMode(p, "text-to-video")])
    : [...named]
  const duration = type === "generate-video" ? selected.duration : asked
  let clips: Array<number | undefined> | undefined
  return [...new Set(providers)].map((provider) => {
    clips ??= wiredReferenceVideoSec(origin.id, nodes, edges, rerunIds)
    const run = seedanceTaskTypeAsRun({ provider, duration, data, referenceVideoSec: clips })
    return { provider, duration: run.duration, referenceTaskType: run.taskType }
  })
}

/** The result a node hands on (its active one), when it has one. */
function activeResult(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const results = Array.isArray(data?.generatedResults) ? (data.generatedResults as unknown[]) : []
  const index = typeof data?.activeResultIndex === "number" ? data.activeResultIndex : 0
  const row = results[index]
  return row !== null && typeof row === "object" && typeof (row as { url?: unknown }).url === "string" ? (row as Record<string, unknown>) : undefined
}

/**
 * The length, in seconds, a RUN estimate reads off the video a source hands
 * on, for a step charged by that length (Trim, Loop, Combine Videos):
 *
 * - a video generation source (Generate Video, Image to Video, Text to Video,
 *   Video to Video) the estimated run EXECUTES (it is in `rerunIds`), or that
 *   has no result to hand on: when its run follows its own length, the most it
 *   can make (`lengthFollowingBoundSec`; several models: the longest of them);
 *   otherwise `today`'s reading of it, never its last result's recorded length;
 * - a generation source that does not run and whose active result recorded a
 *   length: that length (as for a render);
 * - anything else: `today`'s reading.
 *
 * A re-run source is never quoted at its last result's length.
 *
 * @param today the caller's own reading of a source, as before this rule (the
 *   editor: the node's recorded or stored length; the server: a recording's).
 */
export function generationSourceEstimateSec(
  origin: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  today: (origin: EstimateGraphNode) => number | undefined,
): number | undefined {
  if (!LENGTH_RECORDING_VIDEO_NODE_TYPES.has(origin.type ?? "")) return today(origin)
  const result = activeResult(origin.data as Record<string, unknown> | undefined)
  // Read as it was before any run recorded a length: a stored length, never a take's.
  const before = today(withoutRecordedVideoLength(origin))
  if (!rerunIds.has(origin.id) && result !== undefined) return positiveSec(result.duration) ?? before
  const bounds = generationRunRequests(origin, nodes, edges, rerunIds).flatMap((run) => {
    const bound = lengthFollowingBoundSec(run)
    return bound === undefined ? [] : [bound]
  })
  return bounds.length === 0 ? before : Math.max(...bounds, before ?? 0)
}
