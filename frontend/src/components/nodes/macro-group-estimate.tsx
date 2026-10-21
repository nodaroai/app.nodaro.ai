"use client"

/**
 * The one summed estimate on a macro group (Reframe) — D5, decided 2026-10-11.
 * The group has no price of its own: each of its nodes charges its own, and the
 * figure here is `useRunSetPrice` over exactly those nodes, the same run
 * estimate the Execute button, the confirm and the credit precheck are made of.
 * The group runs Speaker Frames and a video-fed Speaker View, so the chip
 * shows only while both are priced — the one predicate every video-mode surface
 * reads (`speakerViewVideoModeLive`; both are, since P3.7). Should a price be
 * withdrawn the chip is not drawn: a number would be made of the floor the
 * estimator gives an unpriced node, a figure nobody will be charged.
 */
import { useMemo } from "react"
import { speakerViewVideoModeLive } from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"
import { hasCredits } from "@/lib/edition"
import { formatCreditUnits } from "@/lib/credit-units"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useRunSetPrice } from "@/hooks/use-run-from-here-credits"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Every `data` object gets a small integer the first time it is seen. The store
 * is immutable — a node whose settings change gets a NEW `data` object, a node
 * that only moves keeps its old one — so the id says "did this node's data
 * change" without reading it. Transcribe's data holds a word-level transcript
 * and Speaker View's an EDL; the fingerprint runs on every store update (every
 * drag frame), so serialising them here would cost megabytes per frame.
 */
const dataIds = new WeakMap<object, number>()
let nextDataId = 1
function dataId(data: unknown): number {
  if (data === null || typeof data !== "object") return 0
  let id = dataIds.get(data)
  if (id === undefined) {
    id = nextDataId++
    dataIds.set(data, id)
  }
  return id
}

/**
 * What the group's price depends on, as ONE string: its children (their data
 * carries provider, quality, results), the wires into them and EVERYTHING
 * upstream of those wires (an upload's saved length prices a render, and so
 * does the Trim, Generate Video or other step between that upload and the
 * group — decided 2026-10-12). Subscribing to `s.nodes` itself would re-render
 * the chip on every unrelated drag; a string is compared by value, so it
 * re-renders only when the price could change. Data is compared by identity
 * (see `dataId`), never serialised, and the walk is one pass over the edges.
 */
export function priceFingerprint(groupId: string, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = nodes.filter((n) => n.parentId === groupId)
  // Everything that can reach a child: a fixed point over "who feeds a node
  // already in the set". A cycle simply stops growing the set.
  const incoming = new Map<string, string[]>()
  for (const e of edges) {
    const list = incoming.get(e.target)
    if (list) list.push(e.source)
    else incoming.set(e.target, [e.source])
  }
  const reached = new Set(kids.map((n) => n.id))
  const queue = [...reached]
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const source of incoming.get(id) ?? []) {
      if (reached.has(source)) continue
      reached.add(source)
      queue.push(source)
    }
  }
  let fp = ""
  for (const n of kids) fp += `${n.id}\x01${n.type ?? ""}\x01${dataId(n.data)}\x02`
  for (const e of edges) {
    if (!reached.has(e.target)) continue
    const src = byId.get(e.source)
    fp += `${e.source}\x01${e.sourceHandle ?? ""}\x01${e.target}\x01${e.targetHandle ?? ""}\x01${src?.type ?? ""}\x01${dataId(src?.data)}\x02`
  }
  return fp
}

export function MacroGroupEstimate({ groupId }: { readonly groupId: string }) {
  const t = useT()
  const fingerprint = useWorkflowStore((s) => priceFingerprint(groupId, s.nodes as WorkflowNode[], s.edges as WorkflowEdge[]))
  // The graph the estimate reads, taken when the fingerprint changes (the
  // heavy computation reads live nodes from getState(), as group-node does).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { nodes, edges } = useMemo(() => {
    const state = useWorkflowStore.getState()
    return { nodes: state.nodes as WorkflowNode[], edges: state.edges as WorkflowEdge[] }
  }, [fingerprint])
  const executable = useMemo(() => nodes.filter((n) => n.parentId === groupId && isExecutableNode(n)), [nodes, groupId])
  const { credits, unpriced } = useRunSetPrice(executable, nodes, edges)
  if (!hasCredits() || !speakerViewVideoModeLive()) return null
  return (
    <div
      data-testid="macro-group-estimate"
      // A node in the group the server refuses to price: no figure, not priced yet — the server's sentence on hover.
      title={unpriced?.message ?? t("reframe.estimateTitle")}
      className="pointer-events-none absolute end-3 bottom-3 rounded-md border border-border bg-card/80 px-2 py-1 text-xs tabular-nums text-muted-foreground"
    >
      {unpriced ? t("renderFinal.priceNotPricedYet") : `≈ ${formatCreditUnits(credits)}`}
    </div>
  )
}
