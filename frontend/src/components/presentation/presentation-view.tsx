/**
 * PresentationView — clean theme-aware presentation mode.
 * Orchestrator that delegates to view-specific components.
 *
 * Works in both "tab" mode (inside editor) and "fullscreen" mode (shared link).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Play, Loader2, ExternalLink, Pencil, Eye, LogIn, RotateCcw, Maximize2, Minimize2 } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable"
import { Button } from "@/components/ui/button"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { hasCredits } from "@/lib/edition"
import { useAuth, refreshAuth, setAuthFromTokens } from "@/hooks/use-auth"
import { useWorkflowStore, type PresentationViewMode, type PresentationSettings } from "@/hooks/use-workflow-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import type { WorkflowNode } from "@/types/nodes"
import {
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeLabel,
  getNodeResult,
} from "@/lib/presentation-utils"
import { NODE_CREDIT_COSTS, EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import { shareWorkflow } from "@/lib/api"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"
import { toast } from "sonner"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { ShareDialog } from "./share-dialog"
import { PublishDialog } from "./publish-dialog"
import { NodePickerDialog } from "./node-picker-dialog"
import { RunTargetSelector } from "./run-target-selector"
import { ViewModeSelector, ALL_VIEW_MODES } from "./view-mode-selector"
import { TextInputCard } from "./input-cards/text-input-card"
import { ImageUploadCard } from "./input-cards/image-upload-card"
import { VideoUploadCard } from "./input-cards/video-upload-card"
import { AudioUploadCard } from "./input-cards/audio-upload-card"
import { ParameterCard } from "./input-cards/parameter-card"
import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"
import {
  HorizontalView,
  VerticalView,
  GalleryView,
  FullscreenView,
  CompareView,
} from "./views"

const POINTER_ACTIVATION = { activationConstraint: { distance: 5 } } as const
const VALID_VIEW_MODES = new Set<PresentationViewMode>(ALL_VIEW_MODES)

/** Reorder nodes by an ID array, appending any new nodes at the end */
function orderNodesByIds(nodes: WorkflowNode[], order: string[] | undefined): WorkflowNode[] {
  if (!order || order.length === 0) return nodes
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const ordered: WorkflowNode[] = []
  for (const id of order) {
    const node = nodeMap.get(id)
    if (node) {
      ordered.push(node)
      nodeMap.delete(id)
    }
  }
  for (const node of nodeMap.values()) ordered.push(node)
  return ordered
}

/** getNodeResult that also checks input node data fields (url, text) */
function getNodeResultWithInputFallback(node: WorkflowNode): { url?: string; text?: string } {
  const data = node.data as Record<string, unknown>
  const result = getNodeResult(data)
  if (result.url || result.text) return result
  // Input nodes store their content in data.url / data.text directly
  const url = data.url as string | undefined
  const text = data.text as string | undefined
  return { url: url || undefined, text: text || undefined }
}

interface PresentationViewProps {
  mode: "tab" | "fullscreen"
  isOwner: boolean
  onExitFullscreen?: () => void
  onRun?: () => void
  onCancel?: () => void
  onNewRun?: () => void
  newRunLabel?: string
  inputsReadOnly?: boolean
  suppressOutputFallback?: boolean
  isRunning?: boolean
  /** Show a native fullscreen toggle button in the header */
  showFullscreenToggle?: boolean
}

export function PresentationView({ mode, isOwner, onExitFullscreen, onRun, onCancel, onNewRun, newRunLabel, inputsReadOnly, suppressOutputFallback, isRunning: externalIsRunning, showFullscreenToggle }: PresentationViewProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [isEditMode, setIsEditMode] = useState(false)
  const [pickerSection, setPickerSection] = useState<"inputs" | "outputs" | null>(null)
  const [isOpeningNewTab, setIsOpeningNewTab] = useState(false)
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)

  // Native fullscreen toggle (browser Fullscreen API)
  const toggleNativeFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsNativeFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  // Tab mode: read from the editor store
  const editorNodes = useWorkflowStore((s) => s.nodes)
  const editorEdges = useWorkflowStore((s) => s.edges)
  const editorName = useWorkflowStore((s) => s.workflowName)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const presentationSettings = useWorkflowStore((s) => s.presentationSettings)
  const updatePresentationSettings = useWorkflowStore((s) => s.updatePresentationSettings)

  // Fullscreen mode: read from presentation store
  const presNodes = usePresentationStore((s) => s.nodes)
  const presEdges = usePresentationStore((s) => s.edges)
  const presName = usePresentationStore((s) => s.workflowName)
  const presStatus = usePresentationStore((s) => s.executionStatus)
  const presNodeStates = usePresentationStore((s) => s.nodeStates)
  const presRun = usePresentationStore((s) => s.run)
  const presInputValues = usePresentationStore((s) => s.inputValues)
  const presUpdateInput = usePresentationStore((s) => s.updateInputValue)
  const presEstimatedCost = usePresentationStore((s) => s.estimatedCost)
  const presPresentationSettings = usePresentationStore((s) => s.presentationSettings)

  // Allow fullscreen mode to update run target locally (e.g. sub-workflow selector in app runner)
  const updatePresPresentationSettings = useCallback(
    (patch: Partial<PresentationSettings>) => {
      usePresentationStore.setState((prev) => ({
        presentationSettings: { ...prev.presentationSettings, ...patch },
      }))
    },
    [],
  )

  const isFullscreen = mode === "fullscreen"
  const nodes = isFullscreen ? presNodes : editorNodes
  const edges = isFullscreen ? presEdges : editorEdges
  const workflowName = isFullscreen ? presName : editorName
  const settings = isFullscreen ? presPresentationSettings : presentationSettings

  // View mode — synced with URL ?view= param, constrained by allowed modes for shared viewers
  const [searchParams, setSearchParams] = useSearchParams()
  const urlViewMode = searchParams.get("view") as PresentationViewMode | null

  // Shared viewers get constrained to allowed modes; owner/tab mode gets all modes
  const allowedModes = isFullscreen ? (settings.shareAllowedModes ?? ALL_VIEW_MODES) : ALL_VIEW_MODES
  const allowedSet = new Set(allowedModes)
  const effectiveDefault = (settings.shareDefaultMode && allowedSet.has(settings.shareDefaultMode))
    ? settings.shareDefaultMode : (isFullscreen ? (allowedModes[0] ?? "horizontal") : (settings.viewMode ?? "horizontal"))
  const viewMode: PresentationViewMode = (urlViewMode && VALID_VIEW_MODES.has(urlViewMode) && allowedSet.has(urlViewMode)
    ? urlViewMode : null) ?? effectiveDefault
  const canEdit = viewMode === "horizontal" || viewMode === "vertical"
  const isEditing = isEditMode && mode === "tab" && canEdit

  // Read-only enforcement for shared viewers (not app runner — app runner provides onNewRun)
  const isAppRunner = isFullscreen && !!onNewRun
  const isShareReadOnly = isFullscreen && !!settings.shareReadOnly && !isAppRunner

  const handleViewModeChange = useCallback((newMode: PresentationViewMode) => {
    // Update URL param
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (newMode === "horizontal") {
        next.delete("view")
      } else {
        next.set("view", newMode)
      }
      return next
    }, { replace: true })
    // Persist in settings
    if (!isFullscreen) {
      updatePresentationSettings({ viewMode: newMode })
    }
    // Exit edit mode when switching to non-editable view
    if (newMode !== "horizontal" && newMode !== "vertical") {
      setIsEditMode(false)
    }
  }, [isFullscreen, updatePresentationSettings, setSearchParams])

  const handleExitFullscreenView = useCallback(
    () => handleViewModeChange("horizontal"),
    [handleViewModeChange],
  )

  // Curated nodes, ordered by saved order
  const inputNodes = useMemo(() => getInputNodes(nodes, true), [nodes])
  const outputNodes = useMemo(() => getOutputNodes(nodes, edges, true), [nodes, edges])
  const orderedInputNodes = useMemo(() => orderNodesByIds(inputNodes, settings.inputOrder), [inputNodes, settings.inputOrder])
  const orderedOutputNodes = useMemo(() => orderNodesByIds(outputNodes, settings.outputOrder), [outputNodes, settings.outputOrder])

  // Estimate credit cost
  const tabEstimatedCost = useMemo(() => {
    if (isFullscreen) return 0
    let total = 0
    for (const node of nodes) {
      if (node.type && EXECUTABLE_TYPES.has(node.type)) {
        total += NODE_CREDIT_COSTS[node.type] ?? 0
      }
    }
    return total
  }, [isFullscreen, nodes])

  const estimatedCost = isFullscreen ? presEstimatedCost : tabEstimatedCost

  // Running state
  const isEditorRunning = useWorkflowStore((s) => {
    if (isFullscreen || externalIsRunning !== undefined) return false
    return s.nodes.some((n) => {
      const data = n.data as Record<string, unknown>
      return data.executionStatus === "running" || data.executionStatus === "loading"
    })
  })
  const isRunning = isFullscreen ? presStatus === "running" : (externalIsRunning ?? isEditorRunning)
  const isTerminal = isFullscreen && (presStatus === "completed" || presStatus === "failed")

  // Check if all required inputs are filled (fullscreen app/embed mode only)
  const allInputsFilled = useMemo(() => {
    if (!isFullscreen) return true
    for (const node of orderedInputNodes) {
      const data = node.data as Record<string, unknown>
      const nodeType = node.type ?? ""
      // Check presInputValues first, then fall back to snapshot data
      const inputVals = presInputValues[node.id] as Record<string, unknown> | undefined
      if (nodeType === "text-prompt") {
        const text = (inputVals?.text as string) ?? (data.text as string) ?? ""
        if (!text.trim()) return false
      } else if (nodeType === "upload-image" || nodeType === "upload-video" || nodeType === "upload-audio") {
        const url = (inputVals?.url as string) ?? (data.url as string) ?? ""
        if (!url) return false
      }
      // Parameter nodes always have defaults, so skip validation
    }
    return true
  }, [isFullscreen, orderedInputNodes, presInputValues])

  const handleRunClick = useCallback(() => {
    if (isFullscreen) {
      if (!user) {
        const isInIframe = window.parent !== window
        if (isInIframe) {
          // Google OAuth blocks loading inside iframes — open login in a popup.
          // Poll for popup close, then refresh auth state.
          const w = 500, h = 650
          const left = window.screenX + (window.outerWidth - w) / 2
          const top = window.screenY + (window.outerHeight - h) / 2
          const popup = window.open(
            `${window.location.origin}/login`,
            "nodaro-login",
            `width=${w},height=${h},left=${left},top=${top},popup=1`,
          )
          if (popup) {
            // Listen for session tokens from popup via postMessage.
            // This is necessary because cross-origin iframes have partitioned
            // localStorage — the popup's session is invisible to us.
            const handleAuthMessage = (event: MessageEvent) => {
              if (event.origin !== window.location.origin) return
              if (event.data?.type === "nodaro:authComplete" && event.data.access_token) {
                window.removeEventListener("message", handleAuthMessage)
                clearInterval(interval)
                setAuthFromTokens(event.data.access_token, event.data.refresh_token)
              }
            }
            window.addEventListener("message", handleAuthMessage)

            const interval = setInterval(() => {
              if (popup.closed) {
                clearInterval(interval)
                window.removeEventListener("message", handleAuthMessage)
                // Fallback: try refreshAuth in case message was missed
                refreshAuth()
              }
            }, 500)
          }
          return
        }
        // Save current URL so user returns here after login (consumed by auth-callback)
        localStorage.setItem(AUTH_REDIRECT_KEY, window.location.pathname + window.location.search)
        navigate("/login")
        return
      }
      presRun()
    } else if (onRun) onRun()
  }, [isFullscreen, user, presRun, onRun, navigate])

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      updateNodeData(nodeId, { presentationVisible: false })
    },
    [updateNodeData],
  )

  // O(1) node lookup map for tab mode
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // Node execution status
  const getNodeStatus = useCallback(
    (nodeId: string): "idle" | "running" | "completed" | "failed" => {
      if (isFullscreen) {
        const state = presNodeStates[nodeId]
        if (!state) return "idle"
        if (state.status === "running") return "running"
        if (state.status === "completed") return "completed"
        if (state.status === "failed") return "failed"
        return "idle"
      }
      const node = nodeMap.get(nodeId)
      if (!node) return "idle"
      const data = node.data as Record<string, unknown>
      const status = data.executionStatus as string | undefined
      if (status === "running" || status === "loading") return "running"
      if (status === "complete" || status === "completed") return "completed"
      if (status === "error") return "failed"
      return "idle"
    },
    [isFullscreen, presNodeStates, nodeMap],
  )

  const getFullscreenResult = useCallback(
    (nodeId: string) => {
      // Check execution state first (from a recent run)
      const state = presNodeStates[nodeId]
      if (state?.output) {
        const output = state.output as Record<string, unknown>
        const url = (output.imageUrl ?? output.videoUrl ?? output.audioUrl) as string | undefined
        const text = output.text as string | undefined
        if (url || text) return { url, text }
      }
      // Check input values (upload nodes in fullscreen store URLs here)
      const inputUrl = presInputValues[nodeId]?.url as string | undefined
      if (inputUrl) return { url: inputUrl, text: undefined }
      // When outputs are explicitly cleared (e.g. Create New), don't fall back to snapshot
      if (suppressOutputFallback) return { url: undefined, text: undefined }
      // Fall back to node data (results already saved in workflow)
      const node = nodeMap.get(nodeId)
      if (!node) return { url: undefined, text: undefined }
      return getNodeResultWithInputFallback(node)
    },
    [presNodeStates, presInputValues, nodeMap, suppressOutputFallback],
  )

  const getResult = useCallback(
    (nodeId: string) => {
      if (isFullscreen) return getFullscreenResult(nodeId)
      const node = nodeMap.get(nodeId)
      if (!node) return { url: undefined, text: undefined }
      return getNodeResultWithInputFallback(node)
    },
    [isFullscreen, getFullscreenResult, nodeMap],
  )

  // Resizable split — with cleanup on unmount
  const splitRatio = settings.splitRatio ?? 50
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingDivider = useRef(false)
  const dividerCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { dividerCleanupRef.current?.() }
  }, [])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingDivider.current = true

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = Math.round(((ev.clientX - rect.left) / rect.width) * 100)
      const clamped = Math.max(20, Math.min(80, ratio))
      updatePresentationSettings({ splitRatio: clamped })
    }

    const handleMouseUp = () => {
      isDraggingDivider.current = false
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      dividerCleanupRef.current = null
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    dividerCleanupRef.current = handleMouseUp
  }, [updatePresentationSettings])

  // Drag-to-reorder
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_ACTIVATION),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const makeDragEndHandler = useCallback(
    (orderedNodes: WorkflowNode[], settingsKey: "inputOrder" | "outputOrder") =>
      (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const ids = orderedNodes.map((n) => n.id)
        const oldIndex = ids.indexOf(active.id as string)
        const newIndex = ids.indexOf(over.id as string)
        if (oldIndex === -1 || newIndex === -1) return
        updatePresentationSettings({ [settingsKey]: arrayMove(ids, oldIndex, newIndex) })
      },
    [updatePresentationSettings],
  )

  const handleInputDragEnd = useMemo(
    () => makeDragEndHandler(orderedInputNodes, "inputOrder"),
    [makeDragEndHandler, orderedInputNodes],
  )
  const handleOutputDragEnd = useMemo(
    () => makeDragEndHandler(orderedOutputNodes, "outputOrder"),
    [makeDragEndHandler, orderedOutputNodes],
  )

  // Compare selection persistence
  const handleCompareSelectionChange = useCallback((left: string, right: string) => {
    if (!isFullscreen) {
      updatePresentationSettings({ compareLeft: left, compareRight: right })
    }
  }, [isFullscreen, updatePresentationSettings])

  // Shared media lightbox — navigable across all media items
  const [lightboxNodeId, setLightboxNodeId] = useState<string | null>(null)

  const mediaItems = useMemo(() => {
    const items: { nodeId: string; type: "image" | "video"; url: string }[] = []
    for (const node of [...orderedInputNodes, ...orderedOutputNodes]) {
      const outputType = getOutputType(node.type)
      if (outputType !== "image" && outputType !== "video") continue
      const result = getResult(node.id)
      if (!result.url) continue
      items.push({ nodeId: node.id, type: outputType, url: result.url })
    }
    return items
  }, [orderedInputNodes, orderedOutputNodes, getResult])

  const lightboxIndex = lightboxNodeId ? mediaItems.findIndex((m) => m.nodeId === lightboxNodeId) : -1
  const lightboxItem = lightboxIndex >= 0 ? mediaItems[lightboxIndex] : null

  // setLightboxNodeId is stable (React guarantee), no useCallback needed
  const handleOpenMedia = setLightboxNodeId

  const handleLightboxPrev = useCallback(() => {
    if (lightboxIndex > 0) setLightboxNodeId(mediaItems[lightboxIndex - 1].nodeId)
  }, [lightboxIndex, mediaItems])

  const handleLightboxNext = useCallback(() => {
    if (lightboxIndex < mediaItems.length - 1) setLightboxNodeId(mediaItems[lightboxIndex + 1].nodeId)
  }, [lightboxIndex, mediaItems])

  // Card meta helpers
  const getCardTitle = useCallback((node: WorkflowNode) => {
    return settings.cardMeta?.[node.id]?.title || getNodeLabel(node)
  }, [settings.cardMeta])

  const updateCardMeta = useCallback((nodeId: string, field: "title" | "description", value: string) => {
    const current = settings.cardMeta ?? {}
    updatePresentationSettings({
      cardMeta: {
        ...current,
        [nodeId]: { ...current[nodeId], [field]: value },
      },
    })
  }, [settings.cardMeta, updatePresentationSettings])

  // Render helpers for input/output cards
  const renderInputCard = useCallback((node: WorkflowNode) => (
    <InputCard
      node={node}
      isFullscreen={isFullscreen}
      inputValues={presInputValues}
      onUpdateInput={presUpdateInput}
      readOnly={inputsReadOnly ?? (isShareReadOnly || isRunning || isTerminal)}
      onOpenMedia={handleOpenMedia}
    />
  ), [isFullscreen, presInputValues, presUpdateInput, inputsReadOnly, isShareReadOnly, isRunning, isTerminal, handleOpenMedia])

  const renderOutputCard = useCallback((node: WorkflowNode) => {
    const outputType = getOutputType(node.type)
    const status = getNodeStatus(node.id)
    const result = getResult(node.id)
    return (
      <OutputCard
        nodeId={node.id}
        label={getCardTitle(node)}
        outputType={outputType}
        status={status}
        url={result.url}
        text={result.text}
        onOpenMedia={handleOpenMedia}
      />
    )
  }, [getNodeStatus, getResult, getCardTitle, handleOpenMedia])

  const costLabel = hasCredits() && estimatedCost > 0 ? ` (${estimatedCost} CR)` : ""

  // Stable reference for ShareDialog nodes prop
  const allPresentationNodes = useMemo(
    () => [...orderedInputNodes, ...orderedOutputNodes],
    [orderedInputNodes, orderedOutputNodes],
  )

  // Shared props for all views
  const viewProps = {
    orderedInputNodes,
    orderedOutputNodes,
    getNodeStatus,
    getResult,
    getCardTitle,
    onOpenMedia: handleOpenMedia,
  }

  const editableProps = {
    ...viewProps,
    isEditing,
    sensors,
    handleInputDragEnd,
    handleOutputDragEnd,
    handleRemoveNode,
    settings,
    updateCardMeta,
    setPickerSection: setPickerSection as (section: "inputs" | "outputs") => void,
    renderInputCard,
    renderOutputCard,
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between px-3 md:px-6 border-b border-border bg-card shrink-0" style={{ paddingTop: 'max(0.5rem, var(--safe-area-top))' }}>
        {/* Top row: title + right-side controls */}
        <div className="flex items-center justify-between h-11 md:h-14 w-full md:w-auto min-w-0">
          <h1 className="text-base md:text-lg font-semibold truncate text-foreground">
            {workflowName || "Untitled"}
          </h1>
          {/* Mobile-only: compact right-side controls */}
          <div className="flex items-center gap-1.5 md:hidden shrink-0">
            {isFullscreen && <ThemeToggle />}
            {user && hasCredits() && <CreditBalance userId={user.id} />}
            {(mode === "tab" || (isFullscreen && !isShareReadOnly)) && (
              <RunTargetSelector
                nodes={nodes}
                presentationSettings={settings}
                onUpdate={isFullscreen ? updatePresPresentationSettings : updatePresentationSettings}
              />
            )}
            {isFullscreen && allowedModes.length > 1 && (
              <ViewModeSelector viewMode={viewMode} onChange={handleViewModeChange} allowedModes={allowedModes} />
            )}
          </div>
        </div>

        {/* App runner: action buttons — stacked below title on mobile, centered on desktop */}
        {isAppRunner && (
          <div className="flex items-center gap-2 pb-2 md:pb-0 md:absolute md:left-1/2 md:-translate-x-1/2">
            <button
              type="button"
              onClick={onNewRun}
              className="h-9 md:h-8 px-3 md:px-4 rounded-full text-sm font-medium text-foreground bg-muted hover:bg-muted/80 border border-border flex items-center gap-2 transition-all duration-200 touch-manipulation"
            >
              <RotateCcw className="h-4 w-4" />
              {newRunLabel ?? "Create New"}
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-9 md:h-8 px-3 md:px-4 rounded-full text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 transition-all duration-200 touch-manipulation"
                disabled={!onCancel}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Stop
              </button>
            ) : (
              inputsReadOnly !== true && (
                <button
                  type="button"
                  onClick={handleRunClick}
                  className="h-9 md:h-8 px-3 md:px-4 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                  disabled={!!user && !allInputsFilled}
                >
                  {!user ? (
                    <><LogIn className="h-4 w-4" />Sign in to Run</>
                  ) : (
                    <><Play className="h-4 w-4" />Run{costLabel}</>
                  )}
                </button>
              )
            )}
          </div>
        )}

        {/* Desktop-only right-side controls */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {showFullscreenToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleNativeFullscreen}
              title={isNativeFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="text-muted-foreground hover:text-foreground"
            >
              {isNativeFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          {isFullscreen && <ThemeToggle />}
          {user && hasCredits() && <CreditBalance userId={user.id} />}

          {/* Edit/View toggle — only for editable view modes */}
          {isOwner && mode === "tab" && canEdit && (
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              onClick={() => setIsEditMode(!isEditMode)}
              className={isEditMode ? "" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}
              title={isEditMode ? "Switch to view mode" : "Edit presentation"}
            >
              {isEditMode ? (
                <><Eye className="h-4 w-4 mr-1" />View</>
              ) : (
                <><Pencil className="h-4 w-4 mr-1" />Edit</>
              )}
            </Button>
          )}

          {(mode === "tab" || (isFullscreen && !isShareReadOnly)) && (
            <RunTargetSelector
              nodes={nodes}
              presentationSettings={settings}
              onUpdate={isFullscreen ? updatePresPresentationSettings : updatePresentationSettings}
            />
          )}

          {/* View mode selector — owner sees all, shared viewers see allowed subset */}
          {isOwner && mode === "tab" && (
            <ViewModeSelector viewMode={viewMode} onChange={handleViewModeChange} />
          )}
          {isFullscreen && allowedModes.length > 1 && (
            <ViewModeSelector viewMode={viewMode} onChange={handleViewModeChange} allowedModes={allowedModes} />
          )}

          {isOwner && mode === "tab" && workflowId && (
            <>
              <ShareDialog
                workflowId={workflowId}
                presentationSettings={settings}
                updatePresentationSettings={updatePresentationSettings}
                nodes={allPresentationNodes}
              />
              <PublishDialog
                workflowId={workflowId}
                presentationSettings={settings}
                updatePresentationSettings={updatePresentationSettings}
                nodes={allPresentationNodes}
              />
            </>
          )}

          {mode === "tab" && workflowId && (
            <Button
              variant="outline"
              size="sm"
              disabled={isOpeningNewTab}
              onClick={async () => {
                if (isOpeningNewTab) return
                setIsOpeningNewTab(true)
                try {
                  const { shareToken } = await shareWorkflow(workflowId)
                  window.open(`/present/${shareToken}`, "_blank")
                } catch {
                  toast.error("Failed to open in new tab")
                } finally {
                  setIsOpeningNewTab(false)
                }
              }}
              title="Open in new tab"
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}

          {/* Run / Stop button — tab/share mode only (app runner uses centered buttons above) */}
          {!isAppRunner && !isShareReadOnly && (
            isRunning ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-8 px-4 rounded-full text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 transition-all duration-200"
                disabled={!onCancel}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRunClick}
                className="h-8 px-4 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={(!isFullscreen && mode === "tab" && !onRun) || (isFullscreen && !allInputsFilled && !!user)}
              >
                {isFullscreen && !user ? (
                  <><LogIn className="h-4 w-4" />Sign in to Run</>
                ) : (
                  <><Play className="h-4 w-4" />Run{costLabel}</>
                )}
              </button>
            )
          )}
        </div>
      </div>

      {/* Content: view-specific layout */}
      {viewMode === "horizontal" && (
        <HorizontalView
          {...editableProps}
          splitRatio={splitRatio}
          containerRef={containerRef}
          handleDividerMouseDown={handleDividerMouseDown}
        />
      )}
      {viewMode === "vertical" && <VerticalView {...editableProps} />}
      {viewMode === "gallery" && <GalleryView {...viewProps} />}
      {viewMode === "fullscreen" && (
        <FullscreenView {...viewProps} onBack={handleExitFullscreenView} />
      )}
      {viewMode === "compare" && (
        <CompareView
          {...viewProps}
          initialLeft={settings.compareLeft}
          initialRight={settings.compareRight}
          onSelectionChange={handleCompareSelectionChange}
        />
      )}

      {/* Node picker dialog */}
      {pickerSection && (
        <NodePickerDialog
          open
          onOpenChange={(open) => { if (!open) setPickerSection(null) }}
          section={pickerSection}
        />
      )}

      {/* Shared media lightbox with prev/next navigation */}
      {lightboxItem && (
        <MediaPreviewModal
          isOpen
          onClose={() => setLightboxNodeId(null)}
          type={lightboxItem.type}
          url={lightboxItem.url}
          currentIndex={lightboxIndex}
          totalCount={mediaItems.length}
          onPrev={lightboxIndex > 0 ? handleLightboxPrev : undefined}
          onNext={lightboxIndex < mediaItems.length - 1 ? handleLightboxNext : undefined}
        />
      )}
    </div>
  )
}

/** Renders the appropriate input card based on node type */
function InputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  onOpenMedia,
}: {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  onOpenMedia?: (nodeId: string) => void
}) {
  const label = getNodeLabel(node)
  const data = node.data as Record<string, unknown>

  switch (node.type) {
    case "text-prompt":
      return (
        <TextInputCard
          label={label}
          value={isFullscreen ? (inputValues[node.id]?.text as string ?? data.text as string ?? "") : (data.text as string ?? "")}
          placeholder={(data.placeholder as string) ?? "Enter text..."}
          onChange={(val) => {
            if (isFullscreen) {
              onUpdateInput(node.id, "text", val)
            } else {
              useWorkflowStore.getState().updateNodeData(node.id, { text: val })
            }
          }}
          readOnly={readOnly}
        />
      )

    case "upload-image":
      return (
        <ImageUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
          onOpenMedia={onOpenMedia}
        />
      )

    case "upload-video":
      return (
        <VideoUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )

    case "upload-audio":
      return (
        <AudioUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )

    default:
      return (
        <ParameterCard
          nodeId={node.id}
          label={label}
          nodeType={node.type!}
          data={data}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
          readOnly={readOnly}
        />
      )
  }
}

/** Renders the appropriate output card based on output type */
function OutputCard({
  nodeId,
  label,
  outputType,
  status,
  url,
  text,
  onOpenMedia,
}: {
  nodeId: string
  label: string
  outputType: string
  status: "idle" | "running" | "completed" | "failed"
  url?: string
  text?: string
  onOpenMedia?: (nodeId: string) => void
}) {
  switch (outputType) {
    case "image":
      return <ImageOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} />
    case "video":
      return <VideoOutputCard label={label} status={status} url={url} nodeId={nodeId} onOpenMedia={onOpenMedia} />
    case "audio":
      return <AudioOutputCard label={label} status={status} url={url} />
    case "text":
      return <TextOutputCard label={label} status={status} text={text} />
    default:
      return <TextOutputCard label={label} status={status} text={text ?? url} />
  }
}
