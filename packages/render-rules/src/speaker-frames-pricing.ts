/**
 * Speaker Frames' price (P3.7, decided 2026-10-16): one credit id,
 * `speaker-frames`, charged per STARTED BLOCK of 1,000 sampled frames, at one
 * rate for every footage class:
 *
 *   credits = rate × max(1, ⌈frames ÷ 1,000⌉)        rate = 2 (base credits)
 *
 * The minimum of one block is per job. There is no vendor cost (`provider_cost`
 * 0) and no per-service margin row: the margin is the deployment's read-time
 * markup, as for Apply EDL.
 *
 * FRAMES are what one run samples (`speakerFramesScope`, P3-5 / P3-24): per
 * ticked source, the kept spans padded 2 s each side and merged, at 2 frames a
 * second (`⌈Σ span × 2⌉` per source, summed over the sources); a clip pack is
 * ONE run over the union of its clips' spans. A bare video samples the whole
 * video: `⌈seconds × 2⌉`, its length probed by the server.
 *
 * THREE NUMBERS, one rule:
 *  - the RESERVE, made when the job is created, from a server-computed frame
 *    count (the validated edit's spans, a bare video's probed length) — never a
 *    client's number. Two sites reserve and must agree: the cloud plugin's
 *    route (a BASE figure its credit guard marks up) and the workflow run
 *    (`speakerFramesCreditOverride`, backend). The cross-repo fixture
 *    `backend/src/lib/__tests__/fixtures/speaker-frames-pricing-cases.json`
 *    holds the plugin's copy of this rule to this file;
 *  - the CHARGE, the frames the job actually sampled (a span past the end of
 *    its video samples nothing), at the rate the reserve used — never above
 *    the reserve, the rest released;
 *  - the ESTIMATE before a run (`speakerFramesEstimateBlocks`), which leans
 *    high: the frames of the edit wired in when it is known now; for a video
 *    wired instead of an edit, its recorded length (as Speaker View's video
 *    mode reads it); else the ceiling of 180 minutes on each of 6 cameras —
 *    129,600 frames, 130 blocks.
 *
 * Pure; never mutates its input.
 */
import { editPlanSavedOutput } from "@nodaro/shared/edl"
import {
  mediaLengthSecOf,
  persistedEdlPlan,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate"
import { runWireLengthSec } from "./utility-wire-length"
import {
  SPEAKER_FRAMES_MAX_SOURCE_MS,
  SPEAKER_FRAMES_SAMPLE_FPS,
  coerceSpeakerFramesEdits,
  speakerFramesLiveExclusions,
  speakerFramesScope,
  type SpeakerFramesScopeSource,
} from "./speaker-frames"

/** Base credits per started block of sampled frames (decided 2026-10-16: one
 *  rate for every footage class). The ONE value behind `STATIC_CREDIT_COSTS`,
 *  the `model_pricing` row, the editor's cold-cache row and the docs' worked
 *  examples; tests pin each copy to it. */
export const SPEAKER_FRAMES_CREDITS_PER_BLOCK = 2

/** Sampled frames in one block. */
export const SPEAKER_FRAMES_FRAMES_PER_BLOCK = 1000

/** Cameras the estimate's ceiling assumes (Speaker View shows at most six). */
export const SPEAKER_FRAMES_CEILING_SOURCES = 6

/** The estimate's ceiling: 180 minutes on each of 6 cameras at 2 fps. */
export const SPEAKER_FRAMES_CEILING_FRAMES =
  (SPEAKER_FRAMES_MAX_SOURCE_MS / 1000) * SPEAKER_FRAMES_SAMPLE_FPS * SPEAKER_FRAMES_CEILING_SOURCES

/** Blocks a run of `frames` sampled frames is priced at: `max(1, ⌈frames ÷ 1,000⌉)`.
 *  A count that is not a finite number is priced at the ceiling (never low). */
export function speakerFramesBlocks(frames: number): number {
  if (!Number.isFinite(frames)) return speakerFramesBlocks(SPEAKER_FRAMES_CEILING_FRAMES)
  return Math.max(1, Math.ceil(frames / SPEAKER_FRAMES_FRAMES_PER_BLOCK))
}

/** The estimate's ceiling in blocks (130). */
export const SPEAKER_FRAMES_CEILING_BLOCKS = speakerFramesBlocks(SPEAKER_FRAMES_CEILING_FRAMES)

/** Frames a bare video of `durationSec` samples: the whole video at 2 fps. */
export function speakerFramesBareVideoFrames(durationSec: number): number {
  return Math.ceil(durationSec * SPEAKER_FRAMES_SAMPLE_FPS)
}

/**
 * The frames one run samples over a resolved scope: the sum of each source's
 * frames; a bare video (`frames: null`) at `bareVideoSec`. `undefined` when a
 * bare video's length is not given.
 */
export function speakerFramesScopeFrames(
  sources: readonly SpeakerFramesScopeSource[],
  bareVideoSec?: number,
): number | undefined {
  let total = 0
  for (const s of sources) {
    if (s.frames !== null) total += s.frames
    else if (typeof bareVideoSec === "number" && Number.isFinite(bareVideoSec) && bareVideoSec >= 0) total += speakerFramesBareVideoFrames(bareVideoSec)
    else return undefined
  }
  return total
}

/** BASE credits (pre-markup) for `frames` sampled frames at the code's rate. */
export function speakerFramesBaseCredits(frames: number): number {
  return SPEAKER_FRAMES_CREDITS_PER_BLOCK * speakerFramesBlocks(frames)
}

const dataOf = (n: EstimateGraphNode | undefined): Record<string, unknown> =>
  (n?.data as Record<string, unknown> | undefined) ?? {}

const blank = (v: unknown): boolean => v === undefined || v === null || v === ""

const excludedOf = (data: Record<string, unknown>): string[] =>
  Array.isArray(data.excludeSourceIds) ? (data.excludeSourceIds as unknown[]).filter((v): v is string => typeof v === "string") : []

/** The blocks of an edit (one, a pack, or a fan-in's list), with the node's
 *  untick list; the ceiling when it cannot be read. */
function blocksOfEdit(raw: unknown, data: Record<string, unknown>): number {
  const coerced = coerceSpeakerFramesEdits(raw)
  if (!coerced.ok) return SPEAKER_FRAMES_CEILING_BLOCKS
  const scope = speakerFramesScope({ edits: coerced.edits, excludeSourceIds: speakerFramesLiveExclusions(coerced.edits, excludedOf(data)) })
  if (!scope.ok) return SPEAKER_FRAMES_CEILING_BLOCKS
  const frames = speakerFramesScopeFrames(scope.sources)
  return frames === undefined ? SPEAKER_FRAMES_CEILING_BLOCKS : speakerFramesBlocks(frames)
}

/**
 * How many blocks a Speaker Frames run is ESTIMATED at — what the node's pill,
 * the Run button, the run-confirm dialog, the precheck, the run quote and a
 * listing price it at. It leans high (decided 2026-10-16):
 *  - the edit on the `edl` wire is KNOWN when every producer feeding it is not
 *    re-running in this run (`rerunIds`) and holds a plan now (Edit Plan's,
 *    with the person's review applied; Camera Switch's, a clip batch
 *    included): the frames that edit samples on the ticked cameras. Every
 *    wire on the handle folds into one run, as the run itself folds them;
 *  - a video wired instead of an edit (decided 2026-10-16): the whole video at
 *    2 fps over its recorded length — the length Speaker View's video mode
 *    reads (`runWireLengthSec`: an upload's recorded length, a render's
 *    estimated length, what a Trim, Loop or Combine Videos passes on), at
 *    most 180 minutes;
 *  - nothing wired, an edit set on the node itself: its frames;
 *  - anything else — a producer that re-plans or holds nothing yet, an edit
 *    that cannot be read, a video whose length is not known before the run —
 *    the ceiling: 180 minutes on each of 6 cameras, 130 blocks;
 *  - nothing at all: one block (the run is refused before any reserve).
 *
 * @param rerunIds ids of the nodes about to EXECUTE ({@link resolveApplyEdlEstimateMinutes}).
 * @param planOutputOf how an Edit Plan's saved output is read (the editor passes its cached reader).
 */
export function speakerFramesEstimateBlocks(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  const data = dataOf(node)
  const edlEdges = edges.filter((e) => e.target === node.id && (e.targetHandle === "edl" || e.targetHandle == null || e.targetHandle === ""))
  if (edlEdges.length > 0) {
    const edits: unknown[] = []
    for (const edge of edlEdges) {
      const producer = resolveGraphOrigin(nodes.find((n) => n.id === edge.source), nodes, edges)
      if (!producer || rerunIds.has(producer.id)) return SPEAKER_FRAMES_CEILING_BLOCKS
      const plan = persistedEdlPlan(producer, planOutputOf)
      if (blank(plan)) return SPEAKER_FRAMES_CEILING_BLOCKS
      // A batch's empty entry is a clip that delivered nothing: the wire folds what there is.
      if (Array.isArray(plan)) edits.push(...plan.filter((v) => !blank(v)))
      else edits.push(plan)
    }
    return blocksOfEdit(edits, data)
  }
  const videoEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "video")
  if (videoEdges.length > 0) {
    // Both engines keep the last value a second wire lands: price the longest.
    let sec = 0
    for (const edge of videoEdges) {
      const known = runWireLengthSec(edge.source, nodes, edges, rerunIds, { planOutputOf, otherSec: (o) => mediaLengthSecOf(dataOf(o)) })
      if (known === undefined || !(known > 0)) return SPEAKER_FRAMES_CEILING_BLOCKS
      sec = Math.max(sec, known)
    }
    return speakerFramesBlocks(speakerFramesBareVideoFrames(Math.min(sec, SPEAKER_FRAMES_MAX_SOURCE_MS / 1000)))
  }
  if (!blank(data.edl)) return blocksOfEdit(data.edl, data)
  return 1
}
