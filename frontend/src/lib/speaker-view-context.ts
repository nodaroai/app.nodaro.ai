/**
 * What the canvas knows about the edit wired into a Speaker View node (SV10):
 * its saved upstream output, read ONE way for the config panel, the quick
 * strip, the badge and the node face. The numbers come from
 * `speakerViewContext` (`@nodaro/render-rules`); this file only finds the EDL
 * and the transcript on the graph.
 *
 * Reads what the canvas already holds — a node's SAVED output — and never runs
 * anything. In clips mode Camera Switch's saved output is a batch (one JSON
 * string per clip, `__listResults`); the whole batch is read, so a setting is
 * judged against EVERY clip (SV23).
 */
import {
  speakerViewContext,
  speakerViewIdleEdit,
  speakerViewTracksAtRest,
  speakerViewUnnamedSpeakers,
  speakerViewVideoModeLive,
  type SpeakerViewContext,
  type SpeakerViewSize,
  type SpeakerViewTracksResolved,
  type SpeakerViewUnnamedSpeaker,
} from "@nodaro/render-rules"
import { renderTranscriptOutputOf } from "@nodaro/shared"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type Data = Readonly<Record<string, unknown>>

const dataOf = (node: WorkflowNode | undefined): Data => (node?.data ?? {}) as Data

/** The last wire on `handle` of `nodeId` (the value both engines keep). */
function lastWire(nodeId: string, handle: string, edges: ReadonlyArray<WorkflowEdge>): WorkflowEdge | undefined {
  return edges.filter((e) => e.target === nodeId && e.targetHandle === handle).at(-1)
}

/** The edits a node's saved output holds: one EDL, or a clip batch. */
function savedEdits(node: WorkflowNode): unknown[] {
  const data = dataOf(node)
  if (node.type === "edit-plan") {
    // The plan as the person's review leaves it (TA13), through the editor's one reader.
    const out = editPlanOutputOf(data as Record<string, unknown>)
    if (!out) return []
    return Array.isArray(out.json) ? out.json : [out.json]
  }
  if (node.type === "camera-switch") {
    const batch = data.__listResults
    if (Array.isArray(batch) && batch.length > 1) return [...batch]
    const pair = data.generatedJson as { edl?: unknown } | undefined
    return pair?.edl === undefined ? [] : [pair.edl]
  }
  const generated = data.generatedJson
  if (generated === undefined || generated === null) return []
  return Array.isArray(generated) ? generated : [generated]
}

/** The node feeding `nodeId`'s `edl` handle, if one is wired and still on the canvas. */
export function speakerViewEdlProducer(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): WorkflowNode | undefined {
  const wire = lastWire(nodeId, "edl", edges)
  return wire ? nodes.find((n) => n.id === wire.source) : undefined
}

/** Whether anything is wired into `nodeId`'s `video` handle (decided 2026-10-11). */
export function speakerViewVideoWired(nodeId: string, edges: ReadonlyArray<WorkflowEdge>): boolean {
  return lastWire(nodeId, "video", edges) !== undefined
}

/** The node feeding `nodeId`'s `video` handle, if one is wired and still on the canvas. */
export function speakerViewVideoProducer(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): WorkflowNode | undefined {
  const wire = lastWire(nodeId, "video", edges)
  return wire ? nodes.find((n) => n.id === wire.source) : undefined
}

/** The address the wired video resolves to on the canvas, read by the funnel
 *  both engines use for a node's output; undefined until the producer has one. */
export function speakerViewVideoUrl(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): string | undefined {
  const wire = lastWire(nodeId, "video", edges)
  const producer = wire ? nodes.find((n) => n.id === wire.source) : undefined
  if (!producer) return undefined
  const url = extractNodeOutput(producer, wire?.sourceHandle ?? undefined)
  return typeof url === "string" && url.trim() ? url.trim() : undefined
}

/** The wired video's pixels, when its producer saved them (an upload's metadata,
 *  a result's size). The server measures the real ones at the run; this only
 *  lets the idle badge judge the shape (D18, D10) without downloading anything. */
export function speakerViewVideoSize(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): SpeakerViewSize | undefined {
  const producer = speakerViewVideoProducer(nodeId, nodes, edges)
  if (!producer) return undefined
  const d = dataOf(producer) as { metadata?: { width?: unknown; height?: unknown }; generatedResults?: Array<{ width?: unknown; height?: unknown }>; activeResultIndex?: unknown }
  const active = Array.isArray(d.generatedResults) ? d.generatedResults[typeof d.activeResultIndex === "number" ? d.activeResultIndex : 0] : undefined
  const pick = (w: unknown, h: unknown): SpeakerViewSize | undefined =>
    typeof w === "number" && typeof h === "number" && w > 0 && h > 0 ? { width: w, height: h } : undefined
  return pick(d.metadata?.width, d.metadata?.height) ?? pick(active?.width, active?.height)
}

/**
 * What is wired into `nodeId` as its input: an edit (a wire, or the node's own
 * inline one) and/or a video. The rule wants exactly one (`speakerViewInputIssue`).
 */
export function speakerViewWiring(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): { hasEdl: boolean; hasVideo: boolean } {
  const own = dataOf(nodes.find((n) => n.id === nodeId)).edl
  return {
    hasEdl: lastWire(nodeId, "edl", edges) !== undefined || !(own === undefined || own === null || own === ""),
    hasVideo: speakerViewVideoWired(nodeId, edges),
  }
}

/** A video is fed in place of an edit (wired, whether or not it has an address
 *  yet): the panel and the region editor ask this one question. */
export function speakerViewVideoFed(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): boolean {
  const w = speakerViewWiring(nodeId, nodes, edges)
  return w.hasVideo && !w.hasEdl
}

/**
 * The edits wired into `nodeId`'s `edl` handle (the node's inline `edl` when
 * none is wired). A Speaker View with a `video` wire and no edit reads the
 * IDLE whole-clip edit (decided 2026-10-11): the shape the run builds over the
 * measured length, here over a placeholder one, so the badge, the panel, the
 * strip and the region editor read a normal edit. Only a Speaker View does:
 * a Speaker Frames node's `video` wire is its own bare video. While the wired
 * video has no address yet there is no edit (decided 2026-10-12): the idle
 * edit is built on the real address or not at all.
 */
export function speakerViewEdits(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): unknown[] {
  const wire = lastWire(nodeId, "edl", edges)
  const source = wire ? nodes.find((n) => n.id === wire.source) : undefined
  if (source) return savedEdits(source)
  const self = nodes.find((n) => n.id === nodeId)
  const own = dataOf(self).edl
  if (!(own === undefined || own === null || own === "")) return [own]
  if (self?.type === "speaker-view" && speakerViewVideoWired(nodeId, edges)) {
    // No address yet (the producer has not run): no edit. A stand-in address
    // would travel on as a source the region editor or a thumbnail takes for a file.
    const idle = speakerViewIdleEdit({
      url: speakerViewVideoUrl(nodeId, nodes, edges),
      transcript: speakerViewTranscript(nodeId, nodes, edges),
      targetAspect: dataOf(self).targetAspect,
    })
    return idle ? [idle] : []
  }
  return []
}

/** The transcript wired into `nodeId`'s `transcript` handle, from its producer's
 *  last result (a Camera Switch upstream carries `{ edl, transcript }`). */
export function speakerViewTranscript(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): unknown {
  const wire = lastWire(nodeId, "transcript", edges)
  const producer = wire ? nodes.find((n) => n.id === wire.source) : undefined
  if (!producer) return dataOf(nodes.find((n) => n.id === nodeId)).transcript
  const d = dataOf(producer) as { generatedJson?: unknown; generatedResults?: Array<{ transcript?: unknown }>; activeResultIndex?: unknown }
  const results = Array.isArray(d.generatedResults) ? d.generatedResults : []
  const fromResult = results[typeof d.activeResultIndex === "number" ? d.activeResultIndex : 0]?.transcript
  if (fromResult !== undefined) return fromResult
  // A render: the field its transcript output lands on (Speaker View's json is its EDL).
  const remapped = renderTranscriptOutputOf(producer.type)
  if (remapped) return (d as Record<string, unknown>)[remapped.dataField]
  return producer.type === "camera-switch" ? (d.generatedJson as { transcript?: unknown } | undefined)?.transcript : d.generatedJson
}

/** Whether a transcript is wired into `nodeId`, or typed into the node itself. */
export function speakerViewTranscriptWired(nodeId: string | undefined, edges: ReadonlyArray<WorkflowEdge>, data: Readonly<Record<string, unknown>>): boolean {
  if (nodeId && lastWire(nodeId, "transcript", edges)) return true
  const own = data.transcript
  return !(own === undefined || own === null || own === "")
}

/** The context of the edit wired into `nodeId`, or `undefined` while none is known yet. */
export function speakerViewContextOf(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): SpeakerViewContext | undefined {
  return speakerViewContext(speakerViewEdits(nodeId, nodes, edges), speakerViewTranscript(nodeId, nodes, edges))
}

/** Whether anything is wired into `nodeId`'s `tracks` handle (P3.9). */
export function speakerViewTracksWired(nodeId: string, edges: ReadonlyArray<WorkflowEdge>): boolean {
  return lastWire(nodeId, "tracks", edges) !== undefined
}

/** The Speaker Frames node feeding `nodeId`'s `tracks` handle, if one is wired and on the canvas. */
export function speakerViewTracksProducer(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): WorkflowNode | undefined {
  const wire = lastWire(nodeId, "tracks", edges)
  return wire ? nodes.find((n) => n.id === wire.source) : undefined
}

/**
 * The face tracks wired into `nodeId` (P3.9) as the badge, the panel and the
 * review read them: the Speaker Frames node's saved descriptor with the app's
 * labels at rest — the current rename map and that node's corrections; the
 * region match needs the stored body, which only a run (and the region editor)
 * reads. Undefined while nothing is wired; `unproduced` while Speaker Frames
 * has no output (the rule refuses that, never renders v1).
 */
export function speakerViewTracksOf(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): SpeakerViewTracksResolved | undefined {
  const producer = speakerViewTracksProducer(nodeId, nodes, edges)
  if (!producer) return undefined
  const frames = dataOf(producer)
  return speakerViewTracksAtRest({
    tracks: frames.generatedJson,
    wired: true,
    trackAssignments: frames.trackAssignments,
    transcript: speakerViewTranscript(nodeId, nodes, edges),
    data: dataOf(nodes.find((n) => n.id === nodeId)),
  })
}

/**
 * The speakers of a video-fed Speaker View that no face track names
 * (tap-first, decided 2026-10-13): read from the saved Speaker Frames result
 * behind its `tracks` wire, after the rename map and that node's corrections.
 * It is what the badge's note, the panels' "Which face is …?" and the region
 * editor's guide ask about. Empty outside video mode, before Speaker Frames
 * has a result, and while video mode is not live (R15).
 */
export function speakerViewUnnamedOf(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): SpeakerViewUnnamedSpeaker[] {
  const self = nodes.find((n) => n.id === nodeId)
  if (self?.type !== "speaker-view" || !speakerViewVideoWired(nodeId, edges) || lastWire(nodeId, "edl", edges)) return []
  if (!speakerViewVideoModeLive()) return []
  const frames = speakerViewTracksProducer(nodeId, nodes, edges)
  if (!frames) return []
  const own = dataOf(self)
  return speakerViewUnnamedSpeakers({
    tracks: dataOf(frames).generatedJson,
    trackAssignments: dataOf(frames).trackAssignments,
    transcript: speakerViewTranscript(nodeId, nodes, edges),
    speakerRegions: own.speakerRegions,
    defaultRegionKeys: own.defaultRegionKeys,
  })
}

/** The video-fed Speaker Views a Speaker Frames node's `tracks` output feeds, each with the speakers no face names. */
export function speakerFramesUnnamedViews(
  framesId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Array<{ readonly nodeId: string; readonly unnamed: SpeakerViewUnnamedSpeaker[] }> {
  const views = [...new Set(edges.filter((e) => e.source === framesId && e.targetHandle === "tracks").map((e) => e.target))]
  return views.flatMap((id) => {
    // Only the view this node is the LAST tracks wire of reads it.
    if (lastWire(id, "tracks", edges)?.source !== framesId) return []
    const unnamed = speakerViewUnnamedOf(id, nodes, edges)
    return unnamed.length > 0 ? [{ nodeId: id, unnamed }] : []
  })
}
