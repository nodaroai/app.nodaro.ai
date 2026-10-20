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
 *    high: the frames of the edit wired in when it is known now; for an edit
 *    an Edit Plan is about to make, the episode's length this run on each
 *    camera the plan reads (`plannedEditFrames`); for a video wired instead of an edit, its
 *    recorded length (as Speaker View's video mode reads it). A length not
 *    known before the run is 180 minutes on each camera the run will frame
 *    (decided 2026-10-20, `speakerFramesCeilingBlocks`): one for a video, the
 *    cameras an Edit Plan or Speaker Map reads for the edit it is about to
 *    make — at most 6; when the cameras cannot be counted either, the ceiling
 *    of 180 minutes on each of 6 cameras, 130 blocks. It leans high so that a
 *    run the balance check lets start is not refused its own hold mid-run.
 *
 * Pure; never mutates its input.
 */
import { INPUT_NODE_TYPES } from "@nodaro/shared/apps"
import { editPlanSavedOutput, transcriptDurationSec } from "@nodaro/shared/edl"
import {
  EDL_LENGTH_PRESERVING_TYPES,
  editPlanMasterOrigin,
  mediaLengthSecOf,
  persistedEdlPlan,
  resolveGraphOrigin,
  speakerMapClockOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate"
import { runWireLengthSec } from "./utility-wire-length"
import {
  SPEAKER_FRAMES_MAX_SOURCE_MS,
  SPEAKER_FRAMES_SAMPLE_FPS,
  SPEAKER_FRAMES_SPAN_MARGIN_MS,
  coerceSpeakerFramesEdits,
  speakerFramesLiveExclusions,
  speakerFramesScope,
  type SpeakerFramesScopeSource,
} from "./speaker-frames"
import { editPlanProducerKind, editPlanSourceKind } from "./edit-plan-source-kind"
import { bypassTeleports } from "./teleport-bypass"
import { usecaseMediaKindOf } from "./use-case-expand"
import { MULTICAM_SPEAKER_MAP_TYPE } from "./speaker-map-step"

/** Base credits per started block of sampled frames (decided 2026-10-16: one
 *  rate for every footage class). The ONE value behind `STATIC_CREDIT_COSTS`,
 *  the `model_pricing` row, the editor's cold-cache row and the docs' worked
 *  examples; tests pin each copy to it. */
export const SPEAKER_FRAMES_CREDITS_PER_BLOCK = 2

/** Sampled frames in one block. */
export const SPEAKER_FRAMES_FRAMES_PER_BLOCK = 1000

/** Cameras the estimate's ceiling assumes (Speaker View shows at most six). */
export const SPEAKER_FRAMES_CEILING_SOURCES = 6

/** The most frames one camera of an edit samples over an episode of
 *  `episodeSec`: at most 180 minutes, plus the 2 s margins each side, at 2 fps
 *  (21,608 at the cap) — the bound every planned edit and the unknown-length
 *  ceiling count per camera. */
export function speakerFramesCameraFrames(episodeSec: number): number {
  const perSourceMs = Math.min(episodeSec * 1000, SPEAKER_FRAMES_MAX_SOURCE_MS) + 2 * SPEAKER_FRAMES_SPAN_MARGIN_MS
  return Math.ceil((perSourceMs * SPEAKER_FRAMES_SAMPLE_FPS) / 1000)
}

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

/**
 * The estimate when the length is not known before the run but the cameras
 * the run will frame are (decided 2026-10-20): 180 minutes on each of them
 * (`speakerFramesCameraFrames`, the margins included), at most 6 — never above
 * the 130-block ceiling. One video: 22 blocks; 3 cameras: 65; 6: 130. A count
 * that is not a whole number of at least one is the ceiling (never low).
 */
export function speakerFramesCeilingBlocks(cameras: number): number {
  if (!Number.isInteger(cameras) || cameras < 1) return SPEAKER_FRAMES_CEILING_BLOCKS
  const frames = Math.min(cameras, SPEAKER_FRAMES_CEILING_SOURCES) * speakerFramesCameraFrames(SPEAKER_FRAMES_MAX_SOURCE_MS / 1000)
  return Math.min(SPEAKER_FRAMES_CEILING_BLOCKS, speakerFramesBlocks(frames))
}

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

/** The frames of an edit (one, a pack, or a fan-in's list), with the node's
 *  untick list; undefined when it cannot be read. */
function framesOfEdit(raw: unknown, data: Record<string, unknown>): number | undefined {
  const coerced = coerceSpeakerFramesEdits(raw)
  if (!coerced.ok) return undefined
  const scope = speakerFramesScope({ edits: coerced.edits, excludeSourceIds: speakerFramesLiveExclusions(coerced.edits, excludedOf(data)) })
  if (!scope.ok) return undefined
  return speakerFramesScopeFrames(scope.sources)
}

/** The blocks of an edit; the ceiling when it cannot be read. */
function blocksOfEdit(raw: unknown, data: Record<string, unknown>): number {
  const frames = framesOfEdit(raw, data)
  return frames === undefined ? SPEAKER_FRAMES_CEILING_BLOCKS : speakerFramesBlocks(frames)
}

/**
 * A source's length this run, read only where this run cannot change it: a
 * step that holds its result, an input node, or what a running step is
 * estimated to make (`runWireLengthSec`) — never the saved length of a step
 * about to run again. Undefined when not known.
 */
function originLengthThisRun(
  origin: EstimateGraphNode | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
): number | undefined {
  if (!origin) return undefined
  const settled = (o: EstimateGraphNode): boolean => !rerunIds.has(o.id) || INPUT_NODE_TYPES.has(o.type ?? "")
  const sec = settled(origin)
    ? mediaLengthSecOf(dataOf(origin))
    : runWireLengthSec(origin.id, nodes, edges, rerunIds, { planOutputOf, otherSec: (o) => (settled(o) ? mediaLengthSecOf(dataOf(o)) : undefined) })
  return sec !== undefined && sec > 0 ? sec : undefined
}

/** The most frames an edit a step is ABOUT to make can sample. `lengthKnown`
 *  false: its length this run is not known, so `frames` is 180 minutes on each
 *  of its cameras (decided 2026-10-20) and the estimate is held to the
 *  130-block ceiling (`speakerFramesCeilingBlocks`). */
interface PlannedEdit {
  readonly frames: number
  readonly lengthKnown: boolean
}

/** A planned edit over `cameras` cameras of an episode of `episodeSec`, or of
 *  unknown length (180 minutes on each). Undefined — the ceiling — for none. */
function plannedOver(cameras: number, episodeSec: number | undefined): PlannedEdit | undefined {
  if (cameras === 0) return undefined
  const sec = episodeSec ?? SPEAKER_FRAMES_MAX_SOURCE_MS / 1000
  return { frames: cameras * speakerFramesCameraFrames(sec), lengthKnown: episodeSec !== undefined }
}

/**
 * The most frames the whole-recording edit a Speaker Map is ABOUT to make can
 * sample (decided 2026-10-20): one segment over its clock recording
 * (`speakerMapClockOrigin`), so on each camera it reads at most that length
 * plus the two margins (at most 180 minutes), at 2 fps. When the clock's
 * length this run is not known, 180 minutes on each camera — the scope
 * refuses a source that keeps more, and the one segment keeps all of it.
 * A source is a camera by exactly the run's rule: the kind both engines give
 * each row the map is handed (`usecaseMediaKindOf`, on the wire's own pip,
 * teleports walked as the run walks them) — a node that hands on either kind
 * (Adjust Volume on its video pip, a Voice Changer on its video) is a camera,
 * and the map keeps every source that is not audio as one. Undefined — the
 * ceiling — when it reads no camera.
 */
function plannedSpeakerMapFrames(
  map: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
): PlannedEdit | undefined {
  const clockSec = originLengthThisRun(speakerMapClockOrigin(map, nodes, edges), nodes, edges, rerunIds, planOutputOf)
  const cameras = new Set<string>()
  for (const e of bypassTeleports(nodes, edges)) {
    if (e.target !== map.id || e.targetHandle !== "sources") continue
    if (usecaseMediaKindOf(nodes.find((n) => n.id === e.source), e.sourceHandle) === "video") cameras.add(e.source)
  }
  return plannedOver(cameras.size, clockSec)
}

/**
 * The most frames an edit an Edit Plan is ABOUT to make can sample (decided
 * 2026-10-17). It must never be below what the run will hold for it, so:
 *  - the scope samples the kept spans of the master clock on every VIDEO
 *    source of the edit, padded 2 s each side and clamped only at zero — so on
 *    each source at most the episode the plan spans plus the two margins (at
 *    most 180 minutes, as the scope refuses past it). A camera's own recorded
 *    length does not bound it: the reserve counts the master's spans on a
 *    camera that stopped early;
 *  - a source is a camera or sound only by exactly the run's rule
 *    (`editPlanSourceKind`: the kind the plan's source settings set, else the
 *    producer's) — the run samples only cameras;
 *  - the plan works over the end of the transcript it is handed, so the
 *    episode is known only when that transcript comes from a Transcribe here:
 *    one that runs again ends within its recording, read at its length this
 *    run; one that does not hands on the transcript it holds, read at that
 *    transcript's end (its recording may have been rewired since). The episode
 *    is the longer of that and the master;
 *  - a length is read only where this run cannot change it: a step that holds
 *    its result, an input node, or what a running step is estimated to make
 *    (`runWireLengthSec`) — never the saved length of a step about to run again.
 * When the episode's length is not known (decided 2026-10-20): 180 minutes on
 * each camera the plan reads, but only when a Transcribe about to run hears
 * the plan's master — the run refuses a master over 180 minutes, so the
 * transcript the plan spans ends within them. Undefined — the ceiling — when
 * the plan reads no camera, when its transcript is not made by a Transcribe
 * here (the plan spans that transcript's end, which no recording bounds), or
 * when its length is not known and the transcript is not heard from the
 * master this run (a longer recording, or one that is not a source). Clips,
 * trailers and tightened cuts all keep within the episode, so one bound serves
 * every mode; the node's untick list is not applied (it names the edit's
 * source ids, which the plan mints when it runs).
 */
function plannedEditFrames(
  plan: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
): PlannedEdit | undefined {
  const lengthThisRun = (origin: EstimateGraphNode | undefined) => originLengthThisRun(origin, nodes, edges, rerunIds, planOutputOf)
  const master = editPlanMasterOrigin(plan, nodes, edges)
  const masterSec = lengthThisRun(master)
  const tEdge = edges.find((e) => e.target === plan.id && e.targetHandle === "transcript")
  const transcriber = tEdge ? resolveGraphOrigin(nodes.find((n) => n.id === tEdge.source), nodes, edges) : undefined
  // A transcript from anywhere else may run past every recording, and the plan
  // spans its end: no bound per camera holds, so the ceiling.
  if (transcriber?.type !== "transcribe") return undefined
  let heardSec: number | undefined
  let heardMaster = false
  if (rerunIds.has(transcriber.id)) {
    const heardEdge = edges.find((e) => e.target === transcriber.id)
    const heard = heardEdge ? resolveGraphOrigin(nodes.find((n) => n.id === heardEdge.source), nodes, edges) : undefined
    heardSec = lengthThisRun(heard)
    heardMaster = heard !== undefined && heard.id === master?.id
  } else {
    heardSec = transcriptDurationSec(heldTranscript(dataOf(transcriber)))
  }
  const episodeSec = masterSec !== undefined && heardSec !== undefined ? Math.max(masterSec, heardSec) : undefined
  // Unknown length: 180 minutes a camera only when the transcript is the master's (decided 2026-10-20).
  if (episodeSec === undefined && !heardMaster) return undefined

  const cfg = (dataOf(plan).sourceConfig as Record<string, { kind?: unknown } | undefined> | undefined) ?? {}
  const cameras = new Set<string>()
  for (const e of edges) {
    if (e.target !== plan.id || e.targetHandle !== "sources") continue
    const origin = resolveGraphOrigin(nodes.find((n) => n.id === e.source), nodes, edges)
    // Both engines key the source settings by the source node, teleports walked.
    if (origin && editPlanSourceKind(cfg[origin.id]?.kind, editPlanProducerKind(origin.type)) === "video") cameras.add(origin.id)
  }
  return plannedOver(cameras.size, episodeSec)
}

/** The transcript a Transcribe holds and hands on its `json` output: the active
 *  result's, else the bare active-result field (as both engines' output
 *  extractors read it); a JSON string is parsed. Undefined when unreadable. */
function heldTranscript(data: Record<string, unknown>): unknown {
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<{ transcript?: unknown } | null>) : []
  const active = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const held = results[active]?.transcript ?? data.generatedJson
  if (typeof held !== "string") return held
  try {
    return JSON.parse(held) as unknown
  } catch {
    return undefined
  }
}

/** What one `edl` wire will deliver: an edit its producer holds now, or the
 *  frames bound of one a plan is about to make; undefined — the ceiling — else. */
type WireEdit = { readonly held: unknown } | { readonly planned: PlannedEdit }

function wireEdit(
  producer: EstimateGraphNode | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
  walked: ReadonlySet<string> = new Set(),
): WireEdit | undefined {
  if (!producer || walked.has(producer.id)) return undefined
  if (!rerunIds.has(producer.id)) {
    const plan = persistedEdlPlan(producer, planOutputOf)
    return blank(plan) ? undefined : { held: plan }
  }
  if (producer.type === "edit-plan") {
    const planned = plannedEditFrames(producer, nodes, edges, rerunIds, planOutputOf)
    return planned === undefined ? undefined : { planned }
  }
  if (producer.type === MULTICAM_SPEAKER_MAP_TYPE) {
    const planned = plannedSpeakerMapFrames(producer, nodes, edges, rerunIds, planOutputOf)
    return planned === undefined ? undefined : { planned }
  }
  // A re-running Camera Switch keeps every span and source of the edit it reads.
  if (EDL_LENGTH_PRESERVING_TYPES.has(producer.type ?? "")) {
    const upstream = edges.find((e) => e.target === producer.id && e.targetHandle === "edl")
    if (!upstream) return undefined
    const origin = resolveGraphOrigin(nodes.find((n) => n.id === upstream.source), nodes, edges)
    return wireEdit(origin, nodes, edges, rerunIds, planOutputOf, new Set([...walked, producer.id]))
  }
  return undefined
}

/**
 * How many blocks a Speaker Frames run is ESTIMATED at — what the node's pill,
 * the Run button, the run-confirm dialog, the precheck, the run quote and a
 * listing price it at. It leans high (decided 2026-10-16):
 *  - the edit on the `edl` wire is KNOWN when every producer feeding it is not
 *    re-running in this run (`rerunIds`) and holds a plan now (Edit Plan's,
 *    with the person's review applied; Camera Switch's, a clip batch
 *    included): the frames that edit samples on the ticked cameras. A
 *    re-running Camera Switch reads through to the edit it switches;
 *  - an edit an Edit Plan is about to make (decided 2026-10-17): on each
 *    camera the plan reads, the episode's length this run (plus the 2 s
 *    margins) at 2 fps — never the ceiling when that length is known
 *    (`plannedEditFrames` says when it is). An edit a Speaker Map is about
 *    to make (decided 2026-10-20): its clock recording's length this run on
 *    each camera it reads (`plannedSpeakerMapFrames`). When that length is
 *    not known (decided 2026-10-20): 180 minutes on each camera the plan or
 *    map reads, held to the 130-block ceiling (`speakerFramesCeilingBlocks`).
 *    Every wire on the handle folds into one run, as the run itself folds
 *    them: their frames add, then round to blocks once;
 *  - a video wired instead of an edit (decided 2026-10-16): the whole video at
 *    2 fps over its recorded length — the length Speaker View's video mode
 *    reads (`runWireLengthSec`: an upload's recorded length, a render's
 *    estimated length, what a Trim, Loop or Combine Videos passes on), at
 *    most 180 minutes; its length not known before the run: 180 minutes on
 *    its one camera, 22 blocks (decided 2026-10-20);
 *  - nothing wired, an edit set on the node itself: its frames;
 *  - anything else — a producer that holds nothing yet, a plan or map that
 *    reads no camera, a plan whose transcript is not made by a Transcribe
 *    here, an edit that cannot be read, another producer about to run — the
 *    ceiling: 180 minutes on each of 6 cameras, 130 blocks;
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
    let heldWires = 0
    let plannedFrames = 0
    let lengthUnknown = false
    for (const edge of edlEdges) {
      const producer = resolveGraphOrigin(nodes.find((n) => n.id === edge.source), nodes, edges)
      const found = wireEdit(producer, nodes, edges, rerunIds, planOutputOf)
      if (!found) return SPEAKER_FRAMES_CEILING_BLOCKS
      if ("planned" in found) {
        plannedFrames += found.planned.frames
        if (!found.planned.lengthKnown) lengthUnknown = true
        continue
      }
      heldWires++
      // A batch's empty entry is a clip that delivered nothing: the wire folds what there is.
      if (Array.isArray(found.held)) edits.push(...found.held.filter((v) => !blank(v)))
      else edits.push(found.held)
    }
    const heldFrames = heldWires > 0 ? framesOfEdit(edits, data) : 0
    if (heldFrames === undefined) return SPEAKER_FRAMES_CEILING_BLOCKS
    const blocks = speakerFramesBlocks(heldFrames + plannedFrames)
    // A length not known before the run is 180 minutes a camera, on at most 6 (decided 2026-10-20).
    return lengthUnknown ? Math.min(SPEAKER_FRAMES_CEILING_BLOCKS, blocks) : blocks
  }
  const videoEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "video")
  if (videoEdges.length > 0) {
    // Both engines keep the last value a second wire lands: price the longest.
    let sec = 0
    for (const edge of videoEdges) {
      const known = runWireLengthSec(edge.source, nodes, edges, rerunIds, { planOutputOf, otherSec: (o) => mediaLengthSecOf(dataOf(o)) })
      // Its length not known before the run: 180 minutes on its one camera (decided 2026-10-20).
      if (known === undefined || !(known > 0)) return speakerFramesCeilingBlocks(1)
      sec = Math.max(sec, known)
    }
    return speakerFramesBlocks(speakerFramesBareVideoFrames(Math.min(sec, SPEAKER_FRAMES_MAX_SOURCE_MS / 1000)))
  }
  if (!blank(data.edl)) return blocksOfEdit(data.edl, data)
  return 1
}
