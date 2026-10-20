/**
 * Trailer on two or more recordings or a Master audio (decided 2026-10-17):
 * the multicam front before the trailer plan — the recordings, the sound,
 * Audio Sync (unless already in sync), Speaker Map with two or more cameras —
 * Transcribe on the sound, the trailer plan over every recording with its
 * role and Audio Sync's offsets, Camera Switch between the plan and the render
 * with two or more cameras, then the one-recording tail unchanged (the intro
 * card through Combine Videos, one Social Media Format per chosen format, the
 * formats output map). The render resolves each camera from the edit itself
 * (no sources wire), as the Multicam Cut template's does, and reads the
 * switched edit's renamed transcript. Every format is a video: Trailer refuses
 * a sound-only run, so there is no audio branch. Pure.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode } from "./use-case-graph"
import type { UseCaseSources } from "./use-case-registry"
import { USE_CASE_CAMERAS_DEFAULTS } from "./use-case-cameras"
import { usecaseEdge, usecaseNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseMulticamFront, usecaseSwitchNode, usecaseSwitchWires } from "./use-case-multicam"
import { TRAILER_NODE_IDS, TRAILER_RENDER_TYPE, withTrailerTail } from "./episode-trailer-parts"
import type { EpisodeTrailerGraph, EpisodeTrailerSettings } from "./episode-trailer-graph"

const ID = TRAILER_NODE_IDS

/** Trailer's chain on several recordings or a Master audio (see the module note). */
export function buildTrailerMulticamGraph(settings: EpisodeTrailerSettings, sources: UseCaseSources): EpisodeTrailerGraph {
  const cameras = settings.cameras ?? USE_CASE_CAMERAS_DEFAULTS
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  // Trailer's own Transcribe, named to the front (Speaker Map) and the switch.
  const transcript = { nodeId: ID.transcribe, handle: "json" } as const
  const front = usecaseMulticamFront(sources, cameras, { transcript })
  const pipOf = (id: string) => (front.nodes.find((n) => n.id === id)!.type === "upload-audio" ? "audio" : "video")
  const nodes: UseCaseGraphNode[] = [
    ...front.nodes,
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    usecaseNode(ID.plan, "edit-plan", 2, 1, {
      label: "Trailer Plan", mode: "trailer", planTier: settings.planTier, instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [...front.planSourceIds], sourceConfig: { ...front.planSourceConfig },
    }),
  ]
  const edges: UseCaseGraphEdge[] = [
    ...front.edges,
    usecaseEdge(front.sound.nodeId, front.sound.pip, ID.transcribe, "audio"),
    ...front.planSourceIds.map((id) => usecaseEdge(id, pipOf(id), ID.plan, "sources")),
    ...(front.offsets ? [usecaseEdge(front.offsets.nodeId, front.offsets.handle, ID.plan, "offsets")] : []),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
  ]
  const sw = usecaseSwitchNode(front, cameras, 3, 1)
  if (sw) {
    nodes.push(sw)
    edges.push(...usecaseSwitchWires(front, { nodeId: ID.plan, handle: "edl" }, transcript))
  }
  // With a switch the render reads the switched edit and its renamed transcript; without one, the plan's edit and the transcript.
  const edit = sw ? { nodeId: sw.id, handle: "edl" } : { nodeId: ID.plan, handle: "edl" }
  const named = sw ? { nodeId: sw.id, handle: "transcript" } : transcript
  nodes.push(usecaseNode(ID.render, TRAILER_RENDER_TYPE, 4, 1, { label: "Apply Cut", output: "video", quality, crossfadeMs: 0 }))
  edges.push(usecaseEdge(edit.nodeId, edit.handle, ID.render, "edl"), usecaseEdge(named.nodeId, named.handle, ID.render, "transcript"))
  const multicam = { ...(front.offsets ? { sync: front.offsets } : {}), ...(front.map ? { map: front.map } : {}) }
  return withTrailerTail(settings, sources, { nodes, edges, renderColumn: 4, ...(Object.keys(multicam).length > 0 ? { multicam } : {}) })
}
