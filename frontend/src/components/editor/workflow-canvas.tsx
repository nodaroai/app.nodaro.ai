"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type NodeMouseHandler,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { NodeContextMenu } from "./node-context-menu"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface NodeContextMenuState {
  readonly nodeId: string
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
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const isMobile = useIsMobile()

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id)
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    selectNode(null)
    setNodeContextMenu(null)
  }, [selectNode])

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      selectNode(node.id)
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
      if (e.key === "Delete" && selectedNodeId) {
        deleteNode(selectedNodeId)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, duplicateNode, deleteNode])

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
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
    </>
  )
}
