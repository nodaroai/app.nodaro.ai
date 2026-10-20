/**
 * A use-case node's Cameras settings and recordings order follow its wires
 * (decided 2026-10-17). Like the audio lock, an invariant of the graph and not
 * of a panel: the workflow store applies it in the same write as the change
 * (`usecaseNodeInvariantsGraph`, from its one `set`) — one undo step, panel
 * open or not — and a graph adopted as stored (a load, a remote change, a save
 * conflict's merge) is taken as it is; the next local write fixes it.
 *
 * What it keeps, against the recordings the node's TYPE reads (its
 * `maxRecordings`, in its order — never the viewer's one-recording run, so an
 * admin's choice is not wiped while their availability loads):
 *  - `cameras.wide`: a position past the recordings, or one that is sound
 *    only, is cleared (None);
 *  - `cameras.speakerCameras`: an override naming a camera past the
 *    recordings is dropped (0, the wide shot, always stays);
 *  - `mediaOrder`: a node no longer wired into Recordings is forgotten.
 * With nothing wired nothing is judged (a paste or a rewire made in two steps
 * keeps the settings), and a value the run cannot read is left as it is (the
 * run ignores it). A Master audio is another input and never a camera. A
 * wire through a Teleport pair is keyed by the Receive it was drawn from (what
 * `mediaOrder` is saved under) and judged by what it carries. Pure.
 */
import { bypassTeleports, isUseCaseNodeType, usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"
import { usecaseCarriedWiresOver } from "@/lib/use-case-wired-recordings"
import { usecaseAudioLockGraph } from "@/lib/use-case-audio-lock"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type Data = Readonly<Record<string, unknown>>

const isPlainRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** The node's data with its Cameras and order following its wires, or undefined when they already do. */
function fixedData(node: WorkflowNode, nodes: readonly WorkflowNode[], carried: () => readonly WorkflowEdge[]): Data | undefined {
  const data = node.data as Data
  const cameras = data.cameras
  const order = data.mediaOrder
  if (!isPlainRecord(cameras) && !Array.isArray(order)) return undefined
  // The one wire reader (lib/use-case-wired-recordings.ts), by the type's own limit.
  const { wired, recordings } = usecaseCarriedWiresOver(node, usecaseDescriptor(node.type as UseCaseNodeType).maxRecordings, nodes, carried())
  if (wired.length === 0) return undefined
  const next: Record<string, unknown> = { ...data }
  let changed = false

  if (Array.isArray(order)) {
    const ids = new Set(wired.map((w) => w.nodeId))
    const kept = order.filter((id) => typeof id === "string" && ids.has(id))
    if (kept.length !== order.length) {
      // Nothing left to order: the key goes (never a key holding no value).
      if (kept.length > 0) next.mediaOrder = kept
      else delete next.mediaOrder
      changed = true
    }
  }

  if (isPlainRecord(cameras)) {
    const kinds = recordings.map((r) => r.kind)
    const fixed: Record<string, unknown> = { ...cameras }
    let camerasChanged = false
    const wide = cameras.wide
    if (typeof wide === "number" && kinds[wide - 1] !== "video") {
      fixed.wide = null
      camerasChanged = true
    }
    if (isPlainRecord(cameras.speakerCameras)) {
      const overrides = Object.fromEntries(Object.entries(cameras.speakerCameras).filter(([, cam]) => !(typeof cam === "number" && cam > kinds.length)))
      if (Object.keys(overrides).length !== Object.keys(cameras.speakerCameras).length) {
        fixed.speakerCameras = overrides
        camerasChanged = true
      }
    }
    if (camerasChanged) {
      next.cameras = fixed
      changed = true
    }
  }
  return changed ? next : undefined
}

/**
 * The graph's nodes with every use-case node's Cameras and order following
 * its wires (see the module note). `changed: false` hands back `nodes` itself
 * — the same array and the same node objects — so nothing is written.
 */
export function usecaseCamerasGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): { readonly nodes: readonly WorkflowNode[]; readonly changed: boolean } {
  let out: WorkflowNode[] | undefined
  let carried: readonly WorkflowEdge[] | undefined
  const carry = () => (carried ??= bypassTeleports(nodes, edges))
  nodes.forEach((node, i) => {
    if (!isUseCaseNodeType(node.type ?? undefined)) return
    const data = fixedData(node, nodes, carry)
    if (!data) return
    out ??= [...nodes]
    out[i] = { ...node, data: data as WorkflowNode["data"] }
  })
  return out ? { nodes: out, changed: true } : { nodes, changed: false }
}

/**
 * Every invariant a use-case node keeps over the graph a store write leaves,
 * in that one write: the audio lock (`usecaseAudioLockGraph`, judged on what
 * this viewer's run reads — `multicam`), then the Cameras and order
 * (`usecaseCamerasGraph`). A write that touches neither the nodes nor the
 * wires hands `nodes` back as it is.
 */
export function usecaseNodeInvariantsGraph(
  prevNodes: readonly WorkflowNode[],
  prevEdges: readonly WorkflowEdge[],
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  opts: { readonly multicam?: boolean } = {},
): readonly WorkflowNode[] {
  const locked = usecaseAudioLockGraph(prevNodes, prevEdges, nodes, edges, opts)
  if (locked === prevNodes && edges === prevEdges) return locked
  return usecaseCamerasGraph(locked, edges).nodes
}
