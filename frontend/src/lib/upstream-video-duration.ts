/**
 * Walk the workflow graph from (nodeId, handleId) to find the upstream
 * video producer's duration. Best-effort: returns null when no edge,
 * no source node, or no duration field. The backend ffprobe is authoritative
 * for billing; this is for credit-display estimates only.
 *
 * One reading for the node's own price (`useUpstreamVideoDuration`) and the
 * workflow estimate (`getModelIdentifier`), so the two quote the same row.
 */
export function upstreamVideoDurationSec(
  nodeId: string,
  handleId: string,
  nodes: ReadonlyArray<{ id: string; data?: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string | null }>,
): number | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) return null
  const src = nodes.find((n) => n.id === edge.source)
  if (!src) return null
  const data = (src.data ?? {}) as Record<string, unknown>
  // Keys that actually EXIST on node data. `generatedVideoDuration` and
  // `uploadedDuration` were listed here and are written by nothing in the app —
  // grep finds each exactly once, in this file — so two of the four lookups were
  // always dead, which is part of why a wired video fell through to the pricing
  // ceiling. Pinned by `hooks/__tests__/use-upstream-video-duration.test.ts`.
  const candidates: Array<number | undefined> = [
    data.duration as number | undefined,
    data.durationSeconds as number | undefined,
    data.videoDuration as number | undefined,
    data.videoDurationSec as number | undefined,
    data.sourceDurationSec as number | undefined,
    // upload-audio (and URL-imported audio) write their length ONLY here —
    // without this an edit-plan audio master shows the pricing ceiling badge.
    (data.metadata as { durationSeconds?: number } | undefined)?.durationSeconds,
  ]
  return candidates.find((v) => typeof v === "number" && v > 0) ?? null
}
