/**
 * "Add face tracking" on Speaker View (P3-17 (c), decided 2026-10-06): insert a
 * Speaker Frames node and wire it — the same edit and the same transcript
 * Speaker View reads (P3-4 "Labels and the name space": Speaker Frames must
 * label in the edit's names, so it reads Camera Switch's renamed transcript
 * when Speaker View does), and its Face tracks into Speaker View's `tracks`.
 * Pure: the graph in, the next graph out; `applyAddFaceTracking` applies it to
 * the live canvas as ONE undo step.
 *
 * The edit wire is copied without its fan-out settings: Speaker Frames folds a
 * clip pack into one run over the union of its clips (P3-24 (a)), and Speaker
 * View matches its clips to that one set. An edit or transcript typed into
 * Speaker View is carried over as Speaker Frames' own.
 */
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export type AddFaceTrackingRefusal =
  /** The node is not a Speaker View. */
  | "not-speaker-view"
  /** Something is already wired into `tracks`. */
  | "already-wired"
  /** Speaker View reads no edit, so Speaker Frames would have nothing to sample. */
  | "no-edit"

export type AddFaceTrackingResult =
  | { readonly ok: true; readonly nodes: WorkflowNode[]; readonly edges: WorkflowEdge[]; readonly framesId: string }
  | { readonly ok: false; readonly reason: AddFaceTrackingRefusal }

/** Where the new node lands, relative to Speaker View: down and to the left, between it and its inputs. */
export const FACE_TRACKING_OFFSET = { x: -380, y: 260 } as const

const lastWire = (nodeId: string, handle: string, edges: readonly WorkflowEdge[]) =>
  edges.filter((e) => e.target === nodeId && e.targetHandle === handle).at(-1)

const blank = (v: unknown) => v === undefined || v === null || v === ""

export function planAddFaceTracking(
  graph: { readonly nodes: readonly WorkflowNode[]; readonly edges: readonly WorkflowEdge[] },
  nodeId: string,
  frames: { readonly id: string; readonly data: Record<string, unknown> },
): AddFaceTrackingResult {
  const view = graph.nodes.find((n) => n.id === nodeId)
  if (!view || view.type !== "speaker-view") return { ok: false, reason: "not-speaker-view" }
  if (lastWire(nodeId, "tracks", graph.edges)) return { ok: false, reason: "already-wired" }
  const viewData = (view.data ?? {}) as Record<string, unknown>
  const edlWire = lastWire(nodeId, "edl", graph.edges)
  if (!edlWire && blank(viewData.edl)) return { ok: false, reason: "no-edit" }
  const transcriptWire = lastWire(nodeId, "transcript", graph.edges)

  const wire = (source: string, sourceHandle: string | null | undefined, target: string, targetHandle: string): WorkflowEdge => ({
    id: `edge-${source}-${sourceHandle ?? "out"}-${target}-${targetHandle}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    targetHandle,
  })
  const node = {
    id: frames.id,
    type: "speaker-frames",
    position: { x: view.position.x + FACE_TRACKING_OFFSET.x, y: view.position.y + FACE_TRACKING_OFFSET.y },
    data: {
      ...frames.data,
      ...(!edlWire && !blank(viewData.edl) ? { edl: viewData.edl } : {}),
      ...(!transcriptWire && !blank(viewData.transcript) ? { transcript: viewData.transcript } : {}),
    },
  } as WorkflowNode
  const edges: WorkflowEdge[] = [
    ...graph.edges,
    ...(edlWire ? [wire(edlWire.source, edlWire.sourceHandle, frames.id, "edl")] : []),
    ...(transcriptWire ? [wire(transcriptWire.source, transcriptWire.sourceHandle, frames.id, "transcript")] : []),
    wire(frames.id, "tracks", nodeId, "tracks"),
  ]
  return { ok: true, nodes: [...graph.nodes, node], edges, framesId: frames.id }
}
