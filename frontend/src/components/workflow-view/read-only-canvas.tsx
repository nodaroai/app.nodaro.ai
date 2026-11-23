// @registry-enumerates renders a saved workflow's nodes through the canvas nodeTypes map, every type the editor draws
import { useMemo, type ReactNode } from "react"
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  Controls,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import type { OnNodesChange } from "@xyflow/react"
import { nodeTypes } from "@/components/nodes"
import { CanvasModeContext } from "@/components/nodes/read-only-canvas-context"
import { AnimatedFlowEdge } from "@/components/editor/animated-flow-edge"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { ZOOM_MAX } from "@/lib/zoom"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Lower than the editor's floor: a phone has to be able to fit a wide workflow
// on screen at once, and nothing here is edited at that scale.
const VIEW_ZOOM_MIN = 0.05

const edgeTypes = {
  default: AnimatedFlowEdge as never,
  animatedFlow: AnimatedFlowEdge as never,
}

interface ReadOnlyCanvasProps {
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /**
   * `view`: the workflow store holds these very nodes (the view pages seed it),
   * so React Flow's measurements flow back through `onNodesChange` as in the
   * editor. `view-detached`: the store is someone else's; nodes never write to it.
   */
  readonly mode: "view" | "view-detached"
  readonly onNodesChange?: OnNodesChange<WorkflowNode>
  /** The small overview map in the corner (hidden on a narrow embed). */
  readonly showMiniMap?: boolean
  /** Overlays drawn inside the flow (a header bar, a corner link). */
  readonly children?: ReactNode
}

/**
 * A workflow canvas that can only be looked at: pan, zoom, play the media in
 * each node. Nothing can be dragged, connected, selected, run or saved. The
 * caller wraps it in a `ReactFlowProvider`.
 */
export function ReadOnlyCanvas({ nodes, edges, mode, onNodesChange, showMiniMap = true, children }: ReadOnlyCanvasProps) {
  // Hidden nodes (sub-workflow execution leftovers) are not shown, and a node
  // saved selected is not drawn selected. Parent-first
  // order: raw saved nodes are not healed like the editor's, so a group saved
  // after its children would otherwise teleport.
  const visibleNodes = useMemo(
    () => orderNodesParentFirst(nodes.filter((n) => !n.hidden)).map((n) => (n.selected ? { ...n, selected: false } : n)),
    [nodes],
  )
  const visibleEdges = useMemo(() => [...edges], [edges])

  return (
    <CanvasModeContext.Provider value={mode}>
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={VIEW_ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        className="canvas-ambient workflow-view-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={2} color="var(--canvas-dot)" className="!bg-transparent" />
        {showMiniMap && (
          <MiniMap
            className="!hidden sm:!block"
            pannable
            zoomable
            style={{ width: 120, height: 80 }}
            maskColor="rgba(0, 0, 0, 0.6)"
          />
        )}
        <Controls showInteractive={false} />
        {children}
      </ReactFlow>
    </CanvasModeContext.Provider>
  )
}
