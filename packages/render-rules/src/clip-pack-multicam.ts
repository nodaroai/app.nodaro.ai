/**
 * Clip Pack on two or more recordings or a Master audio (decided 2026-10-17):
 * the multicam plan chain (use-case-multicam-chain.ts) — the recordings, the
 * sound, Audio Sync unless already in sync, Speaker Map with two or more
 * cameras, Transcribe on the sound, the clips plan over every recording with
 * its role and Audio Sync's offsets — then Camera Switch ONCE PER CLIP with
 * two or more cameras (the plan → switch wire keeps Edit Plan's default:
 * each, one switch per clip), and the per-clip render reading each switched
 * clip (the switch → render wire keeps Camera Switch's default: each on
 * `edl`, FAN_OUT_EACH_HANDLES) and the switch's one renamed transcript. The
 * render resolves each camera from the edit itself (no sources wire), as the
 * Multicam Cut template's does. Framed and following faces, ONE Speaker
 * Frames run over every switched clip (its `edl` wire folds the pack,
 * FAN_IN_TARGETS) and its tracks — one value — into every clip's render.
 * Then the one-recording tail: captions per clip and the clips output map,
 * which gains `multicam` (Audio Sync's and Speaker Map's results).
 *
 * Recordings that are all sound only (the route refuses them; a canvas may
 * still wire them) make audio clips of the sound alone: nothing to cut to.
 * Pure.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode } from "./use-case-graph"
import type { UseCaseSources } from "./use-case-registry"
import { USE_CASE_CAMERAS_DEFAULTS, usecaseRecordings } from "./use-case-cameras"
import { usecaseEdge, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseMulticamSoundNode } from "./use-case-multicam"
import { usecaseMulticamPlanChain } from "./use-case-multicam-chain"
import { usecaseFramesNode, usecaseFramesWires } from "./use-case-framing"
import { CLIP_PACK_NODE_IDS, clipPackPlanNode, clipPackRenderNode, withClipPackTail } from "./clip-pack-parts"
import type { ClipPackGraph, ClipPackSettings } from "./clip-pack-graph"

const ID = CLIP_PACK_NODE_IDS

/** Clip Pack's chain on several recordings or a Master audio (see the module note). */
export function buildClipPackMulticamGraph(settings: ClipPackSettings, sources: UseCaseSources): ClipPackGraph {
  const cameras = settings.cameras ?? USE_CASE_CAMERAS_DEFAULTS
  if (!usecaseRecordings(sources).some((r) => r.kind === "video")) {
    // The sound alone, which keeps its own id, so the estimate's wire mapping finds it.
    const sound = usecaseMulticamSoundNode(sources, cameras)
    const nodes: UseCaseGraphNode[] = [
      sound,
      usecaseTranscribeNode(ID.transcribe, 1, 0),
      clipPackPlanNode(settings, null, [sound.id], {}),
      clipPackRenderNode(settings, null, "audio", 3),
    ]
    const edges: UseCaseGraphEdge[] = [
      usecaseEdge(sound.id, "audio", ID.transcribe, "audio"),
      usecaseEdge(sound.id, "audio", ID.plan, "sources"),
      usecaseEdge(sound.id, "audio", ID.render, "sources"),
      usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
      usecaseEdge(ID.plan, "edl", ID.render, "edl"),
    ]
    return withClipPackTail(settings, { nodes, edges, framed: false, audio: true, renderColumn: 3 })
  }
  const framing = settings.framing
  const chain = usecaseMulticamPlanChain(sources, cameras, {
    transcribeId: ID.transcribe,
    planId: ID.plan,
    plan: (order, config) => clipPackPlanNode(settings, framing, order, config),
    switchAt: { column: 3, row: 1 },
  })
  const { nodes, edges, edit, named } = chain
  nodes.push(clipPackRenderNode(settings, framing, "video", 4))
  edges.push(usecaseEdge(edit.nodeId, edit.handle, ID.render, "edl"), usecaseEdge(named.nodeId, named.handle, ID.render, "transcript"))
  // Following faces: one Speaker Frames run over the edits and the transcript the render reads, after the render.
  if (framing && settings.framingSource === "tracking") {
    nodes.push(usecaseFramesNode(3, 2))
    edges.push(...usecaseFramesWires({ edl: edit, transcript: named, renderId: ID.render }))
  }
  return withClipPackTail(settings, { nodes, edges, framed: !!framing, audio: false, renderColumn: 4, ...(chain.multicam ? { multicam: chain.multicam } : {}) })
}
