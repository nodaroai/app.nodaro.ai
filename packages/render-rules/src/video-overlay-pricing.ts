/**
 * How a RUN ESTIMATE prices a Video Overlay node — the one rule the server's
 * run estimate (`estimateNodeCredits`) and the editor's (its Run button, its
 * pill, Execute All) both read, so the two cannot drift. What a run is charged
 * is decided from the request itself (`videoOverlayCreditId`,
 * `videoOverlayVideoUnits` in `@nodaro/shared/credits`): the route and the
 * workflow run measure the base before anything is reserved.
 *
 * Before a run, an estimate uses what is known. It prices the node on the
 * video row when the run carries a video layer, or may and it cannot be known
 * yet:
 *   - a stored layer with a `videoUrl` on a slot no wire replaces;
 *   - a layer handle or the `layerPlan` handle wired from a source that hands
 *     it a video, or whose content is not known before the run — the shared
 *     `videoOverlayWireMediumBeforeRun` decides, by the run's own wired-kind
 *     rule on a layer handle (a pip row, a declared port, a single-medium
 *     producer, else a List's own cells — their extension, then the column's
 *     type), and on the plan handle only a plan pip row (UGC Cards' plan is
 *     images only).
 * Otherwise it is the flat image row. A quote is never below the run. The
 * base's length is the `video` wire's, at most the cap; unknown is the cap
 * (`videoOverlayVideoUnits`).
 */
import {
  declaredOutputMediaType,
  listColumnMediaType,
  VIDEO_OVERLAY_LAYER_PLAN_HANDLE,
  videoOverlayHasVideoLayer,
  videoOverlaySlotOfHandle,
  videoOverlayWireMediumBeforeRun,
  type VideoOverlayLayerInput,
} from "@nodaro/shared/video"
import { VIDEO_OVERLAY_PRICING } from "@nodaro/shared/credits"
import type { EstimateGraphEdge, EstimateGraphNode } from "./apply-edl-estimate"

const isTeleport = (type: string | null | undefined): boolean => type === "teleport-send" || type === "teleport-receive"

/** The node and handle a wire's file comes from, through any teleports (the source the input resolvers route by). */
function wireOrigin(
  edge: EstimateGraphEdge,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
): { readonly node: EstimateGraphNode | undefined; readonly handle: string | null | undefined } {
  let node = nodes.find((n) => n.id === edge.source)
  let handle = edge.sourceHandle
  const visited = new Set<string>()
  while (node && isTeleport(node.type) && !visited.has(node.id)) {
    visited.add(node.id)
    const id = node.id
    const inEdge = edges.find((e) => e.target === id)
    if (!inEdge) break
    handle = inEdge.sourceHandle
    node = nodes.find((n) => n.id === inEdge.source)
  }
  return { node, handle }
}

const recordOf = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * The cells a List hands on from the pip `handle` that are already known: the
 * column the pip names (else its first, as the input resolvers route it), or
 * its legacy newline-separated `items`. None when anything is wired INTO the
 * List — its cells are then filled at run time.
 */
function knownListCells(list: EstimateGraphNode, handle: string | null | undefined, edges: readonly EstimateGraphEdge[]): string[] {
  if (edges.some((e) => e.target === list.id)) return []
  const data = recordOf(list.data)
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
  const columns = Array.isArray(data.columns) ? data.columns.map(recordOf) : []
  const rows = Array.isArray(data.rows) ? data.rows : []
  if (columns.length > 0 && rows.length > 0) {
    const named = columns.findIndex((c) => c.handleId === handle)
    const column = named >= 0 ? named : 0
    return rows.map((row) => (Array.isArray(row) ? text(row[column]) : "")).filter(Boolean)
  }
  return text(data.items).split("\n").map((s) => s.trim()).filter(Boolean)
}

/**
 * Whether a wire may hand this node a video layer: it does, or its content is
 * not known before the run. A List's cells are files only on a layer handle; on
 * the plan handle they are a plan's text, not known as files.
 */
function wireMayCarryVideo(edge: EstimateGraphEdge, nodes: readonly EstimateGraphNode[], edges: readonly EstimateGraphEdge[]): boolean {
  const { node, handle } = wireOrigin(edge, nodes, edges)
  const source = {
    type: node?.type,
    handle,
    declaredMediaType: declaredOutputMediaType(node?.type, node?.data, handle),
    columnMediaType: listColumnMediaType(node?.type, node?.data, handle),
  }
  if (edge.targetHandle === VIDEO_OVERLAY_LAYER_PLAN_HANDLE) return videoOverlayWireMediumBeforeRun(source, { target: "plan" }) !== "image"
  const knownUrls = node?.type === "list" ? knownListCells(node, handle, edges) : []
  return videoOverlayWireMediumBeforeRun(source, { target: "layer", knownUrls }) !== "image"
}

/**
 * Whether a run estimate prices this Video Overlay on the video row (see the
 * module doc): a stored video layer on an unwired slot, or a layer or plan
 * wire that may hand it a video.
 */
export function videoOverlayQuotesVideo(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
): boolean {
  const inputs = edges.filter((e) => e.target === node.id)
  if (inputs.some((e) => e.targetHandle === VIDEO_OVERLAY_LAYER_PLAN_HANDLE && wireMayCarryVideo(e, nodes, edges))) return true
  const wiredSlots = new Set<number>()
  for (const e of inputs) {
    const slot = videoOverlaySlotOfHandle(e.targetHandle)
    if (slot === 0) continue
    wiredSlots.add(slot)
    if (wireMayCarryVideo(e, nodes, edges)) return true
  }
  const data = recordOf(node.data)
  // Untrusted node data: a non-object entry reads as no layer (`videoOverlayHasVideoLayer`).
  const layers = Array.isArray(data.layers) ? (data.layers as Array<VideoOverlayLayerInput | null>) : []
  return layers.some((layer, i) => !wiredSlots.has(i + 1) && videoOverlayHasVideoLayer([layer]))
}

/**
 * The base's length, in seconds, as a run estimate reads it — its `video`
 * wire's (else the one wire on no layer or plan handle: the base the input
 * resolvers fill from it) — before the cap. `undefined` when it is not known.
 * What the editor warns the cap from; {@link videoOverlayBaseSec} prices it.
 */
export function videoOverlayBaseWireSec(
  inputs: ReadonlyArray<{ readonly targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
): number | undefined {
  let wire = inputs.findIndex((e) => e.targetHandle === "video")
  if (wire < 0) wire = inputs.findIndex((e) => e.targetHandle !== VIDEO_OVERLAY_LAYER_PLAN_HANDLE && videoOverlaySlotOfHandle(e.targetHandle) === 0)
  return wire >= 0 ? secs[wire] : undefined
}

/**
 * The base length, in seconds, a run estimate prices a Video Overlay with a
 * video layer at: {@link videoOverlayBaseWireSec}, at most the cap.
 * `undefined` when that length is not known: the cap is quoted.
 */
export function videoOverlayBaseSec(
  inputs: ReadonlyArray<{ readonly targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
): number | undefined {
  const sec = videoOverlayBaseWireSec(inputs, secs)
  return sec === undefined ? undefined : Math.min(sec, VIDEO_OVERLAY_PRICING.MAX_BASE_SEC)
}
