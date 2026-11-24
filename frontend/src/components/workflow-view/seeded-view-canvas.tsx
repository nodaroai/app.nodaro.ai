import { useCallback, useLayoutEffect, useState, type ReactNode } from "react"
import type { NodeChange } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"
import type { WorkflowView } from "@/lib/api"
import { ReadOnlyCanvas } from "./read-only-canvas"

interface SeededViewCanvasProps {
  readonly token: string
  readonly view: WorkflowView
  readonly showMiniMap?: boolean
  readonly children?: ReactNode
}

/**
 * The view pages' canvas. Node cards read their own node (box, zoom, results)
 * from the workflow store, exactly as in the editor, so the view loads the
 * workflow into that store — the same load, with the same migrations, the
 * editor runs — marked read-only, and empties it again when the page closes.
 * Nothing here saves: the editor's persistence is never mounted on these pages,
 * so a card the visitor moves or resizes is back in its place on the next visit.
 */
export function SeededViewCanvas({ token, view, showMiniMap, children }: SeededViewCanvasProps) {
  const [seeded, setSeeded] = useState(false)

  useLayoutEffect(() => {
    const store = useWorkflowStore.getState()
    // Videos play on their own here (muted, looping) whatever this browser
    // chose in the editor; that choice is put back when the page closes.
    const videoAutoplay = store.videoAutoplay
    // Read-only before the load too, so no subscriber ever sees this workflow as editable.
    useWorkflowStore.setState({ isReadOnly: true })
    store.loadWorkflow(`view:${token}`, view.name, view.nodes, view.edges)
    // No workflow id: nothing that asks the server about "this workflow"
    // (triggers, feeds, executions) has one to ask with — it is not theirs.
    useWorkflowStore.setState({ workflowId: null, isReadOnly: true, isDirty: false, videoAutoplay: true })
    setSeeded(true)
    return () => {
      useWorkflowStore.getState().clearWorkflow()
      useWorkflowStore.setState({ isReadOnly: false, videoAutoplay })
      setSeeded(false)
    }
  }, [token, view])

  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const storeOnNodesChange = useWorkflowStore((s) => s.onNodesChange)
  // React Flow's own measurements keep each card's measured box current, and a
  // visitor's move or resize of a card changes this page's copy alone (nothing
  // here saves). Nothing else comes back: no select, add or remove.
  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      const arranged = changes.filter((c) => c.type === "dimensions" || c.type === "position")
      if (arranged.length > 0) storeOnNodesChange(arranged)
    },
    [storeOnNodesChange],
  )

  if (!seeded) return null
  return (
    <ReadOnlyCanvas nodes={nodes} edges={edges} mode="view" onNodesChange={onNodesChange} showMiniMap={showMiniMap}>
      {children}
    </ReadOnlyCanvas>
  )
}
