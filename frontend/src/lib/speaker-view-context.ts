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
import { speakerViewContext, speakerViewTracksAtRest, type SpeakerViewContext, type SpeakerViewTracksResolved } from "@nodaro/render-rules"
import { renderTranscriptOutputOf } from "@nodaro/shared"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
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

/** The edits wired into `nodeId`'s `edl` handle (the node's inline `edl` when none is wired). */
export function speakerViewEdits(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): unknown[] {
  const wire = lastWire(nodeId, "edl", edges)
  const source = wire ? nodes.find((n) => n.id === wire.source) : undefined
  if (source) return savedEdits(source)
  const own = dataOf(nodes.find((n) => n.id === nodeId)).edl
  return own === undefined || own === null || own === "" ? [] : [own]
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
