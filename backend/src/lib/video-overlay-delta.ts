/**
 * D10 on the id-keyed DELTA save (`PATCH /v1/workflows/:id` with `delta` —
 * also the target of MCP `update_workflow_json`'s `delta` form). A delta
 * carries only what changed, so an agent's edge-only edit that wires an
 * EXISTING Video Overlay node's layer handle never touches that node, and its
 * stale `imageUrl` would stay stored. Two pure helpers let the route
 *   (1) tell from the delta alone whether the save needs the stored graph, and
 *   (2) compute the node upserts the write-boundary pass implies: the delta's
 *       own upserts normalised against the edge set the save leaves behind,
 *       plus every stored `video-overlay` node the pass changes (it joins the
 *       upserts whole — the RPC replaces a node by id).
 * The route reads the stored row only when (1) says so.
 */
import { normalizeVideoOverlayNodes, videoOverlaySlotOfHandle } from "@nodaro/shared"

export interface DeltaNode {
  readonly id: string
  readonly type?: unknown
  readonly data?: unknown
  readonly [key: string]: unknown
}

export interface DeltaEdge {
  readonly target?: unknown
  readonly targetHandle?: unknown
  readonly [key: string]: unknown
}

export interface VideoOverlayDeltaInput {
  readonly upsertNodes?: ReadonlyArray<DeltaNode>
  readonly deleteNodeIds?: ReadonlyArray<string>
  readonly upsertEdges?: ReadonlyArray<DeltaEdge>
}

/**
 * Does this delta touch Video Overlay? An upserted `video-overlay` node, or an
 * upserted edge into a layer handle (`overlay`…`overlay12`). Image Overlay
 * renders the same handle ids, so a wire into ITS layers also pays for the
 * read — harmless: the pass changes nothing on that node type.
 */
export function deltaTouchesVideoOverlay(delta: VideoOverlayDeltaInput): boolean {
  return (
    (delta.upsertNodes ?? []).some((n) => n.type === "video-overlay") ||
    (delta.upsertEdges ?? []).some((e) => videoOverlaySlotOfHandle(typeof e.targetHandle === "string" ? e.targetHandle : undefined) > 0)
  )
}

/**
 * The node upserts after the D10 pass. `storedNodes`: the row's current node
 * list; `edgesAfter`: the edge set the save leaves behind (`mergeDeltaEdges`).
 * The delta's own upserts (normalised), then every stored `video-overlay`
 * node — neither upserted nor deleted by this delta — that the pass changes.
 * The delta's upsert array BY REFERENCE when nothing changes.
 */
export function videoOverlayDeltaUpserts(
  delta: VideoOverlayDeltaInput,
  storedNodes: unknown,
  edgesAfter: ReadonlyArray<DeltaEdge>,
): ReadonlyArray<DeltaNode> {
  const upserts = delta.upsertNodes ?? []
  const normalised = normalizeVideoOverlayNodes(upserts, edgesAfter)
  const upsertIds = new Set(upserts.map((n) => String(n.id)))
  const deleted = new Set(delta.deleteNodeIds ?? [])
  const stored = (Array.isArray(storedNodes) ? (storedNodes as DeltaNode[]) : []).filter(
    (n) => n.type === "video-overlay" && !upsertIds.has(String(n.id)) && !deleted.has(String(n.id)),
  )
  const healed = normalizeVideoOverlayNodes(stored, edgesAfter)
  const pulledIn = healed.filter((n, i) => n !== stored[i])
  return pulledIn.length === 0 && normalised === upserts ? upserts : [...normalised, ...pulledIn]
}
