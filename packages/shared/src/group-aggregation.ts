import type { OutputType } from "./presentation-utils.js"

// Intentional subset of OutputType (presentation-utils.ts:152) —
// excludes "data" (multi-output / opaque types are skipped from aggregation).
export type AggregateableType = "text" | "image" | "video" | "audio"

// Stable ordered tuple of aggregateable types — used for handle ordering + presentTypes.
export const AGGREGATEABLE_TYPES = ["text", "image", "video", "audio"] as const

export interface Member {
  nodeId: string
  type: AggregateableType
  value: string
}

export interface AggregationBuckets {
  text: string[]
  image: string[]
  video: string[]
  audio: string[]
}

export function aggregateByType(members: Member[]): AggregationBuckets {
  const buckets: AggregationBuckets = { text: [], image: [], video: [], audio: [] }
  for (const m of members) buckets[m.type].push(m.value)
  return buckets
}

export function presentTypes(buckets: AggregationBuckets): AggregateableType[] {
  return AGGREGATEABLE_TYPES.filter((t) => buckets[t].length > 0)
}

// Type guard for narrowing OutputType to AggregateableType.
export function isAggregateableType(t: OutputType | undefined): t is AggregateableType {
  return t === "text" || t === "image" || t === "video" || t === "audio"
}

// Handle id naming conventions for Group / Collect dynamic output handles + Collect's single input handle.
export const GROUP_HANDLE_PREFIX = "out-" as const
export const COLLECT_IN_HANDLE = "in" as const

export function groupHandleId(t: AggregateableType): string {
  return `${GROUP_HANDLE_PREFIX}${t}`
}

export function parseGroupHandle(h: string | null | undefined): AggregateableType | undefined {
  if (!h || !h.startsWith(GROUP_HANDLE_PREFIX)) return undefined
  const candidate = h.slice(GROUP_HANDLE_PREFIX.length) as OutputType
  return isAggregateableType(candidate) ? candidate : undefined
}

/**
 * Build a parent → children-ids map from a flat node array in a single pass.
 * Used by both engines' `buildExecutionLevels` to derive the implicit
 * child → group dependency edges in O(N+G) instead of O(N×G).
 */
export function buildChildrenByParent<N extends { id: string; parentId?: string }>(
  nodes: ReadonlyArray<N>,
): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const list = childrenByParent.get(n.parentId)
    if (list) list.push(n.id)
    else childrenByParent.set(n.parentId, [n.id])
  }
  return childrenByParent
}

// Whether an edge targets a Collect node's "in" handle. The default-"in" fallback
// matches every other call site so legacy edges without an explicit targetHandle
// keep working. Duck-typed input shape avoids a runtime dep on @xyflow/react.
export function isCollectInEdge(e: { targetHandle?: string | null }): boolean {
  return (e.targetHandle ?? COLLECT_IN_HANDLE) === COLLECT_IN_HANDLE
}
