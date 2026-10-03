import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent, type ReactNode } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react"
import { nodeTypes } from "@/components/nodes"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { migrateSnapshot } from "@/components/tutorials/migrate-snapshot"
import { useRevealDecision } from "@/components/tutorials/use-reveal-decision"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { fitViewPadding, type Insets } from "./chrome-insets"
import { NodeInspector } from "./node-inspector"
import { derivedPlumbingData, nodeAtPoint, type InspectorNode, type NodeRect } from "./node-inspector-fields"
import "@xyflow/react/dist/style.css"

const toInspectorNode = (n: Node): InspectorNode => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })

/**
 * The nodes are `pointer-events: none` (globals.css) so the pane pans from
 * anywhere, so a click never reaches a node — it lands on the pane, and the
 * node under it is found by geometry from React Flow's measured boxes.
 */
function nodeRects(instance: ReactFlowInstance): NodeRect[] {
  return instance.getNodes().map((n) => {
    const absolute = instance.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position
    return { id: n.id, x: absolute.x, y: absolute.y, width: n.measured?.width ?? n.width ?? 0, height: n.measured?.height ?? n.height ?? 0 }
  })
}

const COUNT_HIDDEN = { includeHiddenNodes: true }

/**
 * The real node components, each rendered inside an `inert` subtree. The node
 * components carry live controls — run strips, prompt fields, pickers — and
 * `nodesFocusable={false}` only drops the tab stop on React Flow's wrapper,
 * not on what the component renders inside it. `inert` takes the whole
 * subtree out of the tab order, the accessibility tree and hit testing, so a
 * keyboard user in the dialog's focus trap cannot land in a template's prompt
 * field and type into the editor store. Built once: a fresh component type per
 * render would remount every node.
 */
const READ_ONLY_NODE_TYPES: NodeTypes = Object.fromEntries(
  Object.entries(nodeTypes).map(([type, Component]) => {
    const Live = Component as ComponentType<NodeProps>
    function ReadOnlyNode(props: NodeProps) {
      return (
        <div inert>
          <Live {...props} />
        </div>
      )
    }
    ReadOnlyNode.displayName = `ReadOnly(${type})`
    return [type, ReadOnlyNode]
  }),
)

/**
 * Frames the graph once its nodes are measured — read two ways, as the
 * tutorial canvas does, because the store flag stalls on some snapshots while
 * the direct walk reports them ready. `useRevealDecision` owns the deadline
 * that keeps "never visible" unreachable.
 */
function FitWhenReady({
  empty,
  onReady,
  fitInsets,
}: {
  readonly empty: boolean
  readonly onReady: () => void
  readonly fitInsets?: (canvas: DOMRect) => Insets
}) {
  const storeFlag = useNodesInitialized()
  const measured = useNodesInitialized(COUNT_HIDDEN)
  const reveal = useRevealDecision(storeFlag || measured, empty)
  const { fitView } = useReactFlow()
  const domNode = useStore((s) => s.domNode)
  const done = useRef(false)

  useEffect(() => {
    if (!reveal || done.current) return
    done.current = true
    if (!empty) {
      const insets = fitInsets && domNode ? fitInsets(domNode.getBoundingClientRect()) : undefined
      fitView({ padding: fitViewPadding(insets), minZoom: 0.02 })
    }
    // Reveal after the fit transform has been applied, so the first paint is
    // the finished framing rather than the jump to it.
    requestAnimationFrame(onReady)
  }, [reveal, empty, fitView, onReady, domNode, fitInsets])

  return null
}

/**
 * A template's snapshot rendered through the real node components, with a
 * plain ReactFlow — NOT the editor's WorkflowCanvas, which is wired to the
 * workflow store and autosave. Nothing here can mutate the template: the
 * nodes are inert (see above, plus `.templates-canvas` in globals.css), only
 * the pane moves.
 *
 * `interactive: false` makes it a still — the detail modal's hero — that is
 * inert as a whole: it neither pans nor zooms, so a wheel over it scrolls the
 * modal, and it holds nothing to tab into.
 *
 * `children` render inside the provider, so canvas chrome (a zoom pill) can
 * use the React Flow hooks.
 *
 * `fitInsets` is for a page that floats its own chrome over the canvas: given
 * the canvas's box, it says how far that chrome reaches in from each side, and
 * the first frame fits the flow into what is left.
 */
export function ReadOnlyCanvas({
  nodes,
  edges,
  interactive,
  className,
  children,
  fitInsets,
}: {
  readonly nodes: readonly unknown[]
  readonly edges: readonly unknown[]
  readonly interactive: boolean
  readonly className?: string
  readonly children?: ReactNode
  readonly fitInsets?: (canvas: DOMRect) => Insets
}) {
  const prepared = useMemo(() => {
    // Migrate first: an edge pointing at a handle that has since been renamed
    // is dropped by React Flow without a word.
    const migrated = migrateSnapshot(nodes as WorkflowNode[], edges as WorkflowEdge[])
    // Every node the template carries, sticky notes included: the notes are
    // the template's own explanation of itself (the tutorial templates put a
    // step-by-step note beside every input), and a preview that hid them
    // showed the machine without its manual.
    const ordered = orderNodesParentFirst(migrated.nodes as unknown as Node[])
    const flowEdges = migrated.edges as unknown as Edge[]
    // A Split or a selector whose run left no saved output would render as an
    // empty box; it shows the parts / pick the run made, re-derived.
    const patches = derivedPlumbingData(ordered.map(toInspectorNode), flowEdges)
    return {
      nodes: ordered.map((n) => {
        const patch = patches.get(n.id)
        return patch ? { ...n, data: { ...n.data, ...patch } } : n
      }),
      edges: flowEdges,
    }
  }, [nodes, edges])
  const [ready, setReady] = useState(false)
  // Reading a node in full: a click on the interactive canvas opens the
  // inspector for the node under it; a click on empty ground closes it.
  const instanceRef = useRef<ReactFlowInstance | null>(null)
  const [inspected, setInspected] = useState<InspectorNode | null>(null)
  const closeInspector = useCallback(() => setInspected(null), [])
  // The whole graph, so the inspector can show what a node received on a wire.
  const inspectorNodes = useMemo<InspectorNode[]>(() => prepared.nodes.map(toInspectorNode), [prepared.nodes])
  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      const instance = instanceRef.current
      if (!instance) return
      const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = nodeAtPoint(nodeRects(instance), point)
      setInspected(id === null ? null : inspectorNodes.find((n) => n.id === id) ?? null)
    },
    [inspectorNodes],
  )

  return (
    <div
      className={cn("templates-canvas relative", !interactive && "templates-canvas-still", className)}
      data-ready={ready}
    >
      <ReactFlowProvider>
        <div className="absolute inset-0" inert={!interactive}>
          <ReactFlow
            nodes={prepared.nodes}
            edges={prepared.edges}
            nodeTypes={READ_ONLY_NODE_TYPES}
            onInit={(instance) => {
              instanceRef.current = instance
            }}
            onPaneClick={interactive ? onPaneClick : undefined}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={interactive}
            zoomOnScroll={interactive}
            zoomOnPinch={interactive}
            zoomOnDoubleClick={false}
            // A whole workflow is far wider than the pane, so the fit lands
            // well below React Flow's default 0.5 floor.
            minZoom={0.02}
            proOptions={{ hideAttribution: true }}
            // The editor's ground: the canvas colour plus the soft pink and
            // indigo wash behind the flow. A template is shown the way the
            // flow looks in the editor, not on a flat page colour (Asaf).
            className="canvas-ambient"
          >
            {/* The dots must stay transparent or they would paint over the wash. */}
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--home-line)" className="!bg-transparent" />
            <FitWhenReady empty={prepared.nodes.length === 0} onReady={() => setReady(true)} fitInsets={fitInsets} />
          </ReactFlow>
        </div>
        {children}
        {interactive && inspected && (
          <NodeInspector node={inspected} nodes={inspectorNodes} edges={prepared.edges} onClose={closeInspector} />
        )}
      </ReactFlowProvider>
    </div>
  )
}
