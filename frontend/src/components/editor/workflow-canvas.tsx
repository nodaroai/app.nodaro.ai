"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { NodeContextMenu } from "./node-context-menu"
import { EdgeContextMenu } from "./edge-context-menu"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface NodeContextMenuState {
  readonly nodeId: string
  readonly x: number
  readonly y: number
}

interface EdgeContextMenuState {
  readonly edgeId: string
  readonly x: number
  readonly y: number
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)")
    setIsMobile(mql.matches)
    function onChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return isMobile
}

export function WorkflowCanvas() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange)
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange)
  const onConnect = useWorkflowStore((s) => s.onConnect)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenuState | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const isMobile = useIsMobile()

  // Apply selected styling to edges
  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        style: edge.id === selectedEdgeId
          ? { stroke: "hsl(var(--primary))", strokeWidth: 3 }
          : undefined,
        animated: edge.id === selectedEdgeId,
      })),
    [edges, selectedEdgeId],
  )

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id)
      setSelectedEdgeId(null)
      setEdgeContextMenu(null)
    },
    [selectNode],
  )

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      setSelectedEdgeId(edge.id)
      selectNode(null)
      setNodeContextMenu(null)
      setEdgeContextMenu(null)
    },
    [selectNode],
  )

  const handleEdgeContextMenu: EdgeMouseHandler = useCallback(
    (event, edge) => {
      event.preventDefault()
      setSelectedEdgeId(edge.id)
      selectNode(null)
      setNodeContextMenu(null)
      setEdgeContextMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    selectNode(null)
    setSelectedEdgeId(null)
    setNodeContextMenu(null)
    setEdgeContextMenu(null)
  }, [selectNode])

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      selectNode(node.id)
      setSelectedEdgeId(null)
      setEdgeContextMenu(null)
      setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
    },
    [selectNode],
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedNodeId) {
        e.preventDefault()
        duplicateNode(selectedNodeId)
      }
      if (e.key === "Delete") {
        if (selectedEdgeId) {
          deleteEdge(selectedEdgeId)
          setSelectedEdgeId(null)
        } else if (selectedNodeId) {
          deleteNode(selectedNodeId)
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, duplicateNode, deleteNode, selectedEdgeId, deleteEdge])

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null}
        className="bg-background touch-manipulation"
        zoomOnPinch
        panOnDrag
        minZoom={0.2}
        maxZoom={2}
      >
        <Controls className="!bg-card !border !shadow-sm" />
        {!isMobile && (
          <MiniMap
            className="!bg-card !border !shadow-sm"
            nodeColor="#8b5cf6"
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        )}
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="!bg-background"
        />
      </ReactFlow>

      {nodeContextMenu && (
        <NodeContextMenu
          nodeId={nodeContextMenu.nodeId}
          x={nodeContextMenu.x}
          y={nodeContextMenu.y}
          onClose={() => setNodeContextMenu(null)}
        />
      )}

      {edgeContextMenu && (
        <EdgeContextMenu
          edgeId={edgeContextMenu.edgeId}
          x={edgeContextMenu.x}
          y={edgeContextMenu.y}
          onClose={() => {
            setEdgeContextMenu(null)
            setSelectedEdgeId(null)
          }}
        />
      )}
    </>
  )
}
