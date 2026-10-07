/**
 * The editor's store subscribers that stay mounted under the review inspector
 * (§2.4 of the inspectors design), for the cut budget's two measurements: the
 * jsdom test (review-inspector.budget.test.tsx) and the real-browser one
 * (playwright/perf). Free of the test runner for that reason.
 *  - the canvas under the modal (every node and edge);
 *  - the nodes' badges (the Edit Plan's `EdlValidityBadge` over its output);
 *  - a second `useRenderFinal` (the render's bar on the canvas; the
 *    inspector's footer holds its own);
 *  - autosave, which serialises the graph on every store change.
 * Each counts its wake-ups in `woke`, so a measurement can show a cut woke none.
 */
import { useEffect } from "react"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { useRenderFinal } from "@/hooks/use-render-final"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"

export interface Woke {
  canvas: number
  badge: number
  bar: number
  autosave: number
}

export const createWoke = (): Woke => ({ canvas: 0, badge: 0, bar: 0, autosave: 0 })

function CanvasUnderModal({ woke }: { readonly woke: Woke }) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  woke.canvas++
  return <div data-nodes={nodes.length} data-edges={edges.length} />
}

function PlanBadge({ woke }: { readonly woke: Woke }) {
  const data = useWorkflowStore((s) => s.nodes.find((n) => n.id === "plan")?.data) as Record<string, unknown> | undefined
  woke.badge++
  return data ? <EdlValidityBadge value={editPlanOutputOf(data)?.json} /> : null
}

function RenderBar({ woke, renderId }: { readonly woke: Woke; readonly renderId: string }) {
  const { finalCredits } = useRenderFinal(renderId)
  woke.bar++
  return <span data-credits={finalCredits} />
}

function Autosave({ woke }: { readonly woke: Woke }) {
  useEffect(() => useWorkflowStore.subscribe((s) => {
    woke.autosave++
    JSON.stringify(s.nodes)
  }), [woke])
  return null
}

/** The four subscribers, beside the inspector anchored at `renderId`. */
export function EditorListeners({ woke, renderId }: { readonly woke: Woke; readonly renderId: string }) {
  return (
    <>
      <CanvasUnderModal woke={woke} />
      <PlanBadge woke={woke} />
      <RenderBar woke={woke} renderId={renderId} />
      <Autosave woke={woke} />
    </>
  )
}
