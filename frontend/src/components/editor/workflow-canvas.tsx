"use client"

import { useCallback, useEffect, useState, useMemo, useRef, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
  type IsValidConnection,
} from "@xyflow/react"
import { useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { NodeContextMenu } from "./node-context-menu"
import { CanvasContextMenu } from "./canvas-context-menu"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasControls } from "./canvas-controls"
import { AddNodePopup } from "./add-node-popup"
const SearchModal = lazy(() => import("./search-modal").then(m => ({ default: m.SearchModal })))
import { AnimatedFlowEdge } from "./animated-flow-edge"
import { AlignmentGuideLines } from "./alignment-guide-lines"
import { useAlignmentGuides, type GuideLine, type DraggedNodeRect } from "@/hooks/use-alignment-guides"
const UnifiedAssetLibraryModal = lazy(() => import("./unified-asset-library").then(m => ({ default: m.UnifiedAssetLibraryModal })))
const MediaLibraryModal = lazy(() => import("./media-library-modal").then(m => ({ default: m.MediaLibraryModal })))
import { SelectionActionBar } from "./selection-action-bar"
import { FocusModeNav } from "./focus-mode-nav"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUndoRedoActions } from "@/hooks/use-undo-redo"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { MobileCanvasContext } from "./mobile-canvas-context"
import { CanvasZoomContext } from "./canvas-zoom-context"
import type { WorkflowEdge, SceneNodeType } from "@/types/nodes"
import type { LibraryAsset } from "@/lib/api"

// Source handle → media type label
const SOURCE_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  "video-out": "Video",
  audio: "Audio",
  "audio-out": "Audio",
  text: "Text",
  prompt: "Text",
  list: "List",
  composition: "Composition",
  scenes: "Scenes",
  data: "Data",
  payload: "Payload",
  characterRef: "Character",
  faceRef: "Face",
  objectRef: "Object",
  locationRef: "Location",
  voiceId: "Voice ID",
  approved: "Approved",
  rejected: "Rejected",
  count: "Count",
  duration: "Duration",
  ratio: "Ratio",
  tone: "Tone",
  provider: "Provider",
  out: "Output",
}

// Target handle → role label (only shown for multi-handle targets)
const TARGET_LABELS: Record<string, string> = {
  image: "Image",
  audio: "Audio",
  startFrame: "Start Frame",
  endFrame: "End Frame",
  video1: "Video 1",
  video2: "Video 2",
  video3: "Video 3",
  video4: "Video 4",
  lottie: "Lottie",
  background: "Background",
  "ref-audio": "Ref Audio",
}

// Entity node types that always represent a reference connection
const ENTITY_NODE_TYPES = new Set(["character", "face", "object", "location"])

// Target node types where an incoming image connection means "Reference"
const REFERENCE_IMAGE_TARGETS = new Set(["generate-image", "edit-image", "image-to-image"])

// fieldMappings field name → human-readable label
const FIELD_LABELS: Record<string, string> = {
  prompt: "Prompt",
  negativePrompt: "Negative",
  style: "Style",
  styleGuide: "Style",
  tone: "Tone",
  provider: "Provider",
  aspectRatio: "Aspect Ratio",
  duration: "Duration",
  targetLength: "Duration",
  motion: "Motion",
  cameraMotion: "Camera",
  sceneCount: "Scene Count",
  resolution: "Resolution",
}

function getEdgeLabel(
  edge: WorkflowEdge,
  sourceNode: { id: string; type?: string } | undefined,
  targetNode: { type?: string; data?: Record<string, unknown> } | undefined,
): { label: string } | undefined {
  const srcHandle = edge.sourceHandle
  const tgtHandle = edge.targetHandle

  // If target has a named handle (not generic "in"), prefer the target role label
  if (tgtHandle && tgtHandle !== "in" && TARGET_LABELS[tgtHandle]) {
    return { label: TARGET_LABELS[tgtHandle] }
  }

  // Entity nodes always represent a reference
  const srcType = sourceNode?.type
  if (srcType && ENTITY_NODE_TYPES.has(srcType)) {
    return { label: "Reference" }
  }

  // Image → generate-image/edit-image/image-to-image = "Reference"
  const tgtType = targetNode?.type
  if (srcHandle === "image" && tgtType && REFERENCE_IMAGE_TARGETS.has(tgtType)) {
    return { label: "Reference" }
  }

  // Check fieldMappings on target node — shows which field(s) this source is mapped to
  if (sourceNode && targetNode?.data) {
    const mappings = targetNode.data.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
    if (mappings) {
      const matchedLabels: string[] = []
      for (const [field, mapping] of Object.entries(mappings)) {
        if (mapping?.sourceNodeId === sourceNode.id) {
          matchedLabels.push(FIELD_LABELS[field] ?? field)
        }
      }
      if (matchedLabels.length > 0) {
        return { label: matchedLabels.join(", ") }
      }
    }
  }

  // Otherwise use source handle label
  if (srcHandle && SOURCE_LABELS[srcHandle]) {
    return { label: SOURCE_LABELS[srcHandle] }
  }

  return undefined
}

// Custom edge types with animated flowing dot
const edgeTypes = {
  default: AnimatedFlowEdge as any,
  animatedFlow: AnimatedFlowEdge as any,
}

// Module-level function — no closure dependencies, stable reference
function getMiniMapNodeColor(node: { type?: string }): string {
  const nodeType = node.type as string
  // Character nodes - bubblegum pink
  if (nodeType === 'character') return '#F472B6'
  // Face nodes - warm orange
  if (nodeType === 'face') return '#FB923C'
  // Object nodes - mint green
  if (nodeType === 'object') return '#34D399'
  // Location nodes - cyan/turquoise
  if (nodeType === 'location') return '#22D3EE'
  // Scene and AI nodes - brand pink (spotlight)
  if (nodeType === 'scene' ||
      nodeType === 'ai-writer' ||
      nodeType.startsWith('generate-') ||
      nodeType.startsWith('text-to-') ||
      nodeType.startsWith('image-to-') ||
      nodeType.startsWith('video-to-') ||
      nodeType.startsWith('suno-') ||
      nodeType === 'edit-image' ||
      nodeType === 'lip-sync' ||
      nodeType === 'motion-transfer' ||
      nodeType === 'audio-isolation' ||
      nodeType === 'voice-changer' ||
      nodeType === 'voice-remix' ||
      nodeType === 'voice-design' ||
      nodeType === 'dubbing' ||
      nodeType === 'transcribe' ||
      nodeType === 'forced-alignment' ||
      nodeType === 'video-upscale' ||
      nodeType === 'qa-check') return '#ff0073'
  // Input nodes - neon cyan
  if (nodeType === 'text-prompt' ||
      nodeType === 'list' ||
      nodeType === 'loop' ||
      nodeType === 'upload-image' ||
      nodeType === 'upload-video' ||
      nodeType === 'upload-audio' ||
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
      nodeType === 'trim-video' ||
      nodeType === 'combine-text') return '#475569'
  // Output nodes - green
  if (nodeType === 'save-to-storage' ||
      nodeType === 'webhook-output') return '#22c55e'
  // Sticky notes - hidden from MiniMap
  if (nodeType === 'sticky-note') return 'transparent'
  // Default fallback
  return '#6b7280'
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
  const { screenToFlowPosition, setNodes, getNode, setCenter } = useReactFlow()
  const { undo, redo, canUndo, canRedo } = useUndoRedoActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [addNodePopupOpen, setAddNodePopupOpen] = useState(false)
  const [addNodePopupPosition, setAddNodePopupPosition] = useState<{ x: number; y: number } | undefined>(undefined)
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const wasDraggingRef = useRef(false)
  const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem("nodaro:snapToGrid") === "true")
  const [alignmentEnabled, setAlignmentEnabled] = useState(() => localStorage.getItem("nodaro:alignmentGuides") !== "false")
  const [guideLines, setGuideLines] = useState<GuideLine[]>([])
  const computeGuides = useAlignmentGuides()
  const isMobile = useIsMobile()
  const zoom = useStore((s) => s.transform[2])
  const lastMousePositionRef = useRef({ x: 0, y: 0 })
  const arrowGuideClearRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mobileContextValue = useMemo(() => ({ isMobile }), [isMobile])
  // Same positions used on both mobile and desktop — no separate layout

  // Focus on a specific node type when navigating via ?focusType= search param
  const focusType = searchParams.get("focusType")
  const focusedRef = useRef(false)
  useEffect(() => {
    if (!focusType || focusedRef.current || nodes.length === 0) return
    const target = nodes.find((n) => n.type === focusType)
    if (!target) return
    focusedRef.current = true
    // Small delay to let React Flow finish layout
    const timer = setTimeout(() => {
      const pos = target.position
      setCenter(pos.x + 100, pos.y + 50, { zoom: 1, duration: 400 })
      selectNode(target.id)
      // Clean up the search param
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete("focusType")
        return next
      }, { replace: true })
    }, 300)
    return () => clearTimeout(timer)
  }, [focusType, nodes, setCenter, selectNode, setSearchParams, isMobile])

  // Focus mode: zoom to selected node; mobile gets nav arrows + bottom sheet
  const [focusMode, setFocusMode] = useState(false)
  const focusAnimatingRef = useRef(false)

  // Center viewport on selected node (both mobile and desktop)
  useEffect(() => {
    if (!selectedNodeId) {
      setFocusMode(false)
      return
    }
    const node = getNode(selectedNodeId)
    if (!node) return

    const nodeW = node.measured?.width ?? 200
    const nodeH = node.measured?.height ?? 100
    // On mobile, shift up to keep node visible above the bottom sheet
    const sheetOffset = isMobile ? window.innerHeight * 0.15 : 0

    focusAnimatingRef.current = true
    setCenter(
      node.position.x + nodeW / 2,
      node.position.y + nodeH / 2 - sheetOffset,
      { zoom: 1, duration: 300 },
    )
    if (isMobile) setFocusMode(true)
    // Allow the animation to finish before listening for user moves
    const timer = setTimeout(() => { focusAnimatingRef.current = false }, 350)
    return () => clearTimeout(timer)
  }, [isMobile, selectedNodeId, setCenter, getNode])

  // Mobile: auto-focus the first non-sticky node after workflow loads
  const autoFocusedRef = useRef(false)
  useEffect(() => {
    if (!isMobile || autoFocusedRef.current || nodes.length === 0) return
    // Wait for React Flow fitView to finish, then focus first real node
    const timer = setTimeout(() => {
      const firstNode = nodes.find((n) => n.type !== "sticky-note" && !n.data?.hidden)
      if (firstNode) {
        autoFocusedRef.current = true
        selectNode(firstNode.id)
        // The effect above will handle centering + setFocusMode(true)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [isMobile, nodes, selectNode])

  const handleMoveStart = useCallback(() => {
    // User-initiated pan/zoom exits focus mode (ignore our own animation)
    if (isMobile && focusMode && !focusAnimatingRef.current) {
      setFocusMode(false)
    }
  }, [isMobile, focusMode])

  const handleFocusNavigate = useCallback((nodeId: string) => {
    selectNode(nodeId)
    // The useEffect above will handle zoom + setFocusMode(true)
  }, [selectNode])

  // Track which handle type the user is connecting from (for handle animations)
  const [connectingFromType, setConnectingFromType] = useState<"source" | "target" | null>(null)
  // Drag-initiated connections
  const handleConnectStart = useCallback((_: unknown, params: { handleType: "source" | "target" | null }) => {
    if (params.handleType) setConnectingFromType(params.handleType)
  }, [])
  const handleConnectEnd = useCallback(() => {
    setConnectingFromType(null)
  }, [])
  // Click-to-connect (mobile connectOnClick mode)
  const handleClickConnectStart = useCallback((_: unknown, params: { handleType: "source" | "target" | null }) => {
    if (params.handleType) setConnectingFromType(params.handleType)
  }, [])
  const handleClickConnectEnd = useCallback(() => {
    setConnectingFromType(null)
  }, [])

  // Prevent composition handles from connecting to non-Render-Video nodes
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      if (connection.sourceHandle === "composition") {
        const targetNode = getNode(connection.target ?? "")
        return targetNode?.type === "render-video"
      }
      return true
    },
    [getNode],
  )

  // Transform edges to be animated when source or target node is running, or highlighted when dragging
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

    // Build a map of nodeId → node for quick lookup
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    return edges.map((edge): WorkflowEdge => {
      const isRunning = runningNodeIds.has(edge.source)       // Output: source is running (pink)
      const isInputRunning = runningNodeIds.has(edge.target)  // Input: target is running (blue)
      const hasAnimation = isRunning || isInputRunning

      // Check if this edge is connected to the currently dragged node
      const isDragging = draggingNodeId !== null &&
        (edge.source === draggingNodeId || edge.target === draggingNodeId)

      // Execution animations take priority over drag highlighting
      // Edge color priority: running (pink) > input running (blue) > dragging (pink) > default
      let edgeColor: string | undefined
      if (isRunning) {
        edgeColor = "#ff0073"  // Pink for output animation
      } else if (isInputRunning) {
        edgeColor = "#3b82f6"  // Blue for input animation
      } else if (isDragging) {
        edgeColor = "#ff0073"  // Pink for drag highlighting
      }

      const shouldHighlight = hasAnimation || isDragging

      // Compute edge label from handle IDs and node types
      const sourceNode = nodeMap.get(edge.source)
      const edgeLabelResult = getEdgeLabel(edge, sourceNode, nodeMap.get(edge.target))
      const edgeLabel = edgeLabelResult?.label
      const edgeLabelColor = edgeLabel && sourceNode ? getMiniMapNodeColor(sourceNode) : undefined

      return {
        ...edge,
        type: 'default', // Explicitly set type to use our AnimatedFlowEdge
        animated: hasAnimation, // Only animate for execution, not for dragging
        data: { ...edge.data, isRunning, isInputRunning, edgeLabel, edgeLabelColor },
        style: shouldHighlight ? {
          ...edge.style,
          stroke: edgeColor,
          strokeWidth: 2,
        } : edge.style,
      }
    })
  }, [nodes, edges, draggingNodeId])

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (wasDraggingRef.current) return
      selectNode(node.id)
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    selectNode(null)
    setNodeContextMenu(null)
    setCanvasContextMenu(null)
    setAddNodePopupOpen(false)
    setConnectingFromType(null)
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

  const getViewportCenter = useCallback(() => {
    const el = document.querySelector('.react-flow')
    const rect = el?.getBoundingClientRect()
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }, [])

  const handleAddStickyNote = useCallback(
    (position?: { x: number; y: number }) => {
      const flowPosition = position || screenToFlowPosition(getViewportCenter())
      addNode("sticky-note", flowPosition)
      setCanvasContextMenu(null)
    },
    [addNode, screenToFlowPosition, getViewportCenter]
  )

  const [addNodeAtCenter, setAddNodeAtCenter] = useState(false)

  const handleAddNode = useCallback(
    (type: SceneNodeType) => {
      const position = addNodeAtCenter || !addNodePopupPosition
        ? screenToFlowPosition(getViewportCenter())
        : screenToFlowPosition(addNodePopupPosition)
      addNode(type, position)
      setAddNodePopupOpen(false)
      setAddNodePopupPosition(undefined)
      setAddNodeAtCenter(false)
    },
    [addNode, screenToFlowPosition, addNodePopupPosition, getViewportCenter, addNodeAtCenter]
  )

  const handleOpenAddNodePopup = useCallback((position?: { x: number; y: number }, placeAtCenter = false) => {
    setAddNodePopupPosition(position ?? getViewportCenter())
    setAddNodeAtCenter(placeAtCenter)
    setAddNodePopupOpen(true)
    setCanvasContextMenu(null)
    setNodeContextMenu(null)
  }, [getViewportCenter])

  const handleOpenSearch = useCallback(() => setSearchModalOpen(true), [])
  const handleOpenAssetLibrary = useCallback(() => setAssetLibraryOpen(true), [])
  const handleOpenMediaLibrary = useCallback(() => setMediaLibraryOpen(true), [])
  const handleToggleMiniMap = useCallback(() => setShowMiniMap((prev) => !prev), [])
  const handleCloseAddNodePopup = useCallback(() => {
    setAddNodePopupOpen(false)
    setAddNodePopupPosition(undefined)
  }, [])
  const handleToggleSnap = useCallback(() => {
    setSnapEnabled((prev) => {
      const next = !prev
      localStorage.setItem("nodaro:snapToGrid", String(next))
      return next
    })
  }, [])

  const handleToggleAlignment = useCallback(() => {
    setAlignmentEnabled((prev) => {
      const next = !prev
      localStorage.setItem("nodaro:alignmentGuides", String(next))
      return next
    })
  }, [])

  const handleNodeDragStart = useCallback((_event: React.MouseEvent, node: { id: string }) => {
    wasDraggingRef.current = true
    setDraggingNodeId(node.id)
  }, [])
  const handleNodeDrag = useCallback((_event: React.MouseEvent, node: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }) => {
    if (!alignmentEnabled) return
    const rect: DraggedNodeRect = {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? 200,
      height: node.measured?.height ?? 100,
    }
    setGuideLines(computeGuides(rect))
  }, [alignmentEnabled, computeGuides])
  const handleNodeDragStop = useCallback(() => {
    setDraggingNodeId(null)
    setGuideLines([])
    // Reset wasDragging after a tick so the click handler (which fires after dragStop) can still see it
    requestAnimationFrame(() => { wasDraggingRef.current = false })
  }, [])

  const handleTidyUp = useCallback(() => {
    const NODE_W = 250 // horizontal spacing between columns
    const NODE_H = 160 // vertical spacing between rows within a column
    const COMPONENT_GAP = 80 // vertical gap between disconnected flows
    const START_X = 100
    const START_Y = 100

    // If nodes are selected, only tidy those; otherwise tidy all
    const selectedNodes = nodes.filter((n) => n.selected && n.type !== "sticky-note")
    const isSelectionMode = selectedNodes.length >= 2
    const targetNodes = isSelectionMode ? selectedNodes : nodes.filter((n) => n.type !== "sticky-note")
    const untouchedNodes = isSelectionMode
      ? nodes.filter((n) => !n.selected || n.type === "sticky-note")
      : nodes.filter((n) => n.type === "sticky-note")

    if (targetNodes.length === 0) return

    const targetIds = new Set(targetNodes.map((n) => n.id))

    // Build adjacency from edges (only between target nodes)
    const children = new Map<string, string[]>()
    const parents = new Map<string, string[]>()
    for (const n of targetNodes) {
      children.set(n.id, [])
      parents.set(n.id, [])
    }
    for (const e of edges) {
      if (!targetIds.has(e.source) || !targetIds.has(e.target)) continue
      children.get(e.source)!.push(e.target)
      parents.get(e.target)!.push(e.source)
    }

    // Find connected components via BFS
    const componentOf = new Map<string, number>()
    let componentIdx = 0
    for (const n of targetNodes) {
      if (componentOf.has(n.id)) continue
      const queue = [n.id]
      componentOf.set(n.id, componentIdx)
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const neighbor of [...(children.get(cur) ?? []), ...(parents.get(cur) ?? [])]) {
          if (!componentOf.has(neighbor)) {
            componentOf.set(neighbor, componentIdx)
            queue.push(neighbor)
          }
        }
      }
      componentIdx++
    }

    // Group nodes by component
    const components = new Map<number, typeof targetNodes>()
    for (const n of targetNodes) {
      const ci = componentOf.get(n.id) ?? 0
      if (!components.has(ci)) components.set(ci, [])
      components.get(ci)!.push(n)
    }

    // Sort components by the min original Y of their nodes (top-most first)
    const sortedComponentKeys = [...components.keys()].sort((a, b) => {
      const minYA = Math.min(...components.get(a)!.map((n) => n.position.y))
      const minYB = Math.min(...components.get(b)!.map((n) => n.position.y))
      return minYA - minYB
    })

    // For selection mode, start at the top-left of the selection bounding box
    const startX = isSelectionMode
      ? Math.min(...targetNodes.map((n) => n.position.x))
      : START_X
    const startY = isSelectionMode
      ? Math.min(...targetNodes.map((n) => n.position.y))
      : START_Y

    // Layout each component independently, stacking them vertically
    const arranged: typeof nodes = []
    let currentY = startY

    for (const ci of sortedComponentKeys) {
      const compNodes = components.get(ci)!

      // Assign columns via longest-path from roots
      const column = new Map<string, number>()
      const visited = new Set<string>()

      function assignColumn(id: string): number {
        if (column.has(id)) return column.get(id)!
        if (visited.has(id)) return 0 // cycle guard
        visited.add(id)
        const parentCols = (parents.get(id) ?? []).filter((p) => componentOf.get(p) === ci).map(assignColumn)
        const col = parentCols.length > 0 ? Math.max(...parentCols) + 1 : 0
        column.set(id, col)
        return col
      }

      for (const n of compNodes) assignColumn(n.id)

      // Group by column, preserve relative vertical order
      const columns = new Map<number, typeof compNodes>()
      for (const n of compNodes) {
        const col = column.get(n.id) ?? 0
        if (!columns.has(col)) columns.set(col, [])
        columns.get(col)!.push(n)
      }

      for (const col of columns.values()) {
        col.sort((a, b) => a.position.y - b.position.y)
      }

      // Position nodes within this component
      const maxRows = Math.max(...[...columns.values()].map((c) => c.length))
      const sortedCols = [...columns.keys()].sort((a, b) => a - b)

      for (const colIdx of sortedCols) {
        const col = columns.get(colIdx)!
        const totalHeight = (col.length - 1) * NODE_H
        const maxTotalHeight = (maxRows - 1) * NODE_H
        const offsetY = (maxTotalHeight - totalHeight) / 2

        col.forEach((node, rowIdx) => {
          arranged.push({
            ...node,
            position: {
              x: startX + colIdx * NODE_W,
              y: currentY + offsetY + rowIdx * NODE_H,
            },
          })
        })
      }

      // Advance Y for the next component
      currentY += maxRows * NODE_H + COMPONENT_GAP
    }

    // Re-add untouched nodes (sticky notes + unselected nodes)
    arranged.push(...untouchedNodes)

    setNodes(arranged)
    setCanvasContextMenu(null)
  }, [nodes, edges, setNodes])

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

      // Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y — Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault()
        redo()
        return
      }

      // Ctrl/Cmd+Z — Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl/Cmd+Shift+G — Toggle grid snap
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault()
        handleToggleSnap()
        return
      }

      // Ctrl/Cmd+Shift+A — Toggle alignment guides
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault()
        handleToggleAlignment()
        return
      }

      // Tab - Open Add Node popup at mouse position
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        const pos = lastMousePositionRef.current
        handleOpenAddNodePopup(pos.x !== 0 || pos.y !== 0 ? pos : undefined)
        return
      }

      // Ctrl+K - Search projects and workflows
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setSearchModalOpen(true)
        return
      }

      // Ctrl+L - My Library
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault()
        setAssetLibraryOpen(true)
        return
      }

      // Ctrl+M - Media Library
      if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        e.preventDefault()
        setMediaLibraryOpen((prev) => !prev)
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

      // Delete / Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        deleteNode(selectedNodeId)
        return
      }

      // Enter — toggle settings panel
      if (e.key === "Enter") {
        e.preventDefault()
        if (selectedNodeId) {
          // Close config panel but keep node visually selected in React Flow
          useWorkflowStore.setState({ selectedNodeId: null })
        } else {
          // Open config panel for the currently React Flow-selected node
          const rfSelected = useWorkflowStore.getState().nodes.find((n) => n.selected)
          if (rfSelected) selectNode(rfSelected.id)
        }
        return
      }

      // Arrow keys — navigate to nearest node when settings panel is open
      if (selectedNodeId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
        const current = getNode(selectedNodeId)
        if (current) {
          const cx = current.position.x + (current.measured?.width ?? 200) / 2
          const cy = current.position.y + (current.measured?.height ?? 100) / 2
          let bestId: string | null = null
          let bestDist = Infinity
          for (const n of useWorkflowStore.getState().nodes) {
            if (n.id === selectedNodeId || n.hidden) continue
            const nx = n.position.x + ((n.measured?.width ?? 200) / 2)
            const ny = n.position.y + ((n.measured?.height ?? 100) / 2)
            const dx = nx - cx
            const dy = ny - cy
            const ok =
              (e.key === "ArrowRight" && dx > 20) ||
              (e.key === "ArrowLeft" && dx < -20) ||
              (e.key === "ArrowDown" && dy > 20) ||
              (e.key === "ArrowUp" && dy < -20)
            if (!ok) continue
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < bestDist) {
              bestDist = dist
              bestId = n.id
            }
          }
          if (bestId) selectNode(bestId)
        }
        return
      }

      // Arrow keys — show alignment guides after React Flow moves the node
      if (alignmentEnabled && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        const rfSelected = useWorkflowStore.getState().nodes.find((n) => n.selected)
        if (!rfSelected) return
        clearTimeout(arrowGuideClearRef.current)
        requestAnimationFrame(() => {
          const n = getNode(rfSelected.id)
          if (!n) return
          setGuideLines(computeGuides({
            id: n.id,
            x: n.position.x,
            y: n.position.y,
            width: n.measured?.width ?? 200,
            height: n.measured?.height ?? 100,
          }))
          arrowGuideClearRef.current = setTimeout(() => setGuideLines([]), 500)
        })
        return
      }

      // Escape - Close popups & deselect node
      if (e.key === "Escape") {
        setAddNodePopupOpen(false)
        setCanvasContextMenu(null)
        setNodeContextMenu(null)
        selectNode(null)
        return
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, duplicateNode, deleteNode, handleAddStickyNote, handleTidyUp, handleSelectAll, handleOpenAddNodePopup, onToggleSidebar, undo, redo, handleToggleSnap, handleToggleAlignment, alignmentEnabled, computeGuides, getNode])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/nodaro-image")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const imageUrl = e.dataTransfer.getData("application/nodaro-image")
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

  const handleAddAssetToCanvas = useCallback(
    (asset: LibraryAsset) => {
      const position = screenToFlowPosition(getViewportCenter())

      const nodeTypeMap: Record<string, SceneNodeType> = {
        image: "upload-image",
        video: "upload-video",
        audio: "upload-audio",
      }
      const nodeType = nodeTypeMap[asset.type]
      if (!nodeType) return

      addNode(nodeType, position, {
        r2Url: asset.url,
        url: asset.url,
        thumbnailUrl: asset.thumbnailUrl ?? undefined,
        filename: asset.filename,
        fileSize: asset.sizeBytes,
        mimeType: asset.mimeType,
        metadata: asset.metadata,
        assetId: asset.id,
      })

      setMediaLibraryOpen(false)
    },
    [screenToFlowPosition, addNode, getViewportCenter],
  )

  const hasSelection = nodes.some((n) => n.selected)

  return (
    <>
      {/* Canvas Toolbar (icon buttons on left) */}
      <CanvasToolbar
        onAddNode={handleOpenAddNodePopup}
        onSearch={handleOpenSearch}
        onAssetLibrary={handleOpenAssetLibrary}
        onMediaLibrary={handleOpenMediaLibrary}
        onAddStickyNote={handleAddStickyNote}
        onTidyUp={handleTidyUp}
        onToggleSidebar={onToggleSidebar}
        sidebarVisible={sidebarVisible}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Canvas Controls (zoom, fit, minimap toggle - bottom left) */}
      <CanvasControls
        showMiniMap={showMiniMap}
        onToggleMiniMap={handleToggleMiniMap}
        snapEnabled={snapEnabled}
        onToggleSnap={handleToggleSnap}
        alignmentEnabled={alignmentEnabled}
        onToggleAlignment={handleToggleAlignment}
        isMobile={isMobile}
      />

      {/* Add Node Popup */}
      <AddNodePopup
        open={addNodePopupOpen}
        onClose={handleCloseAddNodePopup}
        onAddNode={handleAddNode}
        position={addNodePopupPosition}
      />

      {/* Search Modal */}
      {searchModalOpen && (
        <Suspense fallback={null}>
          <SearchModal
            open={searchModalOpen}
            onClose={() => setSearchModalOpen(false)}
          />
        </Suspense>
      )}

      {/* My Library Modal */}
      {assetLibraryOpen && (
        <Suspense fallback={null}>
          <UnifiedAssetLibraryModal
            open={assetLibraryOpen}
            onClose={() => setAssetLibraryOpen(false)}
          />
        </Suspense>
      )}

      {/* Media Library Modal */}
      {mediaLibraryOpen && (
        <Suspense fallback={null}>
          <MediaLibraryModal
            open={mediaLibraryOpen}
            onClose={() => setMediaLibraryOpen(false)}
            onAddToCanvas={handleAddAssetToCanvas}
          />
        </Suspense>
      )}

      <MobileCanvasContext.Provider value={mobileContextValue}>
      <CanvasZoomContext.Provider value={{ zoom }}>
      <div className="w-full h-full" onDragOver={handleDragOver} onDrop={handleDrop} onMouseMove={(e) => { lastMousePositionRef.current = { x: e.clientX, y: e.clientY } }}>
        <ReactFlow
          nodes={nodes}
          edges={animatedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onClickConnectStart={handleClickConnectStart}
          onClickConnectEnd={handleClickConnectEnd}
          isValidConnection={isValidConnection}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeContextMenu={isMobile ? undefined : handleNodeContextMenu}
          onPaneContextMenu={isMobile ? undefined : handlePaneContextMenu}
          onMoveStart={handleMoveStart}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          snapToGrid={snapEnabled}
          snapGrid={[16, 16]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'default' }}
          connectionMode={ConnectionMode.Loose}
          connectOnClick={isMobile}
          selectNodesOnDrag={!isMobile}
          fitView
          deleteKeyCode={["Delete", "Backspace"]}
          className={cn(
            "bg-background touch-manipulation",
            connectingFromType === "source" && "connecting-from-source",
            connectingFromType === "target" && "connecting-from-target",
          )}
          zoomOnPinch
          panOnDrag
          minZoom={0.2}
          maxZoom={8}
          proOptions={{ hideAttribution: true }}
        >
          {!isMobile && showMiniMap && (
            <MiniMap
              className="!bg-card !border !shadow-sm"
              nodeColor={getMiniMapNodeColor}
              maskColor="rgba(0, 0, 0, 0.2)"
            />
          )}
          <Background
            variant={snapEnabled ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={16}
            size={snapEnabled ? 0.5 : 1}
            color={snapEnabled ? "var(--grid-line-color)" : undefined}
            className="!bg-background"
          />
          {guideLines.length > 0 && <AlignmentGuideLines guides={guideLines} />}
        </ReactFlow>
      </div>
      </CanvasZoomContext.Provider>
      </MobileCanvasContext.Provider>

      <SelectionActionBar />

      {/* Mobile focus mode: directional navigation arrows */}
      {isMobile && focusMode && selectedNodeId && (
        <FocusModeNav selectedNodeId={selectedNodeId} onNavigate={handleFocusNavigate} />
      )}

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
