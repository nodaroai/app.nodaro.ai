"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { NodeContextMenu } from "./node-context-menu"
import { PaneContextMenu } from "./pane-context-menu"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface NodeContextMenuState {
  readonly nodeId: string
  readonly x: number
  readonly y: number
}

interface PaneContextMenuState {
  readonly x: number
  readonly y: number
  readonly flowX: number
  readonly flowY: number
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
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const { screenToFlowPosition } = useReactFlow()
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const [paneContextMenu, setPaneContextMenu] = useState<PaneContextMenuState | null>(null)
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
    setPaneContextMenu(null)
  }, [selectNode])

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault()
      setNodeContextMenu(null)
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setPaneContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      })
    },
    [screenToFlowPosition]
  )

  const handleAddStickyNote = useCallback(
    (position?: { x: number; y: number }) => {
      const flowPosition = position || screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      addNode("sticky-note", flowPosition)
      setPaneContextMenu(null)
    },
    [addNode, screenToFlowPosition]
  )

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      selectNode(node.id)
      setPaneContextMenu(null)
      setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
    },
    [selectNode],
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedNodeId) {
        e.preventDefault()
        duplicateNode(selectedNodeId)
      }
      if (e.key === "Delete" && selectedNodeId) {
        deleteNode(selectedNodeId)
      }
      // Shift+S to add sticky note
      if (e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault()
        handleAddStickyNote()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, duplicateNode, deleteNode, handleAddStickyNote])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    console.log("[DEBUG] handleDragOver, types:", Array.from(e.dataTransfer.types))
    if (e.dataTransfer.types.includes("application/scenenode-image")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const imageUrl = e.dataTransfer.getData("application/scenenode-image")
      console.log("[DEBUG] handleDrop, imageUrl:", imageUrl)
      if (!imageUrl) return
      e.preventDefault()

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      console.log("[DEBUG] Creating generate-image node at:", position)
      // Create generate-image node with the image already set as a result
      const nodeId = addNode("generate-image", position, {
        generatedResults: [{
          url: imageUrl,
          timestamp: new Date().toISOString(),
          jobId: `imported-${Date.now()}`,
        }],
        activeResultIndex: 0,
        executionStatus: "completed",
        generatedImageUrl: imageUrl,
      })
      console.log("[DEBUG] Created node:", nodeId)
    },
    [screenToFlowPosition, addNode],
  )

  return (
    <>
    <div className="w-full h-full" onDragOver={handleDragOver} onDrop={handleDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
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
    </div>

    {nodeContextMenu && (
      <NodeContextMenu
        nodeId={nodeContextMenu.nodeId}
        x={nodeContextMenu.x}
        y={nodeContextMenu.y}
        onClose={() => setNodeContextMenu(null)}
      />
    )}

    {paneContextMenu && (
      <PaneContextMenu
        x={paneContextMenu.x}
        y={paneContextMenu.y}
        onClose={() => setPaneContextMenu(null)}
        onAddStickyNote={() => handleAddStickyNote({ x: paneContextMenu.flowX, y: paneContextMenu.flowY })}
      />
    )}
    </>
  )
}
