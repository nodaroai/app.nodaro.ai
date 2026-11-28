import type { EstimateEdge, EstimateNode } from "./credits.js"

/** Structural inputs available before execution produces the frame URLs.
 * These mirror input-resolver's typed handles and selected-node fallbacks;
 * reference images alone never occupy a Seedance start-frame slot. */
export function routedEstimateData(
  node: EstimateNode,
  nodes: readonly EstimateNode[],
  edges: readonly EstimateEdge[] | undefined,
  unknownReferenceVideos = 0,
): Record<string, unknown> {
  const data = node.data ?? {}
  const ids = new Set(nodes.map(n => n.id).filter(Boolean))
  const selected = (key: string) => typeof data[key] === "string" && ids.has(data[key])
  const wired = (handles: readonly string[]) => edges?.some(edge =>
    edge.target === node.id && edge.source && ids.has(edge.source) && handles.includes(edge.targetHandle ?? ""),
  ) === true
  const url = (key: string) => typeof data[key] === "string" && data[key].trim().length > 0
  return {
    ...data,
    hasStartFrame: wired(["startFrame", "image"]) || selected("selectedStartFrameNodeId") || url("startFrameUrl") || url("imageUrl"),
    hasEndFrame: wired(["endFrame"]) || selected("selectedEndFrameNodeId") || url("endFrameUrl"),
    unknownReferenceVideos,
  }
}
