/**
 * Tighten Episode on two or more recordings or a Master audio (decided
 * 2026-10-17): the Multicam Cut template's chain behind the one-node settings
 * — the multicam front, Transcribe and Silence Detect on the sound, the plan
 * over every recording with its role and Audio Sync's offsets, Camera Switch
 * with two or more cameras, then P1's render / captions / music tail reading
 * the switched edit. The render resolves each camera from the edit itself (no
 * sources wire), as the template's does. With two or more cameras a framed
 * render shows each camera's own shot: Speaker View deals its automatic boxes
 * only over one camera. Framed and following faces, Speaker Frames reads the
 * edit and transcript the render reads, and its tracks feed it. An audio
 * episode is the sound's alone (nothing to cut to): P1's audio chain over the
 * sound source. Pure.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode } from "./use-case-graph"
import type { UseCaseSources } from "./use-case-registry"
import { USE_CASE_CAMERAS_DEFAULTS } from "./use-case-cameras"
import { usecaseEdge, usecaseNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseMulticamFront, usecaseMulticamSoundNode, usecaseSwitchNode, usecaseSwitchWires } from "./use-case-multicam"
import { usecaseFramesNode, usecaseFramesWires } from "./use-case-framing"
import { TIGHTEN_FRAMED_RENDER_TYPE, TIGHTEN_NODE_IDS, TIGHTEN_RENDER_TYPE, withTightenTail } from "./tighten-episode-parts"
import type { TightenEpisodeGraph, TightenEpisodeSettings } from "./tighten-episode-graph"

const ID = TIGHTEN_NODE_IDS

const silenceNode = () => usecaseNode(ID.silence, "silence-detect", 1, 2, { label: "Silence Detect", thresholdDb: -35, minSilenceMs: 700, padMs: 120 })
const planNode = (settings: TightenEpisodeSettings, sourceOrder: readonly string[], sourceConfig: Readonly<Record<string, unknown>>) =>
  usecaseNode(ID.plan, "edit-plan", 2, 1, {
    label: "Tighten Plan", mode: "tighten", planTier: settings.planTier, instructions: settings.instructions,
    ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
    sourceOrder: [...sourceOrder], sourceConfig: { ...sourceConfig },
  })

/** Tighten's chain on several recordings or a Master audio (see the module note). */
export function buildTightenMulticamGraph(settings: TightenEpisodeSettings, sources: UseCaseSources): TightenEpisodeGraph {
  const cameras = settings.cameras ?? USE_CASE_CAMERAS_DEFAULTS
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  if (settings.output === "audio") {
    // The sound alone, which KEEPS its own id (uc-master, or the audio-only
    // recording's), so the estimate's wire mapping finds it. Nothing else is built.
    const sound = usecaseMulticamSoundNode(sources, cameras)
    const nodes: UseCaseGraphNode[] = [
      sound,
      usecaseTranscribeNode(ID.transcribe, 1, 0),
      silenceNode(),
      planNode(settings, [sound.id], {}),
      usecaseNode(ID.render, TIGHTEN_RENDER_TYPE, 3, 1, { label: "Apply Cut", output: "audio", quality, crossfadeMs: 0 }),
    ]
    const edges: UseCaseGraphEdge[] = [
      usecaseEdge(sound.id, "audio", ID.transcribe, "audio"),
      usecaseEdge(sound.id, "audio", ID.silence, "in"),
      usecaseEdge(sound.id, "audio", ID.plan, "sources"),
      usecaseEdge(sound.id, "audio", ID.render, "sources"),
      usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
      usecaseEdge(ID.silence, "json", ID.plan, "silence"),
      usecaseEdge(ID.plan, "edl", ID.render, "edl"),
      usecaseEdge(ID.transcribe, "json", ID.render, "transcript"),
    ]
    return withTightenTail(settings, sources, { nodes, edges, framed: false })
  }

  const transcript = { nodeId: ID.transcribe, handle: "json" } as const
  const front = usecaseMulticamFront(sources, cameras, { transcript })
  const pipOf = (id: string) => (front.nodes.find((n) => n.id === id)!.type === "upload-audio" ? "audio" : "video")
  const nodes: UseCaseGraphNode[] = [
    ...front.nodes,
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    silenceNode(),
    planNode(settings, front.planSourceIds, front.planSourceConfig),
  ]
  const edges: UseCaseGraphEdge[] = [
    ...front.edges,
    usecaseEdge(front.sound.nodeId, front.sound.pip, ID.transcribe, "audio"),
    usecaseEdge(front.sound.nodeId, front.sound.pip, ID.silence, "in"),
    ...front.planSourceIds.map((id) => usecaseEdge(id, pipOf(id), ID.plan, "sources")),
    ...(front.offsets ? [usecaseEdge(front.offsets.nodeId, front.offsets.handle, ID.plan, "offsets")] : []),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    usecaseEdge(ID.silence, "json", ID.plan, "silence"),
  ]
  const sw = usecaseSwitchNode(front, cameras, 3, 1)
  if (sw) {
    nodes.push(sw)
    edges.push(...usecaseSwitchWires(front, { nodeId: ID.plan, handle: "edl" }, transcript))
  }
  // With a switch the render reads the switched edit and its renamed transcript; without one, the plan's edit and the transcript.
  const edit = sw ? { nodeId: sw.id, handle: "edl" } : { nodeId: ID.plan, handle: "edl" }
  const named = sw ? { nodeId: sw.id, handle: "transcript" } : { nodeId: ID.transcribe, handle: "json" }
  const framing = settings.framing
  nodes.push(framing
    ? usecaseNode(ID.render, TIGHTEN_FRAMED_RENDER_TYPE, 4, 1, { label: "Speaker Layout", quality, targetAspect: framing.aspect, layout: framing.layout, autoRegions: true })
    : usecaseNode(ID.render, TIGHTEN_RENDER_TYPE, 4, 1, { label: "Apply Cut", output: "video", quality, crossfadeMs: 0 }))
  edges.push(usecaseEdge(edit.nodeId, edit.handle, ID.render, "edl"), usecaseEdge(named.nodeId, named.handle, ID.render, "transcript"))
  // Following faces: Speaker Frames on the edit and transcript the render reads, after the render.
  if (framing && settings.framingSource === "tracking") {
    nodes.push(usecaseFramesNode(3, 2))
    edges.push(...usecaseFramesWires({ edl: edit, transcript: named, renderId: ID.render }))
  }
  const multicam = { ...(front.offsets ? { sync: front.offsets } : {}), ...(front.map ? { map: front.map } : {}) }
  return withTightenTail(settings, sources, { nodes, edges, framed: !!framing, ...(Object.keys(multicam).length > 0 ? { multicam } : {}) })
}
