"use client"

import { useCallback, useEffect, useState, useMemo } from "react"
import {
  ReactFlow,
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
import { CanvasContextMenu } from "./canvas-context-menu"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasControls } from "./canvas-controls"
import { AddNodePopup } from "./add-node-popup"
import { SearchModal } from "./search-modal"
import { AnimatedFlowEdge } from "./animated-flow-edge"
import { UnifiedAssetLibraryModal } from "./unified-asset-library"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge, SceneNodeType } from "@/types/nodes"

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

interface CanvasContextMenuState {
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

interface WorkflowCanvasProps {
  readonly sidebarVisible: boolean
  readonly onToggleSidebar: () => void
}

export function WorkflowCanvas({ sidebarVisible, onToggleSidebar }: WorkflowCanvasProps) {
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
  const { screenToFlowPosition, setNodes } = useReactFlow()
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [addNodePopupOpen, setAddNodePopupOpen] = useState(false)
  const [addNodePopupPosition, setAddNodePopupPosition] = useState<{ x: number; y: number } | undefined>(undefined)
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
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
    setCanvasContextMenu(null)
    setAddNodePopupOpen(false)
  }, [selectNode])

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault()
      setNodeContextMenu(null)
      setAddNodePopupOpen(false)
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCanvasContextMenu({
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
      setCanvasContextMenu(null)
    },
    [addNode, screenToFlowPosition]
  )

  const handleAddNode = useCallback(
    (type: SceneNodeType) => {
      const position = addNodePopupPosition
        ? screenToFlowPosition(addNodePopupPosition)
        : screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      addNode(type, position)
      setAddNodePopupOpen(false)
      setAddNodePopupPosition(undefined)
    },
    [addNode, screenToFlowPosition, addNodePopupPosition]
  )

  const handleOpenAddNodePopup = useCallback((position?: { x: number; y: number }) => {
    setAddNodePopupPosition(position)
    setAddNodePopupOpen(true)
    setCanvasContextMenu(null)
    setNodeContextMenu(null)
  }, [])

  const handleTidyUp = useCallback(() => {
    // Simple auto-arrange: sort nodes by type and arrange in a grid
    const nodesByType: Record<string, typeof nodes> = {}
    nodes.forEach((node) => {
      const type = node.type || "unknown"
      if (!nodesByType[type]) nodesByType[type] = []
      nodesByType[type].push(node)
    })

    const arranged: typeof nodes = []
    let y = 100
    const xSpacing = 300
    const ySpacing = 200

    Object.values(nodesByType).forEach((typeNodes) => {
      let x = 100
      typeNodes.forEach((node) => {
        arranged.push({
          ...node,
          position: { x, y },
        })
        x += xSpacing
      })
      y += ySpacing
    })

    setNodes(arranged)
    setCanvasContextMenu(null)
  }, [nodes, setNodes])

  const handleSelectAll = useCallback(() => {
    setNodes(nodes.map((n) => ({ ...n, selected: true })))
  }, [nodes, setNodes])

  const handleClearSelection = useCallback(() => {
    setNodes(nodes.map((n) => ({ ...n, selected: false })))
    selectNode(null)
  }, [nodes, setNodes, selectNode])

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      selectNode(node.id)
      setCanvasContextMenu(null)
      setAddNodePopupOpen(false)
      setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
    },
    [selectNode],
  )

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return
      }

      // Tab - Open Add Node popup
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handleOpenAddNodePopup()
        return
      }

      // Ctrl+K - Search projects and workflows
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setSearchModalOpen(true)
        return
      }

      // Ctrl+L - Asset Library
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault()
        setAssetLibraryOpen(true)
        return
      }

      // Shift+S - Add sticky note
      if (e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault()
        handleAddStickyNote()
        return
      }

      // Alt+T - Tidy up
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault()
        handleTidyUp()
        return
      }

      // Ctrl+B - Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault()
        onToggleSidebar()
        return
      }

      // Ctrl+A - Select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault()
        handleSelectAll()
        return
      }

      // Ctrl+D - Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedNodeId) {
        e.preventDefault()
        duplicateNode(selectedNodeId)
        return
      }

      // Delete
      if (e.key === "Delete" && selectedNodeId) {
        deleteNode(selectedNodeId)
        return
      }

      // Escape - Close popups
      if (e.key === "Escape") {
        setAddNodePopupOpen(false)
        setCanvasContextMenu(null)
        setNodeContextMenu(null)
        return
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, duplicateNode, deleteNode, handleAddStickyNote, handleTidyUp, handleSelectAll, handleOpenAddNodePopup, onToggleSidebar])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/scenenode-image")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const imageUrl = e.dataTransfer.getData("application/scenenode-image")
      if (!imageUrl) return
      e.preventDefault()

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // Create generate-image node with the image already set as a result
      addNode("generate-image", position, {
        generatedResults: [{
          url: imageUrl,
          timestamp: new Date().toISOString(),
          jobId: `imported-${Date.now()}`,
        }],
        activeResultIndex: 0,
        executionStatus: "completed",
        generatedImageUrl: imageUrl,
      })
    },
    [screenToFlowPosition, addNode],
  )

  const hasSelection = nodes.some((n) => n.selected)

  return (
    <>
      {/* Canvas Toolbar (icon buttons on left) */}
      <CanvasToolbar
        onAddNode={() => handleOpenAddNodePopup()}
        onSearch={() => setSearchModalOpen(true)}
        onAssetLibrary={() => setAssetLibraryOpen(true)}
        onAddStickyNote={() => handleAddStickyNote()}
        onTidyUp={handleTidyUp}
        onToggleSidebar={onToggleSidebar}
        sidebarVisible={sidebarVisible}
      />

      {/* Canvas Controls (zoom, fit, minimap toggle - bottom left) */}
      {!isMobile && (
        <CanvasControls
          showMiniMap={showMiniMap}
          onToggleMiniMap={() => setShowMiniMap(!showMiniMap)}
        />
      )}

      {/* Add Node Popup */}
      <AddNodePopup
        open={addNodePopupOpen}
        onClose={() => {
          setAddNodePopupOpen(false)
          setAddNodePopupPosition(undefined)
        }}
        onAddNode={handleAddNode}
        position={addNodePopupPosition}
      />

      {/* Search Modal */}
      <SearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
      />

      {/* Asset Library Modal */}
      <UnifiedAssetLibraryModal
        open={assetLibraryOpen}
        onClose={() => setAssetLibraryOpen(false)}
      />

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
          proOptions={{ hideAttribution: true }}
        >
          {!isMobile && showMiniMap && (
            <MiniMap
              className="!bg-card !border !shadow-sm"
              nodeColor={(node) => {
                // Return category-specific colors for each node type (vibrant for dark mode)
                const nodeType = node.type as string
                // Character nodes - bubblegum pink
                if (nodeType === 'character') return '#F472B6'
                // Object nodes - mint green
                if (nodeType === 'object') return '#34D399'
                // Location nodes - cyan/turquoise
                if (nodeType === 'location') return '#22D3EE'
                // Scene and AI nodes - brand pink (spotlight)
                if (nodeType === 'scene' ||
                    nodeType.startsWith('generate-') ||
                    nodeType.startsWith('text-to-') ||
                    nodeType.startsWith('image-to-') ||
                    nodeType.startsWith('video-to-') ||
                    nodeType === 'qa-check') return '#ff0073'
                // Input nodes - neon cyan
                if (nodeType === 'text-prompt' ||
                    nodeType === 'upload-image' ||
                    nodeType === 'upload-video' ||
                    nodeType === 'rss-feed' ||
                    nodeType === 'reference-audio') return '#38BDF8'
                // Parameter nodes - modern indigo
                if (nodeType === 'image-provider' ||
                    nodeType === 'video-provider' ||
                    nodeType === 'voice-provider' ||
                    nodeType === 'script-provider' ||
                    nodeType === 'duration' ||
                    nodeType === 'aspect-ratio' ||
                    nodeType === 'motion' ||
                    nodeType === 'camera-motion' ||
                    nodeType === 'voice' ||
                    nodeType === 'text') return '#818CF8'
                // Processing nodes - steel grey
                if (nodeType === 'combine-videos' ||
                    nodeType === 'merge-video-audio' ||
                    nodeType === 'add-captions' ||
                    nodeType === 'resize-video' ||
                    nodeType === 'extract-audio' ||
                    nodeType === 'mix-audio' ||
                    nodeType === 'adjust-volume' ||
                    nodeType === 'trim-video') return '#475569'
                // Output nodes - green
                if (nodeType === 'save-to-storage' ||
                    nodeType === 'webhook-output') return '#22c55e'
                // Sticky notes - hidden from MiniMap
                if (nodeType === 'sticky-note') return 'transparent'
                // Default fallback
                return '#6b7280'
              }}
              maskColor="rgba(0, 0, 0, 0.2)"
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

      {canvasContextMenu && (
        <CanvasContextMenu
          open={true}
          position={{ x: canvasContextMenu.x, y: canvasContextMenu.y }}
          onClose={() => setCanvasContextMenu(null)}
          onAddNode={() => handleOpenAddNodePopup({ x: canvasContextMenu.x, y: canvasContextMenu.y })}
          onAddStickyNote={() => handleAddStickyNote({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY })}
          onTidyUp={handleTidyUp}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          hasSelection={hasSelection}
        />
      )}
    </>
  )
}
