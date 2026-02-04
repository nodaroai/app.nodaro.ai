"use client"

import { useCallback, useEffect, useState, useMemo } from "react"
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
import { AnimatedFlowEdge } from "./animated-flow-edge"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge } from "@/types/nodes"

// Custom edge types with animated flowing dot
const edgeTypes = {
  default: AnimatedFlowEdge as any,
  animatedFlow: AnimatedFlowEdge as any,
}

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
  const [showMiniMap, setShowMiniMap] = useState(true)
  const isMobile = useIsMobile()

  // Transform edges to be animated when source node is running
  const animatedEdges = useMemo(() => {
    // Build a set of node IDs that are currently running
    const runningNodeIds = new Set(
      nodes
        .filter((node) => {
          const data = node.data as Record<string, unknown>
          return data.executionStatus === "running"
        })
        .map((node) => node.id)
    )

    return edges.map((edge): WorkflowEdge => {
      const isRunning = runningNodeIds.has(edge.source)

      return {
        ...edge,
        type: 'default', // Explicitly set type to use our AnimatedFlowEdge
        animated: isRunning,
        data: { ...edge.data, isRunning },
        style: isRunning ? {
          ...edge.style,
          stroke: "#ff0073",
          strokeWidth: 2,
        } : edge.style,
      }
    })
  }, [nodes, edges])

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
        edges={animatedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'default' }}
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
        {!isMobile && showMiniMap && (
          <MiniMap
            className="!bg-card !border !shadow-sm"
            nodeColor={(node) => {
              // Return category-specific colors for each node type
              const nodeType = node.type as string
              // Character nodes
              if (nodeType === 'character') return '#ec4899' // pink-500
              // Object nodes
              if (nodeType === 'object') return '#10b981' // emerald-500
              // Location nodes
              if (nodeType === 'location') return '#06b6d4' // cyan-500
              // Scene and AI nodes - dark gray
              if (nodeType === 'scene' ||
                  nodeType.startsWith('generate-') ||
                  nodeType.startsWith('text-to-') ||
                  nodeType.startsWith('image-to-') ||
                  nodeType.startsWith('video-to-') ||
                  nodeType === 'qa-check') return '#161616'
              // Input nodes
              if (nodeType === 'text-prompt' ||
                  nodeType === 'upload-image' ||
                  nodeType === 'upload-video' ||
                  nodeType === 'rss-feed' ||
                  nodeType === 'reference-audio') return '#3b82f6' // blue-500
              // Parameter nodes
              if (nodeType === 'image-provider' ||
                  nodeType === 'video-provider' ||
                  nodeType === 'voice-provider' ||
                  nodeType === 'script-provider' ||
                  nodeType === 'duration' ||
                  nodeType === 'aspect-ratio' ||
                  nodeType === 'motion' ||
                  nodeType === 'camera-motion' ||
                  nodeType === 'voice' ||
                  nodeType === 'text') return '#6366f1' // indigo-500
              // Processing nodes
              if (nodeType === 'combine-videos' ||
                  nodeType === 'merge-video-audio' ||
                  nodeType === 'add-captions' ||
                  nodeType === 'resize-video' ||
                  nodeType === 'extract-audio' ||
                  nodeType === 'mix-audio' ||
                  nodeType === 'adjust-volume' ||
                  nodeType === 'trim-video') return '#f59e0b' // amber-500
              // Output nodes
              if (nodeType === 'save-to-storage' ||
                  nodeType === 'webhook-output') return '#22c55e' // green-500
              // Sticky notes - hidden from MiniMap
              if (nodeType === 'sticky-note') return 'transparent'
              // Default fallback
              return '#6b7280' // gray-500
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        )}
        {/* MiniMap toggle button */}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setShowMiniMap(!showMiniMap)}
            className="absolute bottom-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded bg-card border shadow-sm hover:bg-accent transition-colors"
            title={showMiniMap ? "Hide MiniMap" : "Show MiniMap"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <rect x="12" y="12" width="6" height="6" rx="1" className={showMiniMap ? "fill-[#ff0073]" : ""} />
            </svg>
          </button>
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
