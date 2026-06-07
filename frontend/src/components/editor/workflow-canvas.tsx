"use client"

import { useCallback, useEffect, useState, useMemo, useRef, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { buildRangeLabel as buildRangeLabelShared, isCollectInEdge, type SelectorMode } from "@nodaro/shared"
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  useUpdateNodeInternals,
  useStore,
  type NodeMouseHandler,
  type IsValidConnection,
  type FinalConnectionState,
} from "@xyflow/react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { nodeHasPromptField } from "@/lib/prompt-fields"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { matchShortcut, SHORTCUTS } from "@/lib/shortcuts"
import { ShortcutsHelpModal } from "@/components/editor/shortcuts-help-modal"
import { NodeContextMenu } from "./node-context-menu"
import { CanvasContextMenu } from "./canvas-context-menu"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasControls } from "./canvas-controls"
import { MediaPreviewModal } from "./media-preview-modal"
import { ZOOM_MIN, ZOOM_MAX, snapZoom } from "@/lib/zoom"
import { AddNodePopup } from "./add-node-popup"
import { buildAdjacency, isValidWorkflowConnection } from "@/lib/connection-validation"
import { pickEdgeAccent } from "@/lib/edge-accent"
import { getEdgeTypeColor } from "@/lib/edge-type-color"
import { getHandleConnectionLimit } from "@/lib/handle-limits"
import { panDelta, PAN_STEP_PX } from "@/lib/canvas-navigation"
import { getFocusedNodeMedia } from "@/lib/focused-node-media"
const SearchModal = lazy(() => import("./search-modal").then(m => ({ default: m.SearchModal })))
const NodeSearchModal = lazy(() => import("./node-search-modal").then(m => ({ default: m.NodeSearchModal })))
import { AnimatedFlowEdge } from "./animated-flow-edge"
import { AlignmentGuideLines } from "./alignment-guide-lines"
import { useAlignmentGuides, type GuideLine, type DraggedNodeRect } from "@/hooks/use-alignment-guides"
import { useCameraAutoPan } from "./workflow-editor/use-camera-auto-pan"
import { useWorkflowRealtimeSync } from "./workflow-editor/use-workflow-realtime-sync"
import { useElkLayout, getElk, ELK_LAYOUT_OPTIONS, toElkLayoutNode } from "@/hooks/use-elk-layout"
import { useAutoPanWhenIdle } from "@/hooks/use-auto-pan-when-idle"
import { __resetSeenNodesForTests } from "./workflow-editor/use-node-insert-animation"
import { __resetSeenEdgesForTests } from "./workflow-editor/use-edge-insert-animation"
import { computeOverlap, worldToLocal, localToWorld, GROUP_ATTACH_THRESHOLD, orderNodesParentFirst } from "./workflow-editor/group-coords"
const UnifiedAssetLibraryModal = lazy(() => import("./unified-asset-library").then(m => ({ default: m.UnifiedAssetLibraryModal })))
const MediaLibraryModal = lazy(() => import("./media-library-modal").then(m => ({ default: m.MediaLibraryModal })))
const ComponentMarketplaceModal = lazy(() => import("./component-marketplace-modal").then(m => ({ default: m.ComponentMarketplaceModal })))
// Full dashboard surfaces embedded as in-editor dialogs by the empty-state pills
// (Templates / Tutorials) so the user never navigates away from their Flow.
const TemplatesPageModal = lazy(() => import("@/app/(dashboard)/templates/page"))
const TutorialsTabModal = lazy(() => import("@/components/dashboard/tutorials-tab").then(m => ({ default: m.TutorialsTab })))
import type { ComponentSelection } from "./component-marketplace-modal"
import { SelectionActionBar } from "./selection-action-bar"
import { FocusModeNav } from "./focus-mode-nav"
import { EmptyCanvasState } from "./empty-canvas-state"
import { Loader2 } from "lucide-react"
import { assetToUploadNode } from "@/lib/asset-to-node"
import { useWorkflowStore, migrateImageNodes, buildDuplicatedNodeData } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useUndoRedoActions } from "@/hooks/use-undo-redo"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { MobileCanvasContext } from "./mobile-canvas-context"
import { CanvasZoomContext } from "./canvas-zoom-context"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { TELEPORTER_PAN_EVENT, type WorkflowNode, type WorkflowEdge, type SceneNodeType } from "@/types/nodes"
import type { ConnectionContext } from "@/lib/node-compatibility"
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
  images: "Images",
  dialogue: "Dialogue",
  music: "Music",
  sfx: "SFX",
  characters: "Characters",
  locations: "Locations",
  json: "JSON",
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
  media: "Media",
  caption: "Caption",
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
  framing: "Framing",
  sceneCount: "Scene Count",
  resolution: "Resolution",
}

/** Source types whose edges default to "each" (fan-out) when no explicit mode is set. */
const DEFAULT_EACH_SOURCE_TYPES = new Set(["list", "split-text"])
/** Target types whose incoming edges default to "all" (Bundle). Mirrors the dropdown in animated-flow-edge. */
const DEFAULT_ALL_TARGET_TYPES = new Set(["list"])

/** Resolve the effective output mode, mirroring the dropdown defaults so the
 *  edge label agrees with the radio selection. Target-based "all" wins over
 *  source-based "each" (matches animated-flow-edge). */
function resolveEffectiveOutputMode(
  edge: WorkflowEdge,
  sourceNode: { type?: string } | undefined,
  targetNode: { type?: string } | undefined,
): string | undefined {
  const explicit = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined
  if (explicit) return explicit
  if (targetNode?.type && DEFAULT_ALL_TARGET_TYPES.has(targetNode.type)) return "all"
  if (sourceNode?.type && DEFAULT_EACH_SOURCE_TYPES.has(sourceNode.type)) return "each"
  return undefined
}

/** Get the output mode label for display (separate from the edge label).
 *  Renders all modes — including "last" (= "selected") — so users can see
 *  what each edge will deliver without opening the edge popover. */
function getOutputModeLabel(
  edge: WorkflowEdge,
  sourceNode: { type?: string } | undefined,
  targetNode: { type?: string } | undefined,
): string | undefined {
  const effectiveMode = resolveEffectiveOutputMode(edge, sourceNode, targetNode)
  if (!effectiveMode) return undefined
  // "last" is the dropdown's "Selected" option (currently selected result).
  if (effectiveMode === "last") return "selected"
  if (effectiveMode.startsWith("item:")) return "item"
  // "all" renders as "bundle" in the UI — value stays "all" for backward compat
  if (effectiveMode === "all") return "bundle"
  return effectiveMode
}

/** Build a range/step label pill from edge data. Returns undefined when no range is configured. */
function getEdgeRangeLabel(edge: WorkflowEdge): string | undefined {
  const d = edge.data as Record<string, unknown> | undefined
  if (!d) return undefined
  const mode = d.outputMode as string | undefined
  if (!mode) return undefined
  const normalizedMode = mode.startsWith("item:") ? "item" : mode
  // For legacy item:N, compute 1-based itemIndex for the label
  let itemIndex = d.itemIndex as string | undefined
  if (mode.startsWith("item:") && !itemIndex) {
    const legacyIdx = parseInt(mode.slice("item:".length), 10)
    if (!isNaN(legacyIdx)) itemIndex = String(legacyIdx + 1)
  }
  const rangeLabel = buildRangeLabelShared(
    normalizedMode,
    d.rangeFrom as string | undefined,
    d.rangeTo as string | undefined,
    d.rangeStep as number | undefined,
    itemIndex,
    d.selectorMode as SelectorMode | undefined,
    d.listExpression as string | undefined,
  )
  return rangeLabel
}

function getEdgeLabel(
  edge: WorkflowEdge,
  sourceNode: { id: string; type?: string; data?: Record<string, unknown> } | undefined,
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

  // List (table) column outputs — show role-aware label
  if (srcType === "list" && srcHandle && sourceNode?.data) {
    const columns = (sourceNode.data as Record<string, unknown>).columns as
      Array<{ handleId: string; name: string; type?: string }> | undefined
    const col = columns?.find((c) => c.handleId === srcHandle)
    if (col) {
      // Image column → reference image target = "Reference Image"
      if (col.type === "image-url" && tgtType && REFERENCE_IMAGE_TARGETS.has(tgtType)) {
        return { label: "Reference Image" }
      }
      const typeLabel = col.type === "image-url" ? "Image"
        : col.type === "video-url" ? "Video"
        : col.type === "audio-url" ? "Audio"
        : "Text"
      return { label: `${col.name} (${typeLabel})` }
    }
  }

  // Component outputs — resolve type from metadata
  if (srcType === "component" && srcHandle?.startsWith("out_") && sourceNode?.data) {
    const metadata = sourceNode.data.componentMetadata as
      { outputs?: Array<{ id: string; name?: string; type?: string }> } | undefined
    const handleId = srcHandle.replace(/^out_/, "")
    const port = metadata?.outputs?.find((o) => o.id === handleId)
    if (port) {
      const portType = port.type ?? "text"
      // Image output → reference image target
      if (portType === "image" && tgtType && REFERENCE_IMAGE_TARGETS.has(tgtType)) {
        return { label: "Reference Image" }
      }
      const typeLabel = portType === "image" ? "Image"
        : portType === "video" ? "Video"
        : portType === "audio" ? "Audio"
        : "Text"
      return { label: port.name ?? typeLabel }
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
/** Read a handle's own type color (`--pip-color`, set inline by
 *  HandleWithPopover) straight off the rendered DOM. Used to tint the
 *  add-node menu's "Connect to" title in the handle's color regardless of how
 *  the menu was opened (drag-to-connect, "+Add", or a list cell). Returns a
 *  6-digit hex or undefined (legacy plain handles carry no `--pip-color`, and
 *  disabled pips resolve to a CSS var — both are rejected by the hex guard so
 *  the menu falls back to its default accent). */
function readHandlePipColor(nodeId: string, handleId: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const el = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"] [data-handleid="${CSS.escape(handleId)}"]`,
  )
  if (!el) return undefined
  const c = getComputedStyle(el).getPropertyValue("--pip-color").trim()
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined
}

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
      nodeType === 'llm-chat' ||
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
      nodeType === 'framing' ||
      nodeType === 'lens' ||
      nodeType === 'camera-format' ||
      nodeType === 'lighting' ||
      nodeType === 'color-look' ||
      nodeType === 'atmosphere' ||
      nodeType === 'temporal' ||
      nodeType === 'voice' ||
      nodeType === 'text') return '#818CF8'
  // Processing nodes - steel grey
  if (nodeType === 'combine-videos' ||
      nodeType === 'merge-video-audio' ||
      nodeType === 'add-captions' ||
      nodeType === 'resize-video' ||
      nodeType === 'trim-audio' ||
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

/** Estimate how many tile-grid buttons fit in the first row by checking Y coords. */
function estimatePickerGridCols(btns: HTMLButtonElement[]): number {
  if (btns.length < 2) return 1
  const firstY = btns[0].getBoundingClientRect().top
  let cols = 1
  for (let i = 1; i < btns.length; i++) {
    if (Math.abs(btns[i].getBoundingClientRect().top - firstY) < 5) cols++
    else break
  }
  return cols
}

export function WorkflowCanvas({ sidebarVisible, onToggleSidebar }: WorkflowCanvasProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const needsAutoLayout = useWorkflowStore((s) => s.needsAutoLayout)
  const setNeedsAutoLayout = useWorkflowStore((s) => s.setNeedsAutoLayout)
  // React Flow v12 requires a parent (group) node to precede its children in
  // the array it receives, else the child renders at its local coords as if
  // absolute (teleports to ~origin) and warns. The store keeps insertion order
  // (a group drawn around existing nodes lands AFTER them), so reorder here at
  // the single point the array enters React Flow. onNodesChange is id-based, so
  // feeding a reordered array back is safe.
  const orderedNodes = useMemo(() => orderNodesParentFirst(nodes), [nodes])
  const edges = useWorkflowStore((s) => s.edges)
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange)
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange)
  const onConnect = useWorkflowStore((s) => s.onConnect)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const openFullscreenSettings = useWorkflowStore((s) => s.openFullscreenSettings)
  const closeFullscreenSettings = useWorkflowStore((s) => s.closeFullscreenSettings)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const duplicateNodes = useWorkflowStore((s) => s.duplicateNodes)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const addNodeAndOpenPicker = useWorkflowStore((s) => s.addNodeAndOpenPicker)
  const updateEdgeData = useWorkflowStore((s) => s.updateEdgeData)
  const replaceEdgeWithTeleporter = useWorkflowStore((s) => s.replaceEdgeWithTeleporter)
  const { screenToFlowPosition, setNodes, setEdges, getNode, getNodes, getEdges, setCenter, fitView, getViewport, setViewport, zoomTo } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const savedViewport = useWorkflowStore((s) => s.savedViewport)

  // Freshly-mounted nodes play a ~300ms scale-up entrance (useNodeInsertAnimation
  // + the `.animate-fade-in-scale` wrapper class). React Flow measures each handle
  // once on mount via getBoundingClientRect (transform-aware), but its
  // ResizeObserver never re-fires for a CSS transform — content-box size is
  // unchanged — so handles get recorded at their scaled-down, shifted-toward-
  // center positions and every edge attaches off its handle icon until the next
  // resize/drag. Re-measure once the entrance settles. Keyed on the node-id SET
  // (not the `nodes` array, which changes on every drag) so it fires only on
  // load / add / remove, and batches into ONE updateNodeInternals(ids) call (a
  // single rAF + store update) rather than one timer per node.
  const nodeIdSignature = nodes.map((n) => n.id).join(",")
  useEffect(() => {
    if (!nodeIdSignature) return
    const t = window.setTimeout(() => {
      const ids = useWorkflowStore.getState().nodes.map((n) => n.id)
      if (ids.length > 0) updateNodeInternals(ids)
    }, 400)
    return () => window.clearTimeout(t)
  }, [nodeIdSignature, updateNodeInternals])
  const setSavedViewport = useWorkflowStore((s) => s.setSavedViewport)
  const { undo, redo, canUndo, canRedo } = useUndoRedoActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null)
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [addNodePopupOpen, setAddNodePopupOpen] = useState(false)
  const [addNodePopupPosition, setAddNodePopupPosition] = useState<{ x: number; y: number } | undefined>(undefined)
  // Pre-selected category for the add-node popup (empty-state upload bar opens it drilled to "Input")
  const [addNodePopupCategory, setAddNodePopupCategory] = useState<string | null>(null)
  // Empty-state pill dialogs (full Templates / Tutorials surfaces, in-editor)
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false)
  const [tutorialsModalOpen, setTutorialsModalOpen] = useState(false)
  const [connectionContext, setConnectionContext] = useState<ConnectionContext | null>(null)
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [nodeSearchModalOpen, setNodeSearchModalOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  // Esc-to-close for the lazy-loaded search modals — registers
  // immediately when the modal opens (the modal's OWN Esc handler is
  // only available after the lazy chunk finishes loading, which is why
  // the first Esc used to fall through and a second press was needed
  // for it to land). Window capture-phase fires before the modal's
  // input gets the keystroke, so it works even with the input focused.
  useEffect(() => {
    if (!nodeSearchModalOpen && !searchModalOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      if (nodeSearchModalOpen) setNodeSearchModalOpen(false)
      else if (searchModalOpen) setSearchModalOpen(false)
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, { capture: true })
  }, [nodeSearchModalOpen, searchModalOpen])
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false)
  const [componentMarketplaceOpen, setComponentMarketplaceOpen] = useState(false)
  const [pendingImportData, setPendingImportData] = useState<{ nodes: WorkflowNode[]; edges: WorkflowEdge[]; name: string; mousePos: { x: number; y: number } } | null>(null)
  const navigate = useNavigate()
  const createWorkflow = useProjectsStore((s) => s.createWorkflow)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  // Alt/Option+F — id of the node whose result is shown in the fullscreen lightbox.
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null)
  // Mirror for the document keydown closure (its deps don't include this state),
  // so Escape can tell whether the lightbox is the topmost overlay to dismiss.
  const fullscreenNodeIdRef = useRef<string | null>(null)
  useEffect(() => { fullscreenNodeIdRef.current = fullscreenNodeId }, [fullscreenNodeId])
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
  const zoomContextValue = useMemo(() => ({ zoom }), [zoom])
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

  // When the fullscreen config panel closes, restore keyboard focus to the
  // React Flow pane so that arrow-key node nudging works immediately.
  // When fullscreen closes, restore keyboard focus to the React Flow tree so
  // arrow-key node nudging works. Arrow events only bubble through RF's
  // onKeyDown container when their target is inside the RF DOM subtree. After
  // the panel becomes `hidden`, focus falls to `body` which is outside that
  // subtree. We focus the selected node element (data-id attribute, tabIndex
  // set by React Flow) so the next arrow keydown originates inside RF.
  const configPanelFullscreen = useWorkflowStore((s) => s.configPanelFullscreen)
  const prevFullscreenRef = useRef(configPanelFullscreen)
  useEffect(() => {
    const wasOpen = prevFullscreenRef.current
    prevFullscreenRef.current = configPanelFullscreen
    if (wasOpen && !configPanelFullscreen) {
      requestAnimationFrame(() => {
        const state = useWorkflowStore.getState()
        const sel = state.nodes.find((n) => n.selected)
        const el = sel
          ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${sel.id}"]`)
          : document.querySelector<HTMLElement>(".react-flow__pane")
        el?.focus({ preventScroll: true })
      })
    }
  }, [configPanelFullscreen])

  // Center viewport on selected node and zoom to fit 60% of visible area
  useEffect(() => {
    if (!selectedNodeId) {
      setFocusMode(false)
      return
    }
    // One-shot skip: set by openFullscreenSettings (icon click) so the node
    // stays in place instead of zooming to fill the screen.
    if (useWorkflowStore.getState().skipNextViewportAnimation) {
      useWorkflowStore.setState({ skipNextViewportAnimation: false })
      return
    }
    const node = getNode(selectedNodeId)
    if (!node) return

    const nodeW = node.measured?.width ?? 200
    const nodeH = node.measured?.height ?? 100
    const nodeCenterX = node.position.x + nodeW / 2
    const nodeCenterY = node.position.y + nodeH / 2

    // Account for config panel (384px on desktop) eating into visible area
    const panelW = isMobile ? 0 : 384
    const visibleW = window.innerWidth - panelW
    const visibleH = window.innerHeight
    // On mobile, shift up to keep node visible above the bottom sheet
    const sheetOffset = isMobile ? visibleH * 0.15 : 0
    // Zoom so node fills 60% of the visible area
    const targetFraction = 0.6
    const zoomToFit = Math.min(
      (visibleW * targetFraction) / nodeW,
      (visibleH * targetFraction) / nodeH,
    )
    const zoomClamped = Math.max(0.5, Math.min(2.5, zoomToFit))
    // Offset center-x so node appears in the middle of the visible area (not behind panel)
    const panelOffsetX = panelW / (2 * zoomClamped)

    focusAnimatingRef.current = true
    setCenter(
      nodeCenterX + panelOffsetX,
      nodeCenterY - sheetOffset,
      { zoom: zoomClamped, duration: 300 },
    )
    if (isMobile) setFocusMode(true)
    // Allow the animation to finish before listening for user moves
    const timer = setTimeout(() => { focusAnimatingRef.current = false }, 350)
    return () => clearTimeout(timer)
  }, [isMobile, selectedNodeId, setCenter, getNode])

  // Restore saved viewport or fitView on workflow load
  const viewportRestoredRef = useRef<string | null>(null)
  useEffect(() => {
    const wfId = useWorkflowStore.getState().workflowId
    if (!wfId || wfId === viewportRestoredRef.current || nodes.length === 0) return
    viewportRestoredRef.current = wfId
    if (savedViewport) {
      requestAnimationFrame(() => setViewport(savedViewport, { duration: 0 }))
    } else {
      requestAnimationFrame(() => fitView({ maxZoom: 1, minZoom: 0.5, padding: 0.2 }))
    }
  }, [nodes.length, savedViewport, setViewport, fitView])

  // When a workflow loaded with positionless nodes (Studio exports), run a
  // single ELK layered layout so the grid-fallback positions become a clean
  // graph. <ReactFlow> is controlled, so this setNodes call DOES route through
  // the Zustand onNodesChange and can mark the workflow dirty — even on a
  // read-only workflow (only `remove` changes are filtered in read-only, by
  // design, so the layout can apply). That is safe because every persistence
  // path (the debounced save() and the beforeunload flush) bails on isReadOnly,
  // so a read-only Studio workflow is never written back.
  useEffect(() => {
    if (!needsAutoLayout) return
    let cancelled = false
    void (async () => {
      const rfNodes = getNodes()
      const rfEdges = getEdges()
      if (rfNodes.length === 0) { setNeedsAutoLayout(false); return }
      try {
        const elk = await getElk()
        const layout = await elk.layout({
          id: "root",
          layoutOptions: { ...ELK_LAYOUT_OPTIONS },
          children: rfNodes.map(toElkLayoutNode),
          edges: rfEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
        })
        if (cancelled) return
        const pos = new Map((layout.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))
        setNodes((nds) => nds.map((n) => { const p = pos.get(n.id); return p ? { ...n, position: p } : n }))
        requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }))
      } catch {
        /* layout miss — grid fallback positions already prevent the crash */
      } finally {
        if (!cancelled) setNeedsAutoLayout(false)
      }
    })()
    return () => { cancelled = true }
  }, [needsAutoLayout, getNodes, getEdges, setNodes, fitView, setNeedsAutoLayout])

  // Imperatively play/pause all canvas videos when toggle changes
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  useEffect(() => {
    const container = document.querySelector('.react-flow')
    if (!container) return
    const videos = container.querySelectorAll<HTMLVideoElement>('video')
    if (!videoAutoplay) {
      // Pause all videos immediately
      videos.forEach((v) => v.pause())
    } else {
      // Play all — per-node useEffect handles paused/stopped nodes individually
      videos.forEach((v) => v.play().catch(() => {}))
    }
  }, [videoAutoplay])

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

  // ── Phase 1B.4: live-build auto-layout + auto-pan ───────────────────────
  // Active while the pipeline orchestrator is making canvas changes. The two
  // hooks below were intentionally written generic so they're easy to detach
  // from pipelines later if we want to reuse them for Film Director or other
  // background writers.
  const activePipelineStatus = useWorkflowStore((s) => s.activePipelineStatus)
  const lastAddedPipelineNodeId = useWorkflowStore(
    (s) => s.lastAddedPipelineNodeId,
  )
  const isPipelineActive =
    activePipelineStatus === "running" ||
    activePipelineStatus === "awaiting_approval"

  // Camera auto-pan: when new nodes are added to the canvas (e.g. by the
  // Film Director skill's per-stage update_workflow_json calls), pan the
  // viewport toward them — but yield to the user for 2s after any manual
  // pan/zoom so the camera doesn't fight the user. See use-camera-auto-pan.ts.
  //
  // Disabled while a pipeline is active: `useAutoPanWhenIdle` below owns the
  // camera in that mode and we don't want the two hooks fighting over each
  // frame the orchestrator adds.
  const cameraAutoPan = useCameraAutoPan(nodes, !isPipelineActive)
  // Re-run ELK each time the node count changes while a pipeline is live, so
  // newly-materialized entity/scene nodes get auto-arranged without manual
  // intervention. Stop running ELK once the pipeline reaches a terminal
  // status so the user's manual positioning sticks.
  useElkLayout({
    enabled: isPipelineActive,
    triggerKey: `${nodes.length}:${lastAddedPipelineNodeId ?? ""}`,
  })
  // Auto-pan to the freshest pipeline-owned node after 5s of idle. The
  // "Follow build →" button below resets idle to "now" so the user can
  // re-arm without waiting on the natural debounce.
  const { isIdle: livebuildIdle, followBuild } = useAutoPanWhenIdle({
    enabled: isPipelineActive,
    focusNodeId: lastAddedPipelineNodeId,
  })

  // Realtime live-canvas sync: external writers (MCP / Film Director skill
  // via update_workflow_json) mutate the workflows row directly in the DB,
  // and the same workflow may be open in another tab / browser / phone.
  // Subscribe to Postgres UPDATE events for the open workflow id; the
  // hook applies a full reconcile when local state is clean (snaps to
  // remote so a passive tab can't resurrect deleted nodes on its next
  // save) and falls back to append-only when local is dirty (preserves
  // in-progress edits + the Film Director live-canvas UX). The id-keyed
  // mount animations (D1 node fade-in, D2 edge stretch) and D3 camera
  // auto-pan naturally fire for any appended items because they're
  // seeing those ids for the first time. See use-workflow-realtime-sync.ts.
  const realtimeWorkflowId = useWorkflowStore((s) => s.workflowId)
  const isWorkflowLoading = useWorkflowStore((s) => s.isWorkflowLoading)
  const reconcileFromRemote = useWorkflowStore((s) => s.reconcileFromRemote)
  const setRemoteUpdatedAt = useWorkflowStore((s) => s.setRemoteUpdatedAt)
  useWorkflowRealtimeSync({
    workflowId: realtimeWorkflowId,
    getCurrentNodes: () => getNodes(),
    getCurrentEdges: () => getEdges(),
    getIsDirty: () => useWorkflowStore.getState().isDirty,
    getLoadedUpdatedAt: () => useWorkflowStore.getState().loadedUpdatedAt,
    onReconcile: ({ nodes: remoteNodes, edges: remoteEdges, updatedAt, settings }) =>
      reconcileFromRemote({
        nodes: remoteNodes as unknown as WorkflowNode[],
        edges: remoteEdges as unknown as WorkflowEdge[],
        updatedAt,
        settings,
      }),
    onAppendNodes: (newNodes) => setNodes((nds) => [...nds, ...newNodes]),
    onAppendEdges: (newEdges) => setEdges((eds) => [...eds, ...newEdges]),
    onRemoteUpdatedAt: (updatedAt) => setRemoteUpdatedAt(updatedAt),
  })

  // New / empty canvas → start at 100%. The viewport-restore effect above bails
  // on an empty canvas, so without this a fresh workflow would inherit the
  // previously-open workflow's zoom. Gated exactly like the empty-canvas hero
  // (loaded, zero nodes) so it never fires while a workflow is still streaming
  // its nodes in; keyed per workflow id so it runs once. A saved viewport wins.
  const emptyCanvasZoomResetRef = useRef<string | null>(null)
  useEffect(() => {
    if (isWorkflowLoading || nodes.length !== 0 || savedViewport) return
    if (!realtimeWorkflowId || realtimeWorkflowId === emptyCanvasZoomResetRef.current) return
    emptyCanvasZoomResetRef.current = realtimeWorkflowId
    requestAnimationFrame(() => setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
  }, [isWorkflowLoading, nodes.length, savedViewport, realtimeWorkflowId, setViewport])

  // ── Playwright dev-only test helper (D4b) ───────────────────────────────
  // Exposes a small object on `window.__nodaroTest` so the
  // `frontend/playwright/tests/film-director-canvas-build.spec.ts` regression
  // suite can drive the editor deterministically — bypassing the real
  // MCP/Supabase write path that is far too slow for unit-grade visual
  // regression. Gated on `import.meta.env.DEV` so the production bundle
  // tree-shakes this entire effect out.
  //
  // Shape matches the spec's `NodaroTestApi` interface (positional args):
  //   batchAddNodesAndEdges(nodes, edges) — appends nodes + edges to RF state
  //   getViewport()                       — returns { x, y, zoom }
  //   resetSeen()                         — clears the D1/D2 module-level
  //                                         seen-sets so animations replay
  //                                         on rerun (D3's seen-set is per-
  //                                         instance and resets naturally on
  //                                         remount, so it's not exposed).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    interface NodaroTestNodeInput {
      readonly id: string
      readonly type: string
      readonly position: { readonly x: number; readonly y: number }
      readonly data?: Record<string, unknown>
    }
    interface NodaroTestEdgeInput {
      readonly id: string
      readonly source: string
      readonly target: string
      readonly sourceHandle?: string
      readonly targetHandle?: string
    }
    const helper = {
      batchAddNodesAndEdges: (
        newNodes: ReadonlyArray<NodaroTestNodeInput>,
        newEdges: ReadonlyArray<NodaroTestEdgeInput>,
      ) => {
        if (newNodes.length > 0) {
          // Cast: the spec's input shape is structurally compatible with
          // React Flow's Node, but TS can't prove the narrower SceneNodeType
          // union — the helper is unit-test-only so the cast is sound.
          setNodes((nds) => [...nds, ...(newNodes as unknown as WorkflowNode[])])
        }
        if (newEdges.length > 0) {
          setEdges((eds) => [...eds, ...(newEdges as unknown as WorkflowEdge[])])
        }
      },
      getViewport: () => getViewport(),
      resetSeen: () => {
        __resetSeenNodesForTests()
        __resetSeenEdgesForTests()
      },
    }
    ;(window as unknown as { __nodaroTest?: typeof helper }).__nodaroTest = helper
    return () => {
      delete (window as unknown as { __nodaroTest?: typeof helper }).__nodaroTest
    }
  }, [setNodes, setEdges, getViewport])

  const handleMoveStart = useCallback(() => {
    // Tell the auto-pan hook the user just initiated a pan/zoom — it
    // will suppress its next auto-pan for ~2s.
    cameraAutoPan.onMove()
    // User-initiated pan/zoom exits focus mode (ignore our own animation)
    if (isMobile && focusMode && !focusAnimatingRef.current) {
      setFocusMode(false)
    }
  }, [cameraAutoPan, isMobile, focusMode])

  const handleMoveEnd = useCallback(() => {
    setSavedViewport(getViewport())
  }, [getViewport, setSavedViewport])

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
  const edgeDropRef = useRef(false)
  const pendingEdgeDataRef = useRef<Record<string, unknown> | null>(null)
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnectingFromType(null)

      // If connection landed on a valid handle, normal flow — do nothing extra
      if (connectionState.toHandle) return

      // Dropped on empty canvas — open filtered popup
      const fromHandle = connectionState.fromHandle
      const fromNode = connectionState.fromNode
      if (!fromHandle || !fromNode) return

      // Flag to prevent handlePaneClick from immediately closing the popup
      edgeDropRef.current = true
      requestAnimationFrame(() => { edgeDropRef.current = false })

      const clientX = "clientX" in event ? event.clientX : event.changedTouches[0].clientX
      const clientY = "clientY" in event ? event.clientY : event.changedTouches[0].clientY
      setAddNodePopupPosition({ x: clientX, y: clientY })

      setConnectionContext({
        nodeId: fromNode.id,
        handleId: fromHandle.id ?? "in",
        direction: (fromHandle.type as "source" | "target") ?? "source",
        dropPosition: screenToFlowPosition({ x: clientX, y: clientY }),
        nodeType: fromNode.type,
        color: readHandlePipColor(fromNode.id, fromHandle.id ?? "in"),
      })
      setAddNodePopupOpen(true)
    },
    [screenToFlowPosition],
  )
  // Click-to-connect (mobile connectOnClick mode)
  const handleClickConnectStart = useCallback((_: unknown, params: { handleType: "source" | "target" | null }) => {
    if (params.handleType) setConnectingFromType(params.handleType)
  }, [])
  const handleClickConnectEnd = useCallback(() => {
    setConnectingFromType(null)
  }, [])

  // Memoize the adjacency index so drag-to-connect probes (React Flow
  // calls isValidConnection on every cursor move during a drag) don't
  // rebuild the entire source→targets map every probe — only when the
  // edge list actually changes.
  const adjacencyIndex = useMemo(() => buildAdjacency(edges), [edges])
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => isValidWorkflowConnection(connection, (id) => getNode(id)?.type, adjacencyIndex),
    [getNode, adjacencyIndex],
  )

  // Per-edge identity cache for `animatedEdges`. AnimatedFlowEdge is memoized
  // on its `data`/`style` props; without this cache the useMemo below rebuilt a
  // fresh `data: {...}` literal for EVERY edge on EVERY `nodes` change (e.g. a
  // node drag or a streaming-token update), defeating that memo and forcing
  // React Flow to reconcile every edge. We diff the actually-computed field
  // values per edge and reuse the previous returned edge object (and its `data`
  // reference) when nothing observable changed.
  const animatedEdgeCacheRef = useRef<
    Map<string, { fields: string; rawEdge: WorkflowEdge; result: WorkflowEdge }>
  >(new Map())

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

    const cache = animatedEdgeCacheRef.current
    const nextCache = new Map<string, { fields: string; rawEdge: WorkflowEdge; result: WorkflowEdge }>()

    const result = edges.map((edge): WorkflowEdge => {
      const isRunning = runningNodeIds.has(edge.source)       // Output: source is running (pink)
      const isInputRunning = runningNodeIds.has(edge.target)  // Input: target is running (blue)
      const hasAnimation = isRunning || isInputRunning

      // Check if this edge is connected to the currently dragged node
      const isDragging = draggingNodeId !== null &&
        (edge.source === draggingNodeId || edge.target === draggingNodeId)

      // Execution animations take priority over drag highlighting.
      // `pickEdgeAccent` (lib/edge-accent.ts) is the SINGLE SOURCE OF
      // TRUTH for the running-edge color priority — shared with
      // animated-flow-edge's hover-glow so both surfaces always agree on
      // which color "wins" when source AND target are both running.
      // Dragging gets pink iff no execution accent applies.
      let edgeColor: string | undefined
      if (isRunning || isInputRunning) {
        edgeColor = pickEdgeAccent(isRunning, isInputRunning).stroke
      } else if (isDragging) {
        edgeColor = "#ff0073"  // Pink for drag highlighting
      }

      const shouldHighlight = hasAnimation || isDragging

      // Compute edge label from handle IDs and node types
      const sourceNode = nodeMap.get(edge.source)
      const targetNode = nodeMap.get(edge.target)
      const edgeLabelResult = getEdgeLabel(edge, sourceNode, targetNode)
      const edgeLabel = edgeLabelResult?.label
      const edgeLabelColor = edgeLabel && sourceNode ? getMiniMapNodeColor(sourceNode) : undefined
      const edgeModeLabel = getOutputModeLabel(edge, sourceNode, targetNode)
      const edgeRangeLabel = getEdgeRangeLabel(edge)

      // "Disabled by provider" — true when the target handle has cap 0 for
      // the consumer's current model. Drives the dashed/grayed edge styling
      // in AnimatedFlowEdge. Recomputes every time `nodes` changes (which
      // includes provider switches via updateNodeData), so the live state
      // tracks the panel selection without explicit edge data writes.
      const targetHandleLimit = edge.targetHandle
        ? getHandleConnectionLimit(targetNode, edge.targetHandle)
        : null
      const disabledByProvider = targetHandleLimit?.limit === 0

      const outputMode = resolveEffectiveOutputMode(edge, sourceNode, targetNode)

      // Idle edges take the source handle's TYPE color (text wires blue, image
      // cyan, …) so a wire matches the pips it connects. Execution/drag/hover/
      // selected/disabled states still override (in AnimatedFlowEdge + below).
      const edgeTypeColor = getEdgeTypeColor(sourceNode?.type, edge.sourceHandle)

      // Stable signature of every value that feeds the returned edge's
      // `data`/`style`/`animated`/`type`. Reuse the previously-returned object
      // (and its `data` reference, which is what AnimatedFlowEdge's memo keys
      // on) when both the signature AND the upstream `edge` reference are
      // unchanged. On the hot path (node drag / streaming-token updates the
      // store mutates only `nodes`, leaving every `edge` object reference
      // stable) this skips rebuilding the `data` literal for unaffected edges.
      const fields = JSON.stringify([
        hasAnimation,
        isRunning,
        isInputRunning,
        edgeLabel,
        edgeLabelColor,
        edgeModeLabel,
        edgeRangeLabel,
        outputMode,
        sourceNode?.type,
        targetNode?.type,
        disabledByProvider,
        shouldHighlight,
        edgeColor,
        edgeTypeColor,
      ])

      const cached = cache.get(edge.id)
      if (cached && cached.fields === fields && cached.rawEdge === edge) {
        nextCache.set(edge.id, cached)
        return cached.result
      }

      // Highlight (execution/drag) wins over the idle type color, which wins
      // over the edge's own style.
      const styleOverride = shouldHighlight
        ? { stroke: edgeColor, strokeWidth: 2 }
        : edgeTypeColor
          ? { stroke: edgeTypeColor }
          : undefined
      const computed: WorkflowEdge = {
        ...edge,
        type: 'default', // Explicitly set type to use our AnimatedFlowEdge
        animated: hasAnimation, // Only animate for execution, not for dragging
        data: { ...edge.data, isRunning, isInputRunning, edgeLabel, edgeLabelColor, edgeModeLabel, edgeRangeLabel, outputMode, sourceNodeType: sourceNode?.type, targetNodeType: targetNode?.type, disabledByProvider },
        style: styleOverride ? { ...edge.style, ...styleOverride } : edge.style,
      }
      nextCache.set(edge.id, { fields, rawEdge: edge, result: computed })
      return computed
    })

    // Prune entries for edges that no longer exist (cache rebuilt from current edges).
    animatedEdgeCacheRef.current = nextCache
    return result
  }, [nodes, edges, draggingNodeId])

  // Filter out teleporter edges from rendering — store keeps all edges for DAG execution
  const visibleEdges = useMemo(
    () => animatedEdges.filter((e) => !(e.data as Record<string, unknown> | undefined)?.teleporter),
    [animatedEdges]
  )

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: WorkflowEdge) => {
    event.preventDefault()
    setEdgeContextMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
  }, [])

  const focusedNodeRef = useRef<string | null>(null)

  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      // A click that originates on a handle pip must not change node focus or
      // open settings — handles are for connecting + their popover, mirroring
      // how dragging from a handle never selects the node. HandleWithPopover
      // stops the click itself; this also covers any plain React Flow handles.
      if ((event.target as HTMLElement | null)?.closest?.(".react-flow__handle")) return
      if (wasDraggingRef.current) return
      const currentSelectedId = useWorkflowStore.getState().selectedNodeId
      if (focusedNodeRef.current === node.id && currentSelectedId !== node.id) {
        // Second click on same node — open settings
        selectNode(node.id)
      } else if (currentSelectedId === node.id) {
        // Already editing — keep settings open
      } else if (currentSelectedId) {
        // Settings open on another node — switch settings to this node
        selectNode(node.id)
        focusedNodeRef.current = node.id
      } else {
        // No settings open — just focus
        focusedNodeRef.current = node.id
      }
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    focusedNodeRef.current = null
    selectNode(null)
    setNodeContextMenu(null)
    setCanvasContextMenu(null)
    setEdgeContextMenu(null)
    // Don't close the popup if it was just opened by an edge drop
    if (!edgeDropRef.current) setAddNodePopupOpen(false)
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
    (type: SceneNodeType, initialData?: Record<string, unknown>) => {
      const position = addNodeAtCenter || !addNodePopupPosition
        ? screenToFlowPosition(getViewportCenter())
        : screenToFlowPosition(addNodePopupPosition)
      // Picker auto-open is owned by the store action so every add-node
      // entry point (this popup, sidebar toolbar, handle-popover, future
      // ones) gets the behavior automatically.
      addNodeAndOpenPicker(type, position, initialData)
      setAddNodePopupOpen(false)
      setAddNodePopupPosition(undefined)
      setAddNodeAtCenter(false)
    },
    [addNodeAndOpenPicker, screenToFlowPosition, addNodePopupPosition, getViewportCenter, addNodeAtCenter]
  )

  // Empty-canvas hero cards drop the real node at viewport center and focus it
  // (opens its config panel) — no picker popup, so the user lands directly on
  // the node they chose.
  const handleEmptyStateCreate = useCallback(
    (type: SceneNodeType) => {
      const id = addNode(type, screenToFlowPosition(getViewportCenter()))
      if (id) selectNode(id)
    },
    [addNode, selectNode, screenToFlowPosition, getViewportCenter]
  )

  const handleOpenAddNodePopup = useCallback((position?: { x: number; y: number }, placeAtCenter = false) => {
    setAddNodePopupPosition(position ?? getViewportCenter())
    setAddNodeAtCenter(placeAtCenter)
    setConnectionContext(null)
    setAddNodePopupOpen(true)
    setCanvasContextMenu(null)
    setNodeContextMenu(null)
  }, [getViewportCenter])

  // Empty-state upload bar → open the add-node popup pre-drilled to the "Input"
  // category (Text Prompt, Upload Image/Video/Audio, Video URL, Reference Audio).
  const handleOpenInputPanel = useCallback(() => {
    setAddNodePopupCategory("Input")
    handleOpenAddNodePopup(getViewportCenter(), true)
  }, [handleOpenAddNodePopup, getViewportCenter])

  /** Opens the add-node popup with a connectionContext bound to a specific
   *  handle. Called by HandleWithPopover's "Add new" affordance via the
   *  workflow store. The popup is anchored next to the handle's node on the
   *  side that makes sense for the direction (right for target handles —
   *  user wants an upstream node; left for source handles — user wants a
   *  downstream node). */
  const openAddNodePopupForHandle = useCallback(
    ({ nodeId, handleId, direction, nodeType, prefillName }: { nodeId: string; handleId: string; direction: "source" | "target"; nodeType: string; prefillName?: string }) => {
      const node = getNode(nodeId)
      if (!node) return
      const w = (node.measured?.width ?? 220) as number
      const h = (node.measured?.height ?? 150) as number
      // Place the new node with a comfortable gap from the current node.
      // The two sides are NOT symmetric: a target-side (input) handle wants
      // an upstream node to the LEFT, so we have to budget for the new
      // node's own width before the gap; a source-side (output) handle
      // only needs the gap past the current node's right edge.
      const NEW_NODE_EST_WIDTH = 280
      const GAP = 80
      const offsetX = direction === "target"
        ? -(NEW_NODE_EST_WIDTH + GAP)
        : w + GAP
      const flowX = node.position.x + offsetX
      const flowY = node.position.y + h / 2
      // Convert flow coordinates to screen for setAddNodePopupPosition,
      // which expects screen-space.
      const { x: vx, y: vy, zoom } = getViewport()
      const screenX = flowX * zoom + vx
      const screenY = flowY * zoom + vy
      setAddNodePopupPosition({ x: screenX, y: screenY })
      setAddNodeAtCenter(false)
      setConnectionContext({
        nodeId,
        handleId,
        direction,
        dropPosition: { x: flowX, y: flowY },
        nodeType,
        prefillName,
        color: readHandlePipColor(nodeId, handleId),
      })
      setAddNodePopupOpen(true)
      setCanvasContextMenu(null)
      setNodeContextMenu(null)
    },
    [getNode, getViewport],
  )

  // Register the handle-popup opener with the store so HandleWithPopover can call it.
  const setOpenAddNodePopupForHandleStore = useWorkflowStore((s) => s.setOpenAddNodePopupForHandle)
  useEffect(() => {
    setOpenAddNodePopupForHandleStore(openAddNodePopupForHandle)
    return () => setOpenAddNodePopupForHandleStore(null)
  }, [setOpenAddNodePopupForHandleStore, openAddNodePopupForHandle])

  const handleOpenSearch = useCallback(() => setSearchModalOpen(true), [])
  const handleOpenNodeSearch = useCallback(() => setNodeSearchModalOpen(true), [])
  const handleOpenAssetLibrary = useCallback(() => setAssetLibraryOpen(true), [])
  const handleOpenMediaLibrary = useCallback(() => setMediaLibraryOpen(true), [])
  const handleOpenComponentMarketplace = useCallback(() => setComponentMarketplaceOpen(true), [])
  const handleComponentSelect = useCallback(
    (component: ComponentSelection) => {
      const el = document.querySelector('.react-flow')
      const rect = el?.getBoundingClientRect()
      const viewportWidth = rect?.width ?? window.innerWidth
      const viewportHeight = rect?.height ?? window.innerHeight
      const { x, y, zoom } = getViewport()
      const z = zoom || 1
      const position = {
        x: (-x + viewportWidth / 2) / z,
        y: (-y + viewportHeight / 2) / z,
      }
      addNode("component", position, component as unknown as Record<string, unknown>)
    },
    [addNode, getViewport],
  )
  const handleToggleMiniMap = useCallback(() => setShowMiniMap((prev) => !prev), [])
  const handleCloseAddNodePopup = useCallback(() => {
    setAddNodePopupOpen(false)
    setAddNodePopupPosition(undefined)
    setAddNodePopupCategory(null)
    setConnectionContext(null)
    pendingEdgeDataRef.current = null
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
  const handleNodeDragStop = useCallback((_event: React.MouseEvent, draggedNode: { id: string; type?: string; position: { x: number; y: number }; parentId?: string; measured?: { width?: number; height?: number } }) => {
    setDraggingNodeId(null)
    setGuideLines([])
    // Reset wasDragging after a tick so the click handler (which fires after dragStop) can still see it
    requestAnimationFrame(() => { wasDraggingRef.current = false })

    // Group membership (spec §4.2): if a non-group node ends with >=70% overlap
    // with a group, attach (set parentId + convert to local coords). If a child
    // ends with <70% overlap with its parent, detach (clear parentId + convert
    // to world coords). When multiple groups overlap, pick the smallest area.
    if (draggedNode.type === "group") return
    const store = useWorkflowStore.getState()
    const allNodes = store.nodes
    const current = allNodes.find((n) => n.id === draggedNode.id)
    if (!current) return

    // React Flow gives us node.position in PARENT-LOCAL coords when parentId is
    // set. Convert to world for overlap math.
    const parentNode = current.parentId ? allNodes.find((n) => n.id === current.parentId) : undefined
    const worldPos = parentNode
      ? localToWorld(current.position, parentNode.position)
      : current.position
    const draggedBbox = {
      x: worldPos.x,
      y: worldPos.y,
      width: current.measured?.width ?? draggedNode.measured?.width ?? 200,
      height: current.measured?.height ?? draggedNode.measured?.height ?? 100,
    }

    let bestGroup: typeof current | undefined
    let bestArea = Infinity
    for (const g of allNodes) {
      if (g.type !== "group" || g.id === current.id) continue
      const gBbox = {
        x: g.position.x,
        y: g.position.y,
        width: g.measured?.width ?? 500,
        height: g.measured?.height ?? 400,
      }
      const overlap = computeOverlap(draggedBbox, gBbox)
      if (overlap >= GROUP_ATTACH_THRESHOLD) {
        const area = gBbox.width * gBbox.height
        if (area < bestArea) {
          bestGroup = g
          bestArea = area
        }
      }
    }

    if (bestGroup && current.parentId !== bestGroup.id) {
      // Attach: convert world coords to local (parent-relative) coords
      const local = worldToLocal(worldPos, bestGroup.position)
      store.updateNode(current.id, { parentId: bestGroup.id, position: local })
    } else if (!bestGroup && current.parentId) {
      // Detach: convert local (parent-relative) coords back to world
      store.updateNode(current.id, { parentId: undefined, position: worldPos })
    }
  }, [])

  // H3 (spec §5.2.1): when an edge feeding a Collect's "in" handle is removed,
  // prune that source from the Collect's data.order so the output order stays
  // consistent with live connections.
  const handleEdgesDelete = useCallback((deletedEdges: WorkflowEdge[]) => {
    const { nodes, updateNodeData } = useWorkflowStore.getState()
    const affected = new Map<string, string[]>()
    for (const e of deletedEdges) {
      const target = nodes.find((n) => n.id === e.target)
      if (target?.type !== "collect") continue
      if (!isCollectInEdge(e)) continue
      const existing = affected.get(e.target) ?? ((target.data as { order?: string[] }).order ?? [])
      affected.set(e.target, existing.filter((sid) => sid !== e.source))
    }
    for (const [collectId, nextOrder] of affected) {
      updateNodeData(collectId, { order: nextOrder })
    }
  }, [])

  // H4 (spec §4.4): when a Group is deleted, restore its children's world
  // coords and clear their parentId so they remain on the canvas at the
  // visual spot the user last saw them.
  const handleNodesDelete = useCallback((deletedNodes: WorkflowNode[]) => {
    const { nodes, updateNode } = useWorkflowStore.getState()
    for (const deleted of deletedNodes) {
      if (deleted.type !== "group") continue
      const children = nodes.filter((n) => n.parentId === deleted.id)
      for (const child of children) {
        const world = localToWorld(child.position, deleted.position)
        updateNode(child.id, { parentId: undefined, position: world })
      }
    }
  }, [])

  const handleTidyUp = useCallback(async () => {
    // Grouped children (parentId set) are excluded from layout like sticky
    // notes: ELK produces ABSOLUTE coords, but React Flow interprets a
    // parentId node's position as parent-LOCAL, so laying them out flings them
    // out of their group. They stay untouched (local coords) and move with
    // their group when the group itself is tidied.
    const isTidyable = (n: WorkflowNode) => n.type !== "sticky-note" && !n.parentId
    // If nodes are selected, only tidy those; otherwise tidy all
    const selectedNodes = nodes.filter((n) => n.selected && isTidyable(n))
    const isSelectionMode = selectedNodes.length >= 2
    const targetNodes = isSelectionMode ? selectedNodes : nodes.filter(isTidyable)
    const untouchedNodes = isSelectionMode
      ? nodes.filter((n) => !n.selected || !isTidyable(n))
      : nodes.filter((n) => !isTidyable(n))

    if (targetNodes.length === 0) return

    const targetIds = new Set(targetNodes.map((n) => n.id))

    // Build ELK graph using actual measured node dimensions. Uses the same
    // shared ELK instance + options as the live-build auto-layout so Tidy Up
    // is visually continuous with what was running during a pipeline.
    const elkGraph = {
      id: "root",
      layoutOptions: { ...ELK_LAYOUT_OPTIONS },
      children: targetNodes.map(toElkLayoutNode),
      edges: edges
        .filter((e) => targetIds.has(e.source) && targetIds.has(e.target))
        .map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
    }

    try {
      const elk = await getElk()
      const layout = await elk.layout(elkGraph)

      // For selection mode, offset to preserve original bounding box position
      const offsetX = isSelectionMode
        ? Math.min(...targetNodes.map((n) => n.position.x))
        : 100
      const offsetY = isSelectionMode
        ? Math.min(...targetNodes.map((n) => n.position.y))
        : 100

      const arranged = (layout.children ?? []).map((elkNode) => {
        const original = targetNodes.find((n) => n.id === elkNode.id)!
        return {
          ...original,
          position: {
            x: offsetX + (elkNode.x ?? 0),
            y: offsetY + (elkNode.y ?? 0),
          },
        }
      })

      // Re-add untouched nodes (sticky notes + unselected nodes)
      arranged.push(...untouchedNodes)

      setNodes(arranged)
      setCanvasContextMenu(null)

      // Fit the view to use screen space optimally
      requestAnimationFrame(() => fitView({ padding: 0.1, duration: 300 }))
    } catch {
      // Silently fail — layout is non-critical
    }
  }, [nodes, edges, setNodes, fitView])

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

  // Listen for custom context menu events from node 3-dots button (skips selectNode)
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, x, y } = (e as CustomEvent).detail
      setCanvasContextMenu(null)
      setAddNodePopupOpen(false)
      setNodeContextMenu({ nodeId, x, y })
    }
    window.addEventListener("open-node-context-menu", handler)
    return () => window.removeEventListener("open-node-context-menu", handler)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs/textareas/contenteditable
      const target = e.target as HTMLElement
      const activeEl = document.activeElement as HTMLElement | null
      const isEditable = (el: HTMLElement | null) =>
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      if (isEditable(target) || isEditable(activeEl)) {
        return
      }

      // Cmd/Ctrl+I — toggle fullscreen settings (must run BEFORE overlayOpen guard)
      if (matchShortcut(e, SHORTCUTS.fullscreenSettings)) {
        const state = useWorkflowStore.getState()
        if (state.configPanelFullscreen) {
          e.preventDefault()
          closeFullscreenSettings()
          return
        }
        const nodeId = state.selectedNodeId ?? state.nodes.find((n) => n.selected)?.id
        if (nodeId) {
          e.preventDefault()
          openFullscreenSettings(nodeId)
        }
        return
      }

      // Alt/Option + = / - — snap zoom in / out. Cmd/Ctrl + ± is the browser's
      // native page zoom and is deliberately left untouched. Match on e.code
      // because on macOS Option composes the character (Option+= → "≠"), so
      // e.key is unreliable; e.code is the physical key.
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const zoomIn = e.code === "Equal" || e.code === "NumpadAdd"
        const zoomOut = e.code === "Minus" || e.code === "NumpadSubtract"
        if (zoomIn || zoomOut) {
          e.preventDefault()
          const current = getViewport().zoom
          zoomTo(snapZoom(current, zoomIn ? 1 : -1), { duration: 200 })
          return
        }
      }

      // Ctrl/Control + Alt/Option + Arrow — pan the canvas. Placed BEFORE the
      // arrow-key node-nav/nudge branches below (which match e.key and ignore
      // modifiers) so it wins and returns. Requiring Alt (not plain Ctrl+Arrow)
      // sidesteps the macOS Mission Control "switch Spaces" binding. Match on
      // e.code so it is keyboard-layout/compose independent.
      if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
        const delta = panDelta(e.code, PAN_STEP_PX)
        if (delta) {
          e.preventDefault()
          const vp = getViewport()
          setViewport({ x: vp.x + delta.dx, y: vp.y + delta.dy, zoom: vp.zoom }, { duration: 0 })
          return
        }
      }

      // Cmd/Ctrl+E (or Alt/Option+E) — toggle the quick-edit Prompt modal for the
      // selected node (runs BEFORE the overlay guard so it can close its own
      // dialog). Alt+E is the escape hatch: the "Claude in Chrome" extension binds
      // ⌘E to its side panel, swallowing it before the page sees it. Alt+E matches
      // on e.code ("KeyE") since macOS Option+E is a dead key (composes "´").
      if (matchShortcut(e, SHORTCUTS.promptEditor)) {
        const state = useWorkflowStore.getState()
        if (state.promptEditNodeId) {
          e.preventDefault()
          state.closePromptEditor()
          return
        }
        const nodeId = state.selectedNodeId ?? state.nodes.find((n) => n.selected)?.id
        const nodeType = nodeId ? state.nodes.find((n) => n.id === nodeId)?.type : undefined
        if (nodeId && nodeHasPromptField(nodeType)) {
          e.preventDefault()
          state.openPromptEditor(nodeId)
        }
        return
      }

      // Alt/Option+F — toggle the focused node's result in the fullscreen
      // lightbox. Matches on e.code "KeyF" because macOS Option+F composes "ƒ"
      // (e.key is unreliable). Runs BEFORE the overlay guard so a second press
      // closes it. No-op (but still consumes the combo) when the focused node has
      // no previewable image/video/audio result.
      if (matchShortcut(e, SHORTCUTS.resultPreview)) {
        e.preventDefault()
        setFullscreenNodeId((cur) => {
          if (cur) return null // already open → toggle off
          const state = useWorkflowStore.getState()
          const nodeId = state.selectedNodeId ?? state.nodes.find((n) => n.selected)?.id
          const node = nodeId ? state.nodes.find((n) => n.id === nodeId) : undefined
          return node && getFocusedNodeMedia(node) ? node.id : null
        })
        return
      }

      // Escape — close fullscreen first, then two-step deselect (must run BEFORE overlayOpen guard)
      if (e.key === "Escape") {
        // The Alt+F result lightbox is the topmost overlay — dismiss just it and
        // keep the node selected underneath (this capture handler runs before the
        // modal's own Escape, so without this it would also deselect the node).
        if (fullscreenNodeIdRef.current) {
          e.stopPropagation()
          setFullscreenNodeId(null)
          return
        }
        setAddNodePopupOpen(false)
        setCanvasContextMenu(null)
        setNodeContextMenu(null)
        setEdgeContextMenu(null)
        const state = useWorkflowStore.getState()
        if (state.configPanelFullscreen) {
          // stopPropagation: prevent React Flow's own Escape handler from also
          // deselecting the node (which would clear node.selected and remove the glow).
          e.stopPropagation()
          closeFullscreenSettings()
        } else if (state.selectedNodeId) {
          // Closing the sidebar keeps the node RF-focused (blue glow, no settings).
          // stopPropagation prevents React Flow from also firing deselection.
          e.stopPropagation()
          useWorkflowStore.setState({ selectedNodeId: null })
        } else {
          // Node is RF-selected only: deselect fully. selectNode(null) already
          // clears node.selected so no need for React Flow's handler either.
          e.stopPropagation()
          selectNode(null)
        }
        return
      }

      // Arrow keys + picker grid navigation while fullscreen settings are open.
      // Must run BEFORE the overlayOpen guard so we can both block React Flow's
      // node-nudge (via stopPropagation) and drive tile-grid focus/selection.
      if (useWorkflowStore.getState().configPanelFullscreen) {
        const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        const isSelect = e.key === "Enter"
        const isMultiAdd = e.key === " " || e.key === "+"
        const isInputLike = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement

        if (isArrow) {
          // Left/right inside a text input should still move the cursor.
          // Up/down from an input jumps focus into the tile grid.
          if (isInputLike) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              e.stopPropagation()
              const grid = document.querySelector<HTMLElement>("[data-picker-grid]")
              grid?.querySelector<HTMLButtonElement>("button[type='button']")?.focus()
            }
            // Always block node-nudge even when focus is in an input
            e.stopPropagation()
            return
          }
          e.preventDefault()
          e.stopPropagation()
          const grid = document.querySelector<HTMLElement>("[data-picker-grid]")
          if (grid) {
            const btns = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[type='button']"))
            const active = document.activeElement as HTMLButtonElement | null
            const idx = active ? btns.indexOf(active) : -1
            if (e.key === "ArrowRight") {
              btns[(Math.max(idx, 0) + 1) % btns.length]?.focus()
            } else if (e.key === "ArrowLeft") {
              btns[(idx <= 0 ? btns.length : idx) - 1]?.focus()
            } else {
              const cols = estimatePickerGridCols(btns)
              const delta = e.key === "ArrowDown" ? cols : -cols
              btns[Math.max(0, Math.min(btns.length - 1, Math.max(idx, 0) + delta))]?.focus()
            }
          }
          return
        }

        if (!isInputLike && (isSelect || isMultiAdd)) {
          const grid = document.querySelector<HTMLElement>("[data-picker-grid]")
          if (grid) {
            const btns = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[type='button']"))
            const active = document.activeElement as HTMLButtonElement | null
            const idx = active ? btns.indexOf(active) : -1
            if (idx >= 0) {
              const entryId = btns[idx]?.dataset.entryId
              if (entryId) {
                e.preventDefault()
                e.stopPropagation()
                // Enter = force single-select; Space/+ = add to multi-select
                grid.dispatchEvent(new CustomEvent("picker-select", {
                  detail: { action: isSelect ? "single" : "multi", id: entryId },
                  bubbles: true,
                }))
                // Enter on an already-selected tile confirms and closes fullscreen
                if (isSelect && btns[idx]?.getAttribute("aria-checked") === "true") {
                  closeFullscreenSettings()
                }
              }
            }
          }
          return
        }

        // All other keys while fullscreen: pass through (typing in inputs, etc.)
        return
      }

      // Skip workflow shortcuts when a fullscreen overlay is open: config panel
      // expanded, image edit, freecut, or any open MODAL dialog/lightbox. Lets
      // the active overlay handle keys (arrow nav inside the modal, text
      // selection copy, etc.) instead of moving nodes underneath. Scope the
      // DOM check to `[aria-modal="true"]` so non-modal Radix Popovers (handle
      // popover, tooltips, dropdowns — all share `role="dialog"` by Radix
      // default) DON'T trip the gate. Without the aria-modal scope, opening a
      // handle popover would silently disable Cmd+Z / Cmd+Shift+Z and every
      // other shortcut below.
      const storeState = useWorkflowStore.getState()
      const overlayOpen =
        storeState.configPanelFullscreen ||
        storeState.freecutEdit !== null ||
        storeState.imageEdit !== null ||
        !!document.querySelector('[role="dialog"][aria-modal="true"]')
      if (overlayOpen) return

      // "?" — show the keyboard shortcuts help (layout-independent: matches the "?"
      // char or Shift+physical-Slash). Gated by the editable + overlay guards above.
      if (matchShortcut(e, SHORTCUTS.help)) {
        e.preventDefault()
        setShortcutsHelpOpen(true)
        return
      }

      // Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y — Redo
      if (matchShortcut(e, SHORTCUTS.redo)) {
        e.preventDefault()
        redo()
        return
      }

      // Ctrl/Cmd+Z — Undo
      if (matchShortcut(e, SHORTCUTS.undo)) {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl/Cmd+Shift+G — Toggle grid snap
      if (matchShortcut(e, SHORTCUTS.gridSnap)) {
        e.preventDefault()
        handleToggleSnap()
        return
      }

      // Ctrl/Cmd+Shift+A — Toggle alignment guides
      if (matchShortcut(e, SHORTCUTS.alignmentGuides)) {
        e.preventDefault()
        handleToggleAlignment()
        return
      }

      // Tab - Open Add Node popup at mouse position
      if (matchShortcut(e, SHORTCUTS.addNode)) {
        e.preventDefault()
        const pos = lastMousePositionRef.current
        handleOpenAddNodePopup(pos.x !== 0 || pos.y !== 0 ? pos : undefined)
        return
      }

      // Ctrl+K - Search projects and workflows
      if (matchShortcut(e, SHORTCUTS.search)) {
        e.preventDefault()
        setSearchModalOpen(true)
        return
      }

      // Ctrl/Cmd+F - Quick node search inside the current workflow.
      // Overrides browser's native find-in-page (the canvas isn't HTML
      // text content the browser can search anyway). Skipped when an
      // input/textarea has focus — the editable check at the top of
      // this handler returns early before we reach here.
      if (matchShortcut(e, SHORTCUTS.findNode)) {
        e.preventDefault()
        setNodeSearchModalOpen(true)
        return
      }

      // Ctrl+L - My Library
      if (matchShortcut(e, SHORTCUTS.myLibrary)) {
        e.preventDefault()
        setAssetLibraryOpen(true)
        return
      }

      // Ctrl+M - Media Library
      if (matchShortcut(e, SHORTCUTS.mediaLibrary)) {
        e.preventDefault()
        setMediaLibraryOpen((prev) => !prev)
        return
      }

      // Shift+S - Add sticky note
      if (matchShortcut(e, SHORTCUTS.stickyNote)) {
        e.preventDefault()
        handleAddStickyNote()
        return
      }

      // Alt+T - Tidy up
      if (matchShortcut(e, SHORTCUTS.tidyUp)) {
        e.preventDefault()
        handleTidyUp()
        return
      }

      // Ctrl+B - Toggle sidebar
      if (matchShortcut(e, SHORTCUTS.sidebar)) {
        e.preventDefault()
        onToggleSidebar()
        return
      }

      // Ctrl+A - Select all
      if (matchShortcut(e, SHORTCUTS.selectAll)) {
        e.preventDefault()
        handleSelectAll()
        return
      }

      // Effective target for the clipboard / duplicate shortcuts: the React
      // Flow multi-selection (`.selected`), else the node whose config panel
      // is open (`selectedNodeId`). This decouples these shortcuts from the
      // config panel being open and makes them honor a multi-node selection —
      // previously Ctrl+D only fired when `selectedNodeId` was set (i.e.
      // settings open) and ignored multi-select entirely.
      //
      // We deliberately do NOT fall back to `focusedNodeRef` (the last
      // single-clicked node): that ref is only cleared on pane-click, so after
      // an Escape/deselect it stays set and would let Ctrl+X silently cut a
      // node that the canvas shows as deselected. `.selected` is the visible
      // selection (it drives the selection ring + native delete), so it is the
      // correct source of truth here.
      //
      // `includeStickyNotes`: Ctrl+D duplicates sticky notes too (matches the
      // old single-node behavior), but Ctrl+C/X keep excluding them — the
      // clipboard payload/paste flow never handled sticky notes.
      const shortcutTargetIds = (includeStickyNotes = false): string[] => {
        const s = useWorkflowStore.getState()
        const eligible = (n: (typeof s.nodes)[number]) =>
          n.selected && (includeStickyNotes || n.type !== "sticky-note")
        const selectedIds = s.nodes.filter(eligible).map((n) => n.id)
        if (selectedIds.length > 0) return selectedIds
        const single = s.selectedNodeId
        return single &&
          s.nodes.some((n) => n.id === single && (includeStickyNotes || n.type !== "sticky-note"))
          ? [single]
          : []
      }

      // Ctrl+D - Duplicate selected node(s), preserving edges between them
      if (matchShortcut(e, SHORTCUTS.duplicate)) {
        const ids = shortcutTargetIds(true)
        if (ids.length === 0) return
        e.preventDefault()
        duplicateNodes(ids)
        return
      }

      // Ctrl+C / Ctrl+X — Copy or Cut selected nodes
      if (matchShortcut(e, SHORTCUTS.copy) || matchShortcut(e, SHORTCUTS.cut)) {
        // If there's an active text selection anywhere on the page, let the
        // browser copy/cut the text instead of the node.
        const sel = typeof window !== "undefined" ? window.getSelection() : null
        if (sel && sel.toString().length > 0) return
        const state = useWorkflowStore.getState()
        const selectedIds = new Set(shortcutTargetIds())
        if (selectedIds.size === 0) return
        const selected = state.nodes.filter((n) => selectedIds.has(n.id))
        e.preventDefault()
        const connectedEdges = state.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
        const payload = JSON.stringify({ __nodaro_clipboard: true, name: state.workflowName, nodes: selected, edges: connectedEdges })
        navigator.clipboard.writeText(payload).then(() => {
          if (matchShortcut(e, SHORTCUTS.cut)) {
            // Cut mutates the canvas — block in read-only (copy still works above).
            if (useWorkflowStore.getState().isReadOnly) return
            useWorkflowStore.setState({
              nodes: state.nodes.filter((n) => !selectedIds.has(n.id)),
              edges: state.edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target)),
              selectedNodeId: null,
              isDirty: true,
            })
          }
        }).catch(() => {})
        return
      }

      // Ctrl+V - Paste nodes from clipboard
      if (matchShortcut(e, SHORTCUTS.paste)) {
        // Paste mutates the canvas — block entirely in read-only.
        if (useWorkflowStore.getState().isReadOnly) return
        e.preventDefault()
        navigator.clipboard.readText().then((text) => {
          let parsed: { __nodaro_clipboard?: boolean; name?: string; nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }
          try { parsed = JSON.parse(text) } catch { return }
          if (!parsed.__nodaro_clipboard || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return

          const nodesToPaste = migrateImageNodes(parsed.nodes)
          const edgesToPaste = parsed.edges ?? []
          const clipboardName = parsed.name || "Workflow"

          // Build the id map first so the parentId + loop connectedSourceId
          // remaps below see every node regardless of order. Clone data via the
          // shared helper so paste, duplicate, and multi-duplicate strip and
          // regenerate identically (exec state, entity DbIds, sub-workflow /
          // router / loop UUIDs). The helper also fills handleMap, used by the
          // edge-handle remap below.
          const idMap: Record<string, string> = {}
          for (const node of nodesToPaste) {
            idMap[node.id] = `${node.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
          }
          const handleMap: Record<string, string> = {}
          const newNodes = nodesToPaste.map(
            (node) =>
              ({ ...node, id: idMap[node.id], data: buildDuplicatedNodeData(node, handleMap, idMap) }) as WorkflowNode,
          )

          // Remap parentId on copied children (spec §4.4).
          // - If a child's original parent was ALSO in the copied selection,
          //   point parentId at the new group ID (keep position — local coords).
          // - If the parent was NOT copied, drop parentId AND convert position
          //   from parent-local to world coords (look up the parent in the
          //   ORIGINAL clipboard payload; it has the parent's world position).
          const clipboardById = new Map(nodesToPaste.map((n) => [n.id, n]))
          for (let i = 0; i < newNodes.length; i++) {
            const original = nodesToPaste[i]
            const originalParentId = original.parentId
            if (!originalParentId) continue
            const remapped = idMap[originalParentId]
            if (remapped) {
              newNodes[i] = { ...newNodes[i], parentId: remapped }
            } else {
              const oldParent = clipboardById.get(originalParentId)
              const child = newNodes[i] as WorkflowNode & { parentId?: string }
              const worldPos = oldParent
                ? {
                    x: original.position.x + oldParent.position.x,
                    y: original.position.y + oldParent.position.y,
                  }
                : original.position
              const { parentId: _drop, ...rest } = child
              newNodes[i] = { ...rest, position: worldPos } as WorkflowNode
            }
          }

          const newEdges = edgesToPaste.map((edge) => ({
            ...edge,
            id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            source: idMap[edge.source] || edge.source,
            target: idMap[edge.target] || edge.target,
          }))

          // Loop/list column handles were regenerated by buildDuplicatedNodeData
          // (recorded in handleMap); re-point any cloned edges that referenced them.
          for (const edge of newEdges) {
            if (edge.sourceHandle && handleMap[edge.sourceHandle]) {
              edge.sourceHandle = handleMap[edge.sourceHandle]
            }
            if (edge.targetHandle && handleMap[edge.targetHandle]) {
              edge.targetHandle = handleMap[edge.targetHandle]
            }
          }

          const state = useWorkflowStore.getState()
          const canvasEmpty = state.nodes.length === 0

          if (canvasEmpty) {
            // Empty canvas: paste at original positions, update workflow name
            const pastedNodes = newNodes.map((n) => ({ ...n, selected: true }))
            useWorkflowStore.setState({
              nodes: pastedNodes,
              edges: newEdges,
              workflowName: clipboardName,
              isDirty: true,
            })
          } else {
            // Canvas has items: show import dialog, capture mouse position now
            const mousePos = lastMousePositionRef.current
            setPendingImportData({ nodes: newNodes, edges: newEdges, name: clipboardName, mousePos: { ...mousePos } })
          }
        }).catch(() => {})
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
        // Read fresh state to avoid stale closure
        const currentSelectedId = useWorkflowStore.getState().selectedNodeId
        if (currentSelectedId) {
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
      // Read fresh selectedNodeId to handle rapid key presses correctly
      const currentSelectedForArrow = useWorkflowStore.getState().selectedNodeId
      if (currentSelectedForArrow && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
        // Capture-phase + stopPropagation prevents React Flow's built-in
        // keyboard nudge from also firing on the currently-selected node when
        // we're using arrows to navigate to the neighbor instead of moving.
        e.stopPropagation()
        const current = getNode(currentSelectedForArrow)
        if (current) {
          const cx = current.position.x + (current.measured?.width ?? 200) / 2
          const cy = current.position.y + (current.measured?.height ?? 100) / 2
          let bestId: string | null = null
          let bestDist = Infinity
          for (const n of useWorkflowStore.getState().nodes) {
            if (n.id === currentSelectedForArrow || n.hidden) continue
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

    }
    // Capture phase so the handler runs BEFORE React Flow's per-node arrow
    // nudge listener — required for the settings-panel-open arrow-nav branch
    // to stopPropagation and prevent the current node from being moved while
    // selection jumps to the neighbor.
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [selectedNodeId, duplicateNodes, deleteNode, handleAddStickyNote, handleTidyUp, handleSelectAll, handleOpenAddNodePopup, onToggleSidebar, undo, redo, handleToggleSnap, handleToggleAlignment, alignmentEnabled, computeGuides, getNode, openFullscreenSettings, closeFullscreenSettings])

  // Listen for pan-to events dispatched from teleporter config panel "Pan to" buttons
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === detail.nodeId)
      if (node) {
        setCenter(
          node.position.x + (node.measured?.width ?? 150) / 2,
          node.position.y + (node.measured?.height ?? 40) / 2,
          { zoom: 1, duration: 500 }
        )
      }
    }
    window.addEventListener(TELEPORTER_PAN_EVENT, handler)
    return () => window.removeEventListener(TELEPORTER_PAN_EVENT, handler)
  }, [setCenter])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (
      types.includes("application/nodaro-image") ||
      types.includes("application/nodaro-video") ||
      types.includes("application/nodaro-audio") ||
      types.includes("application/nodaro-text")
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const imageUrl = e.dataTransfer.getData("application/nodaro-image")
      const videoUrl = e.dataTransfer.getData("application/nodaro-video")
      const audioUrl = e.dataTransfer.getData("application/nodaro-audio")
      const textVal  = e.dataTransfer.getData("application/nodaro-text")
      if (!imageUrl && !videoUrl && !audioUrl && !textVal) return
      e.preventDefault()

      const edgeCtxStr = e.dataTransfer.getData("application/nodaro-edge-context")
      if (edgeCtxStr) {
        // Dragged from a list/table cell — open node picker + auto-connect with item:N
        try {
          const { sourceNodeId, sourceHandle, itemIndex } = JSON.parse(edgeCtxStr)
          pendingEdgeDataRef.current = { outputMode: "item", itemIndex: String(itemIndex) }
          setAddNodePopupPosition({ x: e.clientX, y: e.clientY })
          setConnectionContext({
            nodeId: sourceNodeId,
            handleId: sourceHandle,
            direction: "source",
            dropPosition: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            color: readHandlePipColor(sourceNodeId, sourceHandle),
          })
          setAddNodePopupOpen(true)
        } catch { /* ignore malformed data */ }
        return
      }

      // Plain image drag (from character/object/location pages) — create generate-image node.
      // Only image keeps this fallback; video/audio/text drags only originate from list/table cells
      // (which always set edge-context) so they have no plain-drag path.
      if (imageUrl) {
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
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
      }
    },
    [screenToFlowPosition, addNode],
  )

  const handleAddAssetToCanvas = useCallback(
    (asset: LibraryAsset) => {
      const node = assetToUploadNode(asset)
      if (!node) return
      addNode(node.type, screenToFlowPosition(getViewportCenter()), node.data)
      setMediaLibraryOpen(false)
    },
    [screenToFlowPosition, addNode, getViewportCenter],
  )

  const dismissImportDialog = useCallback(() => setPendingImportData(null), [])

  const handleImportPaste = useCallback(() => {
    if (useWorkflowStore.getState().isReadOnly) return
    if (!pendingImportData) return
    const { nodes: newNodes, edges: newEdges, mousePos } = pendingImportData
    const state = useWorkflowStore.getState()
    const screenTarget = (mousePos.x !== 0 || mousePos.y !== 0) ? mousePos : getViewportCenter()
    const flowPos = screenToFlowPosition(screenTarget)
    // Use only top-level (non-child) nodes for bbox/center math — children's
    // positions are in parent-local coords (spec §4.4) and would skew the
    // centroid; they will also be shifted via their parent's offset.
    const topLevel = newNodes.filter((n) => !n.parentId)
    const bboxNodes = topLevel.length > 0 ? topLevel : newNodes
    const minX = Math.min(...bboxNodes.map((n) => n.position.x))
    const maxX = Math.max(...bboxNodes.map((n) => n.position.x + (n.measured?.width ?? 200)))
    const minY = Math.min(...bboxNodes.map((n) => n.position.y))
    const maxY = Math.max(...bboxNodes.map((n) => n.position.y + (n.measured?.height ?? 100)))
    const offsetX = flowPos.x - (minX + maxX) / 2
    const offsetY = flowPos.y - (minY + maxY) / 2
    const pastedNodes = newNodes.map((n) => ({
      ...n,
      // Children keep local coords — they move with their parent's shift.
      position: n.parentId
        ? n.position
        : { x: n.position.x + offsetX, y: n.position.y + offsetY },
      selected: true,
    }))
    useWorkflowStore.setState({
      nodes: [...state.nodes.map((n) => n.selected ? { ...n, selected: false } : n), ...pastedNodes],
      edges: [...state.edges, ...newEdges],
      isDirty: true,
    })
    setPendingImportData(null)
  }, [pendingImportData, screenToFlowPosition, getViewportCenter])

  const handleImportNew = useCallback(async () => {
    if (!pendingImportData) return
    const { nodes: newNodes, edges: newEdges, name } = pendingImportData
    const projectId = useWorkflowStore.getState().projectId
    if (!projectId) return
    const wf = await createWorkflow(projectId, `Imported: ${name}`)
    if (!wf) {
      toast.error("Failed to create workflow")
      return
    }
    const supabase = createClient()
    const { error } = await supabase.from("workflows").update({
      nodes: JSON.parse(JSON.stringify(newNodes)),
      edges: JSON.parse(JSON.stringify(newEdges)),
    }).eq("id", wf.id)
    if (error) {
      toast.error("Failed to save imported nodes")
      return
    }
    setPendingImportData(null)
    navigate(`/projects/${projectId}/workflows/${wf.id}`)
  }, [pendingImportData, createWorkflow, navigate])

  const hasSelection = nodes.some((n) => n.selected)

  return (
    <>
      {/* Canvas Toolbar (icon buttons on left) */}
      <CanvasToolbar
        onAddNode={handleOpenAddNodePopup}
        onComponents={handleOpenComponentMarketplace}
        onSearch={handleOpenSearch}
        onFindInWorkflow={handleOpenNodeSearch}
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
        onShowShortcuts={() => setShortcutsHelpOpen(true)}
      />

      {/* Canvas Controls (zoom, fit, minimap toggle - bottom left) */}
      <CanvasControls
        zoom={zoom}
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
        initialCategory={addNodePopupCategory}
        connectionContext={connectionContext}
        // Pass plain `addNode` (not `addNodeAndOpenPicker`) so the popup
        // can sequence: create node → wire edge → THEN open the picker.
        // Opening the picker BEFORE the edge would mount the panel against
        // a state that's missing the new edge, breaking previews that read
        // upstream context on first render (CameraMotionConfig).
        storeAddNode={addNode}
        storeOnConnect={useCallback((connection: import("@xyflow/react").Connection) => {
          onConnect(connection)
          if (pendingEdgeDataRef.current) {
            const { edges: latestEdges } = useWorkflowStore.getState()
            const newEdge = latestEdges.find((ed) => ed.source === connection.source && ed.target === connection.target && ed.sourceHandle === connection.sourceHandle)
            if (newEdge) updateEdgeData(newEdge.id, pendingEdgeDataRef.current)
            pendingEdgeDataRef.current = null
          }
        }, [onConnect, updateEdgeData])}
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

      {/* Quick Node Search Modal — Cmd/Ctrl+F. */}
      {nodeSearchModalOpen && (
        <Suspense fallback={null}>
          <NodeSearchModal
            open={nodeSearchModalOpen}
            onClose={() => setNodeSearchModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Keyboard shortcuts help — opened via "?" or the toolbar button. */}
      <ShortcutsHelpModal open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />

      {/* Alt/Option+F — focused node's result in the fullscreen lightbox. Derived
          from the live node each render so streaming results stay fresh; closes
          itself if the node loses its result or is removed. */}
      {fullscreenNodeId && (() => {
        const node = nodes.find((n) => n.id === fullscreenNodeId)
        const media = node ? getFocusedNodeMedia(node) : null
        if (!media) return null
        return (
          <MediaPreviewModal
            isOpen
            onClose={() => setFullscreenNodeId(null)}
            type={media.type}
            url={media.url}
            results={media.results}
            initialIndex={media.initialIndex}
          />
        )
      })()}

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

      {/* Templates — full dashboard surface as an in-editor dialog (no navigation) */}
      {templatesModalOpen && (
        <Dialog open={templatesModalOpen} onOpenChange={(o) => !o && setTemplatesModalOpen(false)}>
          <DialogContent className="w-[92vw] sm:max-w-5xl h-[88vh] overflow-y-auto p-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Templates</DialogTitle>
            </DialogHeader>
            <Suspense fallback={null}>
              <TemplatesPageModal />
            </Suspense>
          </DialogContent>
        </Dialog>
      )}

      {/* Tutorials — full dashboard surface as an in-editor dialog (no navigation) */}
      {tutorialsModalOpen && (
        <Dialog open={tutorialsModalOpen} onOpenChange={(o) => !o && setTutorialsModalOpen(false)}>
          <DialogContent className="w-[92vw] sm:max-w-5xl h-[88vh] overflow-y-auto p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Tutorials</DialogTitle>
            </DialogHeader>
            <Suspense fallback={null}>
              <TutorialsTabModal />
            </Suspense>
          </DialogContent>
        </Dialog>
      )}

      {/* Component Marketplace Modal */}
      {componentMarketplaceOpen && (
        <Suspense fallback={null}>
          <ComponentMarketplaceModal
            open={componentMarketplaceOpen}
            onOpenChange={setComponentMarketplaceOpen}
            onSelect={handleComponentSelect}
            variant="fullscreen"
          />
        </Suspense>
      )}

      <MobileCanvasContext.Provider value={mobileContextValue}>
      <CanvasZoomContext.Provider value={zoomContextValue}>
      <div className="relative w-full h-full" onDragOver={handleDragOver} onDrop={handleDrop} onMouseMove={(e) => { lastMousePositionRef.current = { x: e.clientX, y: e.clientY } }}>
        {isReadOnly && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 rounded-full border border-[#ff0073]/40 bg-background/90 px-4 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur pointer-events-none">
            Studio workflow — view only. Open in Studio to edit, or Clone &amp; Remix.
          </div>
        )}
        <ReactFlow
          nodes={orderedNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onClickConnectStart={handleClickConnectStart}
          onClickConnectEnd={handleClickConnectEnd}
          isValidConnection={isValidConnection}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={(_event, node) => { selectNode(node.id); focusedNodeRef.current = node.id }}
          onPaneClick={handlePaneClick}
          onNodeContextMenu={isMobile ? undefined : handleNodeContextMenu}
          onPaneContextMenu={isMobile ? undefined : handlePaneContextMenu}
          onEdgeContextMenu={isMobile ? undefined : onEdgeContextMenu}
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onEdgesDelete={handleEdgesDelete}
          onNodesDelete={handleNodesDelete}
          snapToGrid={snapEnabled}
          snapGrid={[16, 16]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'default' }}
          // Strict (React Flow's default): a connection's two ends MUST be a
          // source (output) + a target (input). This stops the connection line
          // from snapping/attaching to OUTPUT handles when the user drags
          // toward an INPUT — the "edge jumps to the output handle" bug. Under
          // the previous Loose mode every handle, including outputs, was a
          // valid snap/drop target, so a drag aimed at an input could grab the
          // node's output (most visible on nodes with hidden input handles).
          // Bidirectional dragging (start the drag from an input OR an output)
          // still works under Strict; only nonsensical source→source /
          // target→target connects are disallowed — which the DAG never wants.
          // Safe because every handle in the system declares the correct
          // `type` (audited: inputs are Position.Left "target", outputs are
          // Position.Right "source", with zero type/side contradictions).
          connectionMode={ConnectionMode.Strict}
          // Match HandleWithPopover's click-vs-drag threshold (5px) so a small
          // pointer jitter on a typed pip doesn't simultaneously open the
          // popover AND trigger React Flow's connect-end (which would open
          // the empty-canvas add-node popup).
          connectionDragThreshold={5}
          connectOnClick={isMobile}
          selectNodesOnDrag={!isMobile}
          nodesDraggable={!isReadOnly}
          nodesConnectable={!isReadOnly}
          edgesReconnectable={!isReadOnly}
          deleteKeyCode={isReadOnly ? null : ["Delete", "Backspace"]}
          className={cn(
            "bg-background touch-manipulation",
            connectingFromType === "source" && "connecting-from-source",
            connectingFromType === "target" && "connecting-from-target",
          )}
          panOnScroll
          zoomOnPinch
          panOnDrag
          elevateNodesOnSelect
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
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
        {/* Phase 1B.4 — Follow build button. Surfaces when a pipeline is
            actively building and the user has moved/scrolled within the
            last 5s. Clicking re-arms idle so the canvas immediately pans
            to the freshest pipeline-owned node. Hidden on mobile because
            the canvas already supports gesture-driven navigation there. */}
        {!isMobile && isPipelineActive && !livebuildIdle && lastAddedPipelineNodeId && (
          <Button
            size="sm"
            variant="outline"
            onClick={followBuild}
            className="absolute top-3 right-3 z-30 shadow-sm bg-background"
            data-testid="follow-build-button"
          >
            Follow build →
          </Button>
        )}
        {/* Workflow-loading surface. Shown for the whole fetch window
            (`isWorkflowLoading` is set true at the start of load() and
            cleared in its finally, by which point the store's nodes are
            populated) so the user sees a loader instead of a blank/flashing
            canvas until the nodes are ready to render. Mutually exclusive
            with the empty-canvas state below (gated on `!isWorkflowLoading`).
            `pointer-events-none` so it never traps clicks; the light scrim
            masks the bare grid for a clean "loading" read. */}
        {isWorkflowLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 pointer-events-none bg-background/70 backdrop-blur-[1px]">
            <Loader2 className="w-8 h-8 text-[#ff0073] animate-spin" />
            <span className="text-sm text-muted-foreground">Loading workflow…</span>
          </div>
        )}
        {/* First-run empty-canvas surface. Gated on a loaded (not loading) workflow
            with zero nodes. isWorkflowLoading suppresses the flash that would
            otherwise appear while the initial loadWorkflow(id, "", [], []) clear
            sets workflowId before the real nodes arrive from the fetch. */}
        {realtimeWorkflowId != null && nodes.length === 0 && !isWorkflowLoading && (
          <EmptyCanvasState
            onCreate={handleEmptyStateCreate}
            onOpenInputPanel={handleOpenInputPanel}
            onOpenMyLibrary={handleOpenAssetLibrary}
            onOpenMediaLibrary={handleOpenMediaLibrary}
            onOpenTemplates={() => setTemplatesModalOpen(true)}
            onOpenTutorials={() => setTutorialsModalOpen(true)}
          />
        )}
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

      {edgeContextMenu && (
        <>
          {/* Backdrop to close menu on click outside */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setEdgeContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1"
            style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              onClick={() => {
                replaceEdgeWithTeleporter(edgeContextMenu.edgeId)
                setEdgeContextMenu(null)
              }}
            >
              Replace with Teleporter
            </button>
          </div>
        </>
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

      {/* Import Dialog — shown when pasting into a non-empty canvas */}
      <Dialog open={pendingImportData !== null} onOpenChange={(open) => { if (!open) dismissImportDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Nodes</DialogTitle>
            <DialogDescription>
              Your canvas already has nodes. How would you like to import?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={handleImportPaste}>
              Paste Here
            </Button>
            <Button onClick={handleImportNew}>
              New Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
