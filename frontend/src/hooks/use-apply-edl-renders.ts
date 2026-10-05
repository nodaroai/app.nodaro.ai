/**
 * Every render an Apply EDL node's Run would make now — the hook face of
 * `resolveApplyEdlRenders`. The store selector runs on every store change (a
 * node drag included) and the work is one input resolution per render, so it
 * is redone only when a node's id, type or data, or the edges, changed; and the
 * list it returns is the same array while the renders are the same
 * (`stableApplyEdlRenders`): `useSyncExternalStore` needs a stable snapshot.
 */
import { useRef } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resolveApplyEdlRenders, stableApplyEdlRenders } from "@/lib/apply-edl-render-input"
import type { ApplyEdlRenderInput } from "@/lib/edl-validity"
import type { GraphEdge, GraphNode } from "@/lib/edit-plan-estimate"

const NONE: readonly ApplyEdlRenderInput[] = []

interface Memo {
  readonly nodeId: string | undefined
  readonly edges: readonly GraphEdge[]
  /** Each node's id, type and data, in order: what a render can read. */
  readonly keys: readonly unknown[]
  readonly renders: readonly ApplyEdlRenderInput[]
}

const keysOf = (nodes: readonly GraphNode[]): unknown[] => nodes.flatMap((n) => [n.id, n.type, n.data])
const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i])

export function useApplyEdlRenders(nodeId: string | undefined): readonly ApplyEdlRenderInput[] {
  const memo = useRef<Memo | null>(null)
  return useWorkflowStore((s) => {
    const keys = keysOf(s.nodes)
    const last = memo.current
    if (last && last.nodeId === nodeId && last.edges === s.edges && sameKeys(last.keys, keys)) return last.renders
    const node = nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined
    const next = node ? resolveApplyEdlRenders(node, s.nodes, s.edges) : NONE
    const renders = last ? stableApplyEdlRenders(last.renders, next) : next
    memo.current = { nodeId, edges: s.edges, keys, renders }
    return renders
  })
}
