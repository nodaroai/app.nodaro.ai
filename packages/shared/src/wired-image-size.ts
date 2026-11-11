/**
 * The displayed size of the image wired into a node's `image` input, as the
 * node it comes from records it: the result it shows (`generatedResults` at
 * `activeResultIndex`, its `width` and `height`), else its own `width` and
 * `height` (an upload). What an estimate that cannot read the file (the
 * editor's badge, a workflow estimate) knows of a photo's size. `undefined`
 * when no wired node records one.
 */
import type { SourceImageSize } from "./model-catalog.js"

export interface SizedGraphNode {
  id?: string
  data?: Record<string, unknown> | null
}

export interface SizedGraphEdge {
  source?: string
  target?: string | null
  targetHandle?: string | null
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0

export function recordedImageSize(data: Record<string, unknown> | null | undefined): SourceImageSize | undefined {
  if (!data) return undefined
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown> | null>) : []
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const shown = results[index] ?? results[0]
  if (shown && positive(shown.width) && positive(shown.height)) return { width: shown.width, height: shown.height }
  if (positive(data.width) && positive(data.height)) return { width: data.width, height: data.height }
  return undefined
}

export function wiredImageSize(
  nodeId: string,
  nodes: ReadonlyArray<SizedGraphNode>,
  edges: ReadonlyArray<SizedGraphEdge>,
): SourceImageSize | undefined {
  for (const edge of edges) {
    if (edge.target !== nodeId || !edge.source || (edge.targetHandle ?? "image") !== "image") continue
    const size = recordedImageSize(nodes.find((n) => n.id === edge.source)?.data)
    if (size) return size
  }
  return undefined
}

/** True when a node carries an inpainting mask: its own `maskUrl`, or a wire into its `mask` input. */
export function nodeIsMasked(
  nodeId: string,
  data: Record<string, unknown> | null | undefined,
  edges: ReadonlyArray<SizedGraphEdge> | undefined,
): boolean {
  if (typeof data?.maskUrl === "string" && data.maskUrl.length > 0) return true
  return (edges ?? []).some((e) => e.target === nodeId && e.targetHandle === "mask")
}
