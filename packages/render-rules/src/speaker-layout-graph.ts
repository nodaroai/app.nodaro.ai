/**
 * Speaker Layout's built chain (decided 2026-10-17): the whole recording,
 * framed by speaker, the same length — no plan, no cut.
 *   one recording:  source → transcribe; Speaker View's video mode (the
 *                   recording on `video`, the transcript), automatic boxes
 *                   for the even split; following faces adds Speaker Frames
 *                   on the video and wires its tracks.
 *   2+ recordings or Master audio: the multicam front with Speaker Map's
 *                   whole-recording edit → [Camera Switch with 2+ cameras] →
 *                   Speaker View on the edit; following faces adds Speaker
 *                   Frames on that edit.
 *   review on:      the render is a proxy preview; Render final renders it at final.
 * The automatic boxes skip a speaker under the talk-time floor
 * (`autoRegionsTalkFloor`, decided 2026-10-18): a stray diarizer label never
 * takes a box of its own. Pure: fresh objects every call.
 */
import { EDL_TARGET_ASPECTS, SPEAKER_SWITCH_IDS, isKnownSpeakerEmphasisStyle, type EdlTargetAspect } from "@nodaro/shared/edl"
import { SPEAKER_VIEW_LAYOUT_SETTINGS } from "./speaker-view-settings"
import { drawnTightenFraming, type TightenFramingLayout } from "./tighten-episode-graph"
import type { LayoutOutputMap, UseCaseGraph, UseCaseGraphEdge, UseCaseGraphNode, UseCaseMediaKind } from "./use-case-graph"
import type { UseCaseSettings, UseCaseSources } from "./use-case-registry"
import { USE_CASE_CAMERAS_DEFAULTS, resolveUseCaseCameras, usecaseRecordingNodeId, type UseCaseCameras, type UseCaseSourcesShape } from "./use-case-cameras"
import { usecaseIsMulticam, usecaseMulticamFront, usecaseSwitchNode, usecaseSwitchWires } from "./use-case-multicam"
import {
  USE_CASE_FRAMES_NODE_ID,
  resolveUseCaseFramingSource,
  usecaseFramesNode,
  usecaseFramesWires,
  type ResolvedFramingSource,
  type UseCaseFramingSource,
} from "./use-case-framing"
import { usecaseEdge, usecaseNode, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseTypeOfBuilder } from "./use-case-rows"

export interface SpeakerLayoutSettings {
  readonly targetAspect: EdlTargetAspect
  readonly layout: TightenFramingLayout
  readonly switchType: string
  readonly emphasisStyle: string
  /** Always resolved (a new node: no pre-P3 run to keep byte-equal). */
  readonly framingSource: ResolvedFramingSource
  readonly reviewBeforeRender: boolean
  /** Always resolved: the defaults for one recording. */
  readonly cameras: UseCaseCameras
}

/**
 * What a Speaker Layout node or body that names no framing source reads
 * (decided 2026-10-17: a new node): `auto`. The ONE value: its spec's
 * `absentFramingSource` is this, and the resolver reads it for a direct call.
 */
export const SPEAKER_LAYOUT_ABSENT_FRAMING_SOURCE: UseCaseFramingSource = "auto"

export const SPEAKER_LAYOUT_DEFAULTS: SpeakerLayoutSettings = Object.freeze({
  targetAspect: "9:16",
  layout: "stacked",
  // The first switch Speaker View's rule allows for the default layout (decided 2026-10-20): Stacked keeps
  // its slots, so Pan and Zoom are ruled out and a new node never opens on a greyed choice.
  switchType: "cut",
  emphasisStyle: "scale",
  // The absent default as it resolves at load; a run resolves it per call.
  framingSource: resolveUseCaseFramingSource(undefined, SPEAKER_LAYOUT_ABSENT_FRAMING_SOURCE),
  reviewBeforeRender: false,
  cameras: USE_CASE_CAMERAS_DEFAULTS,
})

export const SPEAKER_LAYOUT_NODE_IDS = Object.freeze({
  source: usecaseRecordingNodeId(0),
  transcribe: "uc-transcribe",
  render: "uc-render",
  frames: USE_CASE_FRAMES_NODE_ID,
} as const)

const isEmphasis = (v: unknown): v is string => typeof v === "string" && isKnownSpeakerEmphasisStyle(v)

/**
 * The node's raw settings as a run reads them: an unknown value falls back to
 * its default, and a layout Speaker View does not draw at the aspect is
 * snapped as the render snaps it. An absent framing source is the spec's
 * `absentFramingSource` (`auto`, decided 2026-10-17: a new node), written in
 * by the descriptor before this runs (use-case-specs.ts).
 */
export function resolveSpeakerLayoutSettings(
  raw: UseCaseSettings | undefined,
  _mediaKind: UseCaseMediaKind,
  shape?: UseCaseSourcesShape,
): SpeakerLayoutSettings {
  const r = raw ?? {}
  const d = SPEAKER_LAYOUT_DEFAULTS
  const aspect = typeof r.targetAspect === "string" && (EDL_TARGET_ASPECTS as readonly string[]).includes(r.targetAspect) ? (r.targetAspect as EdlTargetAspect) : d.targetAspect
  const layout = typeof r.layout === "string" && SPEAKER_VIEW_LAYOUT_SETTINGS.includes(r.layout) ? (r.layout as TightenFramingLayout) : d.layout
  return {
    targetAspect: aspect,
    layout: drawnTightenFraming(aspect, layout).layout,
    switchType: typeof r.switchType === "string" && SPEAKER_SWITCH_IDS.includes(r.switchType) ? r.switchType : d.switchType,
    emphasisStyle: isEmphasis(r.emphasisStyle) ? r.emphasisStyle : d.emphasisStyle,
    // Read through its descriptor, an absent source is already the spec's `absentFramingSource`; a direct call falls back like every field here.
    framingSource: resolveUseCaseFramingSource(r.framingSource, SPEAKER_LAYOUT_ABSENT_FRAMING_SOURCE),
    reviewBeforeRender: r.reviewBeforeRender === true,
    cameras: resolveUseCaseCameras(r.cameras, shape),
  }
}

/** Speaker Layout's graph: the framed recording, from a render that names no plan. */
export type SpeakerLayoutGraph = UseCaseGraph & { readonly outputMap: LayoutOutputMap }

/** The chain one Speaker Layout run executes (see the module note). */
export function buildSpeakerLayoutGraph(settings: SpeakerLayoutSettings, sources: UseCaseSources): SpeakerLayoutGraph {
  const ID = SPEAKER_LAYOUT_NODE_IDS
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const render = usecaseNode(ID.render, "speaker-view", 3, 1, {
    label: "Speaker Layout",
    quality,
    targetAspect: settings.targetAspect,
    layout: settings.layout,
    switchType: settings.switchType,
    emphasisStyle: settings.emphasisStyle,
    autoRegions: true,
    // Speakers under the talk-time floor get no box of their own (decided 2026-10-18).
    autoRegionsTalkFloor: true,
  })
  const tracking = settings.framingSource === "tracking"
  const nodes: UseCaseGraphNode[] = []
  const edges: UseCaseGraphEdge[] = []
  let multicam: LayoutOutputMap["multicam"]
  if (!usecaseIsMulticam(sources)) {
    const pip = sources.media.kind === "audio" ? "audio" : "video"
    nodes.push(usecaseSourceNode(ID.source, sources.media, 0, 1), usecaseTranscribeNode(ID.transcribe, 1, 0), render)
    edges.push(
      usecaseEdge(ID.source, pip, ID.transcribe, "audio"),
      usecaseEdge(ID.source, pip, ID.render, "video"),
      usecaseEdge(ID.transcribe, "json", ID.render, "transcript"),
    )
    if (tracking) {
      nodes.push(usecaseFramesNode(2, 2))
      edges.push(...usecaseFramesWires({ video: { nodeId: ID.source, handle: pip }, transcript: { nodeId: ID.transcribe, handle: "json" }, renderId: ID.render }))
    }
  } else {
    // Speaker Map always runs: its whole-recording edit is the cut, even on one camera.
    const front = usecaseMulticamFront(sources, settings.cameras, { withMap: true })
    const map = front.map!
    nodes.push(...front.nodes, usecaseTranscribeNode(ID.transcribe, 1, 0))
    edges.push(...front.edges, usecaseEdge(front.sound.nodeId, front.sound.pip, ID.transcribe, "audio"))
    const sw = usecaseSwitchNode(front, settings.cameras, 3, 0)
    const whole = { nodeId: map.nodeId, handle: "edl" }
    if (sw) {
      nodes.push(sw)
      edges.push(...usecaseSwitchWires(front, whole))
    }
    // With a switch the render reads the switched edit and its renamed transcript; without one, Speaker Map's edit and the transcript.
    const edit = sw ? { nodeId: sw.id, handle: "edl" } : whole
    const named = sw ? { nodeId: sw.id, handle: "transcript" } : { nodeId: ID.transcribe, handle: "json" }
    nodes.push(render)
    edges.push(usecaseEdge(edit.nodeId, edit.handle, ID.render, "edl"), usecaseEdge(named.nodeId, named.handle, ID.render, "transcript"))
    if (tracking) {
      nodes.push(usecaseFramesNode(3, 2))
      edges.push(...usecaseFramesWires({ edl: edit, transcript: named, renderId: ID.render }))
    }
    multicam = { ...(front.offsets ? { sync: front.offsets } : {}), map }
  }
  return {
    // Its type is read from its builder key at call time — render-rules names no type id (decided 2026-10-18).
    nodeType: usecaseTypeOfBuilder("speakerLayout"),
    nodes,
    edges,
    outputMap: {
      kind: "layout",
      media: { nodeId: ID.render, handle: "video" },
      preview: { nodeId: ID.render, handle: "video" },
      json: { nodeId: ID.render, handle: "json" },
      transcript: { nodeId: ID.render, handle: "transcript" },
      renderNodeId: ID.render,
      ...(multicam ? { multicam } : {}),
    },
  }
}
