"use client"

import { useCallback, useEffect, useState, useMemo, useRef, lazy, Suspense } from "react"
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  type NodeMouseHandler,
  type IsValidConnection,
  type NodeChange,
} from "@xyflow/react"
import { useSearchParams } from "react-router-dom"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { NodeContextMenu } from "./node-context-menu"
import { CanvasContextMenu } from "./canvas-context-menu"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasControls } from "./canvas-controls"
import { AddNodePopup } from "./add-node-popup"
const SearchModal = lazy(() => import("./search-modal").then(m => ({ default: m.SearchModal })))
import { AnimatedFlowEdge } from "./animated-flow-edge"
const UnifiedAssetLibraryModal = lazy(() => import("./unified-asset-library").then(m => ({ default: m.UnifiedAssetLibraryModal })))
const MediaLibraryModal = lazy(() => import("./media-library-modal").then(m => ({ default: m.MediaLibraryModal })))
import { SelectionActionBar } from "./selection-action-bar"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUndoRedoActions } from "@/hooks/use-undo-redo"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { MobileCanvasContext } from "./mobile-canvas-context"
import { ensureMobilePositions } from "@/lib/mobile-layout"
import type { WorkflowNode, WorkflowEdge, SceneNodeType } from "@/types/nodes"
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

  // Check fieldMappings on target node — shows which field this source is mapped to
  if (sourceNode && targetNode?.data) {
    const mappings = targetNode.data.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
    if (mappings) {
      for (const [field, mapping] of Object.entries(mappings)) {
        if (mapping?.sourceNodeId === sourceNode.id) {
          return { label: FIELD_LABELS[field] ?? field }
        }
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
  const isMobile = useIsMobile()
  const lastMousePositionRef = useRef({ x: 0, y: 0 })
  const mobileContextValue = useMemo(() => ({ isMobile }), [isMobile])

  // On mobile, ensure every node has a mobilePosition.
  // First mobile view: generate a proper vertical layout via topological sort.
  // Subsequent additions: copy position → mobilePosition (preserves drop location).
  useEffect(() => {
    if (!isMobile || nodes.length === 0) return
    const hasMissing = nodes.some((n) => !n.mobilePosition)
    if (!hasMissing) return

    const allMissing = nodes.every((n) => !n.mobilePosition)

    if (allMissing) {
      // First mobile view — generate a proper vertical single-column layout
      const viewportWidth = window.innerWidth
      const updated = ensureMobilePositions(nodes, edges, viewportWidth)
      if (updated !== nodes) {
        useWorkflowStore.setState({ nodes: updated, isDirty: true })
      }
    } else {
      // Some nodes already have mobilePosition — just fill in the missing ones
      // (e.g. node added while already on mobile)
      useWorkflowStore.setState((state) => {
        const needsUpdate = state.nodes.some((n) => !n.mobilePosition)
        if (!needsUpdate) return state
        return {
          nodes: state.nodes.map((n) => {
            if (n.mobilePosition) return n
            return { ...n, mobilePosition: { ...n.position } }
          }),
        }
      })
    }
  }, [isMobile, nodes, edges])

  // Transform nodes for React Flow display: swap in mobilePosition on mobile
  const displayNodes = useMemo(() => {
    if (!isMobile) return nodes
    return nodes.map((node) =>
      node.mobilePosition
        ? { ...node, position: node.mobilePosition }
        : node,
    )
  }, [nodes, isMobile])

  // Mobile-aware onNodesChange: position changes update mobilePosition instead of position
  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      if (!isMobile) {
        onNodesChange(changes)
        return
      }

      // Separate position changes from everything else
      const positionChanges: NodeChange<WorkflowNode>[] = []
      const otherChanges: NodeChange<WorkflowNode>[] = []
      for (const change of changes) {
        if (change.type === "position") {
          positionChanges.push(change)
        } else {
          otherChanges.push(change)
        }
      }

      // Apply non-position changes normally
      if (otherChanges.length > 0) {
        onNodesChange(otherChanges)
      }

      // Apply position changes to mobilePosition instead
      if (positionChanges.length > 0) {
        useWorkflowStore.setState((state) => {
          const changeMap = new Map<string, { x: number; y: number }>()
          for (const change of positionChanges) {
            if (change.type === "position" && change.position) {
              changeMap.set(change.id, change.position)
            }
          }
          if (changeMap.size === 0) return state
          // Only mark dirty when drag ends (dragging=false), not during drag
          const dragEnded = positionChanges.some(
            (c) => c.type === "position" && !c.dragging,
          )
          return {
            nodes: state.nodes.map((node) => {
              const newPos = changeMap.get(node.id)
              return newPos ? { ...node, mobilePosition: newPos } : node
            }),
            ...(dragEnded ? { isDirty: true } : {}),
          }
        })
      }
    },
    [isMobile, onNodesChange],
  )

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
      const pos = (isMobile && target.mobilePosition) ? target.mobilePosition : target.position
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
  const handleNodeDragStart = useCallback((_event: React.MouseEvent, node: { id: string }) => setDraggingNodeId(node.id), [])
  const handleNodeDragStop = useCallback(() => setDraggingNodeId(null), [])

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
    const xSpacing = isMobile ? 0 : 300
    const ySpacing = isMobile ? 160 : 200
    const startX = isMobile ? Math.max(20, (window.innerWidth - 260) / 2) : 100

    Object.values(nodesByType).forEach((typeNodes) => {
      let x = startX
      typeNodes.forEach((node) => {
        const pos = { x, y }
        arranged.push({
          ...node,
          // On mobile, update mobilePosition; on desktop, update position
          ...(isMobile
            ? { mobilePosition: pos }
            : { position: pos }),
        })
        x += xSpacing
      })
      y += ySpacing
    })

    if (isMobile) {
      // Write directly to store to preserve desktop positions
      useWorkflowStore.setState((state) => {
        const posMap = new Map(arranged.map((n) => [n.id, n.mobilePosition!]))
        return {
          nodes: state.nodes.map((n) => {
            const mp = posMap.get(n.id)
            return mp ? { ...n, mobilePosition: mp } : n
          }),
          isDirty: true,
        }
      })
    } else {
      setNodes(arranged)
    }
    setCanvasContextMenu(null)
  }, [nodes, setNodes, isMobile])

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
  }, [selectedNodeId, duplicateNode, deleteNode, handleAddStickyNote, handleTidyUp, handleSelectAll, handleOpenAddNodePopup, onToggleSidebar, undo, redo])

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
      <div className="w-full h-full" onDragOver={handleDragOver} onDrop={handleDrop} onMouseMove={(e) => { lastMousePositionRef.current = { x: e.clientX, y: e.clientY } }}>
        <ReactFlow
          nodes={displayNodes}
          edges={animatedEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'default' }}
          connectionMode={ConnectionMode.Loose}
          fitView
          deleteKeyCode={["Delete", "Backspace"]}
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
              nodeColor={getMiniMapNodeColor}
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
      </MobileCanvasContext.Provider>

      <SelectionActionBar />

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
