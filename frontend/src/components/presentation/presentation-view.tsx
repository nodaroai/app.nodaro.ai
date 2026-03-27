/**
 * PresentationView — clean theme-aware presentation mode.
 * Orchestrator that delegates to view-specific components.
 *
 * Works in both "tab" mode (inside editor) and "fullscreen" mode (shared link).
 */

import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Play, Loader2, ExternalLink, Pencil, Eye, LogIn, LogOut, RotateCcw, Plus, Maximize2, Minimize2, Sparkles, LayoutGrid, Copy } from "lucide-react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { GetCreditsModal } from "@/components/credits/GetCreditsModal"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { hasCredits } from "@/lib/edition"
import { useAuth, refreshAuth, setAuthFromTokens } from "@/hooks/use-auth"
import { useWorkflowStore, type PresentationViewMode, type PresentationSettings } from "@/hooks/use-workflow-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import type { WorkflowNode, PresentationDisplay } from "@/types/nodes"
import {
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeResult,
} from "@/lib/presentation-utils"
import { EXECUTABLE_TYPES, estimateNodeCredits, isExecutableNode, getFanOutMultiplier } from "@/components/editor/workflow-editor/types"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { getCachedCredits, prefetchModelCredits } from "@/hooks/use-model-credits"
import { isExpandedClone } from "@nodaro-shared/clone-utils"
import { calculateMonetizedCost } from "@nodaro-shared/monetization"
import { shareWorkflow } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"
import { toast } from "sonner"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { ShareDialog } from "./share-dialog"
import { PublishDialog } from "./publish-dialog"
import { PublishTemplateDialog } from "@/components/templates/publish-template-dialog"
import { NodePickerDialog } from "./node-picker-dialog"
import { NodeConfigModal, CONFIG_INPUT_TYPES } from "./node-config-modal"
import { PlatformPreview, PLATFORM_COLORS } from "@/components/nodes/platform-preview"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"
import { isVideoUrl } from "@/lib/media-type"
import { responsiveColumns } from "@/lib/presentation-display"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { StatusBadge } from "./output-cards/shared"
import type { OutputCardActions } from "./output-cards/shared"
import { HiddenNodesPill } from "./hidden-nodes-pill"
import { getCardTitle as getCardTitleHelper, orderNodesByIds, getNodeResultWithInputFallback, getLoopFirstMedia, areAllInputsFilled, resolveInputItems, resolveOutputItems } from "./helpers"
import { buildNodeRefMap } from "@/lib/node-refs"
import { RunTargetSelector } from "./run-target-selector"
import { ViewModeSelector, ALL_VIEW_MODES } from "./view-mode-selector"
import { InputCard } from "./input-card"
import { OutputCard, type FieldBadgeEntry } from "./output-card"
import { ConfigFieldRenderer } from "./config-field-renderer"
import { RichtextBlock } from "./richtext-block"
import { RichtextEditor } from "./richtext-editor"
import { GroupCard } from "./group-card"
import type { PresentationItem, ExposableField } from "@nodaro-shared/presentation-types"
import { getItemSortId } from "@nodaro-shared/presentation-utils"
import { NODE_DEF_MAP } from "@/types/nodes"
import {
  HorizontalView,
  VerticalView,
  GalleryView,
  FullscreenView,
  CompareView,
} from "./views"

const FreeCutEditorModal = lazy(() =>
  import("../editor/freecut-editor-modal").then((m) => ({ default: m.FreeCutEditorModal })),
)
const FilerobotEditorModal = lazy(() =>
  import("../editor/filerobot-editor-modal").then((m) => ({ default: m.FilerobotEditorModal })),
)
const AudiomassEditorModal = lazy(() =>
  import("../editor/audiomass-editor-modal").then((m) => ({ default: m.AudiomassEditorModal })),
)

const POINTER_ACTIVATION = { activationConstraint: { distance: 5 } } as const
const VALID_VIEW_MODES = new Set<PresentationViewMode>(ALL_VIEW_MODES)
const EDITOR_META: Record<string, { filename: string; mime: string; outputKey: string }> = {
  video: { filename: "edited-video.mp4", mime: "video/mp4", outputKey: "videoUrl" },
  image: { filename: "edited-image.png", mime: "image/png", outputKey: "imageUrl" },
  audio: { filename: "edited-audio.mp3", mime: "audio/mpeg", outputKey: "audioUrl" },
}

/** Recursively update a richtext item's content by id */
function updateItemContent(items: PresentationItem[], id: string, content: string): PresentationItem[] {
  return items.map((item) => {
    if (item.type === "richtext" && item.id === id) return { ...item, content }
    if (item.type === "group") return { ...item, items: updateItemContent(item.items, id, content) }
    return item
  })
}

/** Recursively update a group's title by id */
function updateGroupTitle(items: PresentationItem[], id: string, title: string): PresentationItem[] {
  return items.map((item) => {
    if (item.type === "group" && item.id === id) return { ...item, title }
    return item
  })
}

/** Recursively update a group field by id */
function updateGroupField(items: PresentationItem[], id: string, field: string, value: unknown): PresentationItem[] {
  return items.map((item) => {
    if (item.type === "group" && item.id === id) return { ...item, [field]: value }
    return item
  })
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
  /** Optional element rendered left of the title (e.g. Runs button) */
  headerLeft?: React.ReactNode
  /** Called when hidden nodes change (for external persistence -- e.g., app runner) */
  onHiddenNodesChange?: (nodeIds: string[]) => void
  /** Called when node states change due to media edits (for external persistence -- e.g., app runner) */
  onNodeStatesChange?: (nodeStates: Record<string, unknown>) => void
}

export function PresentationView({ mode, isOwner, onExitFullscreen, onRun, onCancel, onNewRun, newRunLabel, inputsReadOnly, suppressOutputFallback, isRunning: externalIsRunning, showFullscreenToggle, headerLeft, onHiddenNodesChange, onNodeStatesChange }: PresentationViewProps) {
  const { user, signOut: globalSignOut } = useAuth()
  const navigate = useNavigate()
  const [isEditMode, setIsEditMode] = useState(false)
  const [pickerSection, setPickerSection] = useState<"inputs" | "outputs" | null>(null)
  const [isOpeningNewTab, setIsOpeningNewTab] = useState(false)
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)
  const [showGetCreditsModal, setShowGetCreditsModal] = useState(false)
  const [isRemixing, setIsRemixing] = useState(false)
  const [showPublishTemplate, setShowPublishTemplate] = useState(false)
  const [configNode, setConfigNode] = useState<WorkflowNode | null>(null)
  const isMobile = useIsMobile()

  // Hidden nodes -- seeded from settings
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set())
  const [isRevealingHidden, setIsRevealingHidden] = useState(false)

  // Editor state (fullscreen mode only -- tab mode delegates to workflow store)
  const [editState, setEditState] = useState<{
    nodeId: string
    type: "image" | "video" | "audio"
    url: string
  } | null>(null)

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

  // Seed hidden nodes from settings once available
  const seededHiddenRef = useRef<readonly string[] | undefined>(undefined)
  useEffect(() => {
    const saved = settings.hiddenNodes
    if (saved === seededHiddenRef.current) return
    seededHiddenRef.current = saved
    setHiddenNodeIds(new Set(saved ?? []))
  }, [settings.hiddenNodes])

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

  // App runner / shared pages: sign out without navigating away
  const signOut = useCallback(async () => {
    if (isAppRunner || isFullscreen) {
      const supabase = createClient()
      await supabase.auth.signOut()
    } else {
      globalSignOut()
    }
  }, [isAppRunner, isFullscreen, globalSignOut])

  // Credit check for app runner "Get Credits" button (hooks must be unconditional)
  const appRunnerInsufficientCredits = useAppRunnerStore((s) => s.insufficientCredits)
  const appSupportsRemix = useAppRunnerStore((s) => s.app?.supportsRemix ?? false)
  const combinedProgress = useAppRunnerStore((s) => s.combinedProgress)
  const monetizationEnabled = useAppRunnerStore((s) => s.app?.monetizationEnabled ?? false)
  const monetizationFlatFee = useAppRunnerStore((s) => s.app?.monetizationFlatFee ?? 0)
  const monetizationPercent = useAppRunnerStore((s) => s.app?.monetizationPercent ?? 0)
  const { data: userCredits } = useUserCredits(user?.id)

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

  // Filter hidden output nodes (reveal toggle shows them temporarily)
  const visibleOutputNodes = useMemo(
    () => isRevealingHidden
      ? orderedOutputNodes
      : orderedOutputNodes.filter((n) => !hiddenNodeIds.has(n.id)),
    [orderedOutputNodes, hiddenNodeIds, isRevealingHidden],
  )

  // Rich items-based ordering (groups, fields, richtext alongside nodes)
  const inputItems = useMemo(() => resolveInputItems(settings), [settings.inputItems, settings.inputOrder])
  const outputItems = useMemo(() => resolveOutputItems(settings), [settings.outputItems, settings.outputOrder])

  // Estimate credit cost — mirrors workflow-editor-main.tsx logic:
  // uses composite model identifiers, dynamic DB costs, and fan-out multipliers.
  // In fullscreen/app mode, inputValues contains live loop rows that affect fan-out,
  // so we merge them into node data for accurate cost calculation.
  const inputValues = isFullscreen ? presInputValues : undefined
  const [dynamicEstimatedCost, setDynamicEstimatedCost] = useState(0)
  useEffect(() => {
    if (!hasCredits()) return
    // Merge inputValues into node data so getFanOutMultiplier sees current loop rows
    const effectiveNodes = inputValues
      ? nodes.map((n) => {
          const vals = inputValues[n.id]
          return vals ? { ...n, data: { ...n.data, ...vals } } : n
        })
      : nodes
    const executableNodes = effectiveNodes.filter((n) => isExecutableNode(n) && !isExpandedClone(n))

    const computeEstimate = () => {
      const total = executableNodes.reduce((sum, node) => {
        const modelId = getModelIdentifier(node)
        const cached = getCachedCredits(modelId)
        const cost = cached !== undefined ? cached : estimateNodeCredits({ type: node.type, data: node.data as Record<string, unknown> })
        const multiplier = getFanOutMultiplier(node, effectiveNodes, edges)
        return sum + cost * multiplier
      }, 0)
      setDynamicEstimatedCost(total)
      // Also update the presentation store so other consumers see the live cost
      if (isFullscreen) {
        usePresentationStore.setState({ estimatedCost: total })
      }
    }

    const modelIds = [...new Set(executableNodes.map((n) => getModelIdentifier(n)).filter(Boolean))]
    const uncached = modelIds.filter((m) => getCachedCredits(m) === undefined)

    if (uncached.length > 0) {
      let cancelled = false
      prefetchModelCredits(uncached).then(() => {
        if (!cancelled) computeEstimate()
      })
      return () => { cancelled = true }
    }

    computeEstimate()
  }, [nodes, edges, inputValues])

  const rawEstimatedCost = dynamicEstimatedCost || (isFullscreen ? presEstimatedCost : 0)
  const estimatedCost = useMemo(() => {
    if (!rawEstimatedCost || !isAppRunner || !monetizationEnabled) return rawEstimatedCost
    return calculateMonetizedCost(rawEstimatedCost, monetizationFlatFee ?? 0, monetizationPercent ?? 0)
  }, [rawEstimatedCost, isAppRunner, monetizationEnabled, monetizationFlatFee, monetizationPercent])

  // Pre-check: does the user need more credits to run this app?
  const needsMoreCredits = useMemo(() => {
    if (!user || !isAppRunner || !hasCredits() || !userCredits || estimatedCost <= 0) return false
    return userCredits.total < estimatedCost
  }, [user, isAppRunner, userCredits, estimatedCost])

  // Auto-open modal when a 402 insufficient credits error occurs
  useEffect(() => {
    if (isAppRunner && appRunnerInsufficientCredits) {
      setShowGetCreditsModal(true)
    }
  }, [isAppRunner, appRunnerInsufficientCredits])

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
    return areAllInputsFilled(orderedInputNodes, presInputValues)
  }, [isFullscreen, orderedInputNodes, presInputValues])

  const underMinTables = useMemo(() => {
    if (!isFullscreen) return []
    return orderedInputNodes
      .filter((n) => {
        if (n.type !== "loop") return false
        const minRows = ((n.data as Record<string, unknown>).minRows as number) ?? 0
        if (minRows === 0) return false
        const inputVals = presInputValues[n.id] as Record<string, unknown> | undefined
        const rows = (inputVals?.rows as string[][] | undefined) ?? ((n.data as Record<string, unknown>).rows as string[][]) ?? []
        return rows.length < minRows
      })
      .map((n) => ({
        label: (n.data as Record<string, unknown>).label as string || "Table",
        minRows: ((n.data as Record<string, unknown>).minRows as number) ?? 0,
        currentRows: ((presInputValues[n.id] as Record<string, unknown>)?.rows as string[][] | undefined)?.length ?? 0,
      }))
  }, [isFullscreen, orderedInputNodes, presInputValues])

  const underMinWarning = useMemo(() => {
    if (underMinTables.length === 0) return ""
    const msgs = underMinTables.slice(0, 2).map((t) => `${t.label} needs ${t.minRows}+ row${t.minRows !== 1 ? "s" : ""}`)
    return msgs.join("; ") + (underMinTables.length > 2 ? ` +${underMinTables.length - 2} more` : "")
  }, [underMinTables])

  const handleRunClick = useCallback(() => {
    if (isFullscreen) {
      if (!user) {
        // Open login as popup so user stays on the app/share page.
        // Required for iframes (OAuth blocks inside iframes) and also
        // better UX for app runner pages (avoids redirect to /projects).
        const w = 500, h = 650
        const left = window.screenX + (window.outerWidth - w) / 2
        const top = window.screenY + (window.outerHeight - h) / 2
        const popup = window.open(
          `${window.location.origin}/login`,
          "nodaro-login",
          `width=${w},height=${h},left=${left},top=${top},popup=1`,
        )
        if (popup) {
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
              refreshAuth()
            }
          }, 500)
          return
        }
        // Fallback if popup blocked: redirect
        localStorage.setItem(AUTH_REDIRECT_KEY, window.location.pathname + window.location.search)
        navigate("/login")
        return
      }
      presRun()
    } else if (onRun) onRun()
  }, [isFullscreen, user, presRun, onRun, navigate])

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      updateNodeData(nodeId, { presentationVisible: false, presentationInput: false, presentationOutput: false })
    },
    [updateNodeData],
  )

  // Hide/unhide/reveal handlers for output cards
  const handleHideNode = useCallback((nodeId: string) => {
    if (hiddenNodeIds.has(nodeId)) return
    const next = new Set(hiddenNodeIds)
    next.add(nodeId)
    setHiddenNodeIds(next)
    const arr = [...next]
    if (!isFullscreen) updatePresentationSettings({ hiddenNodes: arr })
    onHiddenNodesChange?.(arr)
  }, [hiddenNodeIds, isFullscreen, onHiddenNodesChange, updatePresentationSettings])

  const handleUnhideNode = useCallback((nodeId: string) => {
    if (!hiddenNodeIds.has(nodeId)) return
    const next = new Set(hiddenNodeIds)
    next.delete(nodeId)
    setHiddenNodeIds(next)
    const arr = [...next]
    if (!isFullscreen) updatePresentationSettings({ hiddenNodes: arr })
    onHiddenNodesChange?.(arr)
    if (next.size === 0) setIsRevealingHidden(false)
  }, [hiddenNodeIds, isFullscreen, onHiddenNodesChange, updatePresentationSettings])

  const handleToggleReveal = useCallback(() => {
    setIsRevealingHidden((prev) => !prev)
  }, [])

  // Edit handler — fullscreen renders editors locally; tab mode delegates to workflow store
  const handleEditNode = useCallback((nodeId: string, type: "image" | "video" | "audio", url: string) => {
    if (isFullscreen) {
      setEditState({ nodeId, type, url })
    } else {
      if (type === "video") {
        useWorkflowStore.getState().openFreeCut(nodeId, url)
      } else if (type === "image") {
        useWorkflowStore.getState().openImageEdit(nodeId, url)
      } else if (type === "audio") {
        // Audio: open locally even in tab mode (no workflow store equivalent)
        setEditState({ nodeId, type, url })
      }
    }
  }, [isFullscreen])

  // Shared upload handler for all editor modals
  const handleEditorSave = useCallback(async (blob: Blob) => {
    if (!editState) return
    const meta = EDITOR_META[editState.type]
    const file = new File([blob], meta.filename, { type: meta.mime })
    const { uploadFile: doUpload } = await import("@/lib/api")
    const result = await doUpload(file)
    const outputUpdate = { [meta.outputKey]: result.url, url: result.url }
    usePresentationStore.getState().updateNodeOutput(editState.nodeId, outputUpdate)
    // Persist edited node state for app runner
    if (onNodeStatesChange) {
      const currentStates = usePresentationStore.getState().nodeStates
      const editedNode = currentStates[editState.nodeId]
      if (editedNode) {
        onNodeStatesChange({ [editState.nodeId]: editedNode })
      }
    }
    setEditState(null)
  }, [editState, onNodeStatesChange])

  /** Remove a specific item from an items list by sortId */
  const handleRemoveItem = useCallback(
    (sortId: string, section: "inputs" | "outputs") => {
      const key = section === "inputs" ? "inputItems" : "outputItems"
      // Use resolved items (handles legacy inputOrder/outputOrder migration)
      const resolved = section === "inputs" ? inputItems : outputItems
      const items: PresentationItem[] = resolved ?? settings[key] ?? []
      const item = items.find((i) => getItemSortId(i) === sortId)
      if (!item) return
      const filtered = items.filter((i) => getItemSortId(i) !== sortId)
      // Check if this was the last item referencing the node
      if (item.type === "node" || item.type === "field" || item.type === "output") {
        const nodeId = item.nodeId
        const hasOtherItems = filtered.some((i) => i.type !== "richtext" && i.type !== "group" && i.nodeId === nodeId)
        if (!hasOtherItems) {
          if (item.type === "node") {
            // Removing the whole node — clear the presentation flag
            const flag = section === "inputs" ? "presentationInput" : "presentationOutput"
            updateNodeData(nodeId, { [flag]: false })
          } else {
            // Removing the last field/output sub-item — re-add as a whole-node item
            // so the node stays visible (matches handleFieldToggle/handleOutputToggle behavior)
            const nodeData = nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined
            const flag = section === "inputs" ? "presentationInput" : "presentationOutput"
            if (nodeData?.[flag]) {
              filtered.push({ type: "node" as const, nodeId })
            }
          }
        }
      }
      updatePresentationSettings({ [key]: filtered })
    },
    [settings, inputItems, outputItems, nodes, updateNodeData, updatePresentationSettings],
  )

  // Remix: create a workflow from the app's snapshot and open in a new tab
  const handleRemix = useCallback(async () => {
    if (!user) {
      localStorage.setItem(AUTH_REDIRECT_KEY, window.location.pathname + window.location.search)
      navigate("/login")
      return
    }
    const appData = useAppRunnerStore.getState().app
    if (!appData) return

    setIsRemixing(true)
    try {
      const supabase = createClient()

      // Get or create a "Remixed Apps" project for this user
      const REMIX_PROJECT_NAME = "Remixed Apps"
      const { data: existing } = await supabase
        .from("projects")
        .select("id")
        .eq("user_id", user.id)
        .eq("name", REMIX_PROJECT_NAME)
        .limit(1)

      let projectId: string
      if (existing && existing.length > 0) {
        projectId = existing[0].id
      } else {
        const { data: newProject, error: projErr } = await supabase
          .from("projects")
          .insert({ user_id: user.id, name: REMIX_PROJECT_NAME })
          .select("id")
          .single()
        if (projErr || !newProject) throw new Error("Failed to create project")
        projectId = newProject.id
      }

      // Derive a thumbnail from the app's data
      let thumbnailUrl: string | null = appData.previewMediaUrl ?? null
      if (!thumbnailUrl) {
        const snapshotNodes = appData.snapshotNodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>
        // Prefer the designated thumbnail node
        const thumbNode = appData.thumbnailNodeId
          ? snapshotNodes.find((n) => n.id === appData.thumbnailNodeId)
          : null
        if (thumbNode?.data) {
          const result = getNodeResult(thumbNode.data)
          if (result.url) thumbnailUrl = result.url
        }
        // Fallback: first node with an image/video result
        if (!thumbnailUrl) {
          for (const n of snapshotNodes) {
            const otype = getOutputType(n.type)
            if ((otype === "image" || otype === "video") && n.data) {
              const result = getNodeResult(n.data)
              if (result.url) { thumbnailUrl = result.url; break }
            }
          }
        }
      }

      // Create workflow from app snapshot (JSON round-trip satisfies Supabase Json type)
      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .insert({
          project_id: projectId,
          user_id: user.id,
          name: `${appData.name} (Remix)`,
          nodes: JSON.parse(JSON.stringify(appData.snapshotNodes)),
          edges: JSON.parse(JSON.stringify(appData.snapshotEdges)),
          settings: JSON.parse(JSON.stringify(appData.snapshotSettings)),
          thumbnail_url: thumbnailUrl,
        })
        .select("id")
        .single()

      if (wfErr || !wf) throw new Error("Failed to create workflow")

      window.open(`/projects/${projectId}/workflows/${wf.id}`, "_blank")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remix app")
    } finally {
      setIsRemixing(false)
    }
  }, [user, navigate])

  // O(1) node lookup map for tab mode
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // Node execution status
  const getNodeStatus = useCallback(
    (nodeId: string): "idle" | "waiting" | "running" | "completed" | "failed" => {
      if (isFullscreen) {
        const state = presNodeStates[nodeId]
        if (!state) return "idle"
        if (state.status === "running") return "running"
        if (state.status === "completed") return "completed"
        if (state.status === "failed") return "failed"
        if (state.status === "pending") return "waiting"
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
        // Preview node: delegate to getNodeResult which handles previewItems
        if (output.previewItems) {
          const result = getNodeResult(output)
          if (result.url || result.text) return result
        }
        const url = (output.url ?? output.imageUrl ?? output.videoUrl ?? output.audioUrl ?? output.resultUrl) as string | undefined
        const text = output.text as string | undefined
        if (url || text) return { url, text }
      }
      // Check input values (upload nodes in fullscreen store URLs here)
      const inputUrl = presInputValues[nodeId]?.url as string | undefined
      if (inputUrl) return { url: inputUrl, text: undefined }
      // Loop/table node: user-edited rows are inputs (always shown), but snapshot rows respect suppressOutputFallback
      const node = nodeMap.get(nodeId)
      if (node?.type === "loop") {
        const loopRows = presInputValues[nodeId]?.rows as string[][] | undefined
        if (loopRows) return getLoopFirstMedia(node.data as Record<string, unknown>, loopRows)
        if (suppressOutputFallback) return { url: undefined, text: undefined }
        return getLoopFirstMedia(node.data as Record<string, unknown>)
      }
      // When outputs are explicitly cleared (e.g. Create New), don't fall back to snapshot
      if (suppressOutputFallback) return { url: undefined, text: undefined }
      // Fall back to node data (results already saved in workflow)
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
  const splitRatio = settings.splitRatio ?? 30
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
      const clamped = Math.max(25, Math.min(75, ratio))
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
    for (const node of [...orderedInputNodes, ...visibleOutputNodes]) {
      const outputType = getOutputType(node.type)
      if (outputType !== "image" && outputType !== "video") continue
      const result = getResult(node.id)
      if (!result.url) continue
      items.push({ nodeId: node.id, type: outputType, url: result.url })
    }
    return items
  }, [orderedInputNodes, visibleOutputNodes, getResult])

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
  const getCardTitle = useCallback(
    (node: WorkflowNode) => getCardTitleHelper(node, settings.cardMeta),
    [settings.cardMeta],
  )

  const updateCardMeta = useCallback((nodeId: string, field: string, value: unknown) => {
    const current = settings.cardMeta ?? {}
    const nodeMeta = current[nodeId] ?? {}
    updatePresentationSettings({
      cardMeta: { ...current, [nodeId]: { ...nodeMeta, [field]: value } },
    })
  }, [settings.cardMeta, updatePresentationSettings])

  const getNodeColumns = useCallback((nodeId: string) => {
    const node = nodeMap.get(nodeId)
    if (!node) return 1
    const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
    const cardDisplay = settings.cardMeta?.[nodeId]?.display
    const merged = { ...nodeDisplay, ...cardDisplay }
    return responsiveColumns(merged.columns ?? 1, isMobile)
  }, [nodeMap, settings.cardMeta, isMobile])

  // Memoize refMaps only for readOnly input nodes (only they need resolved values)
  const inputRefMaps = useMemo(() => {
    const maps = new Map<string, Map<string, string>>()
    for (const node of orderedInputNodes) {
      if ((node.data as Record<string, unknown>).presentationReadOnly) {
        maps.set(node.id, buildNodeRefMap(node.id, nodes, edges))
      }
    }
    return maps
  }, [orderedInputNodes, nodes, edges])

  // Render helpers for input/output cards
  const renderInputCard = useCallback((node: WorkflowNode) => {
    const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
    const meta = settings.cardMeta?.[node.id]
    const cardDisplay = meta?.display
    const display = { ...nodeDisplay, ...cardDisplay }
    return (
      <InputCard
        node={node}
        nodes={nodes}
        edges={edges}
        isFullscreen={isFullscreen}
        inputValues={presInputValues}
        onUpdateInput={presUpdateInput}
        readOnly={inputsReadOnly ?? (isShareReadOnly || isRunning || isTerminal)}
        onOpenMedia={handleOpenMedia}
        onOpenConfig={setConfigNode}
        refMap={inputRefMaps.get(node.id)}
        display={display}
        inputMode={meta?.inputMode}
        minLines={meta?.minLines}
      />
    )
  }, [nodes, edges, isFullscreen, presInputValues, presUpdateInput, inputsReadOnly, isShareReadOnly, isRunning, isTerminal, handleOpenMedia, inputRefMaps, settings.cardMeta])

  // Extract listResults for a node from either fullscreen nodeStates or tab-mode node data
  const getListResults = useCallback(
    (node: WorkflowNode): { listResults?: string[]; iterationTotal?: number; iterationCompleted?: number } => {
      if (isFullscreen) {
        const nodeState = presNodeStates[node.id]
        if (nodeState?.output) {
          const output = nodeState.output as Record<string, unknown>
          const listResults = output.listResults as string[] | undefined
          if (listResults && listResults.length > 0) {
            // iterationTotal/iterationCompleted come from the backend orchestrator
            // but are not part of the typed NodeState interface
            const stateRecord = nodeState as unknown as Record<string, unknown>
            return {
              listResults,
              iterationTotal: stateRecord.iterationTotal as number | undefined,
              iterationCompleted: stateRecord.iterationCompleted as number | undefined,
            }
          }
        }
      } else {
        const data = node.data as Record<string, unknown>
        const listResults = data.__listResults as string[] | undefined
        if (listResults && listResults.length > 0) {
          return {
            listResults,
            iterationTotal: data.__listTotal as number | undefined,
            iterationCompleted: data.__listCompleted as number | undefined,
          }
        }
        // Fallback: accumulated generatedResults from multiple manual runs
        const results = data.generatedResults as
          | Array<{ url?: string; text?: string }>
          | undefined
        if (results && results.length > 1) {
          const allOutputs = results
            .map((r) => r.url || r.text || "")
            .filter((v) => v.length > 0)
          if (allOutputs.length > 1) {
            return { listResults: allOutputs }
          }
        }
      }
      return {}
    },
    [isFullscreen, presNodeStates],
  )

  // Look up an exposable field definition from NODE_DEFINITIONS
  const findFieldDef = useCallback(
    (nodeId: string, fieldKey: string): ExposableField | undefined => {
      const node = nodeMap.get(nodeId)
      if (!node?.type) return undefined
      const def = NODE_DEF_MAP.get(node.type)
      return def?.exposableFields?.find((f) => f.key === fieldKey)
    },
    [nodeMap],
  )

  // Pre-compute field badges for all output nodes from outputItems
  const fieldBadgesByNode = useMemo(() => {
    if (!outputItems) return new Map<string, FieldBadgeEntry[]>()
    const map = new Map<string, FieldBadgeEntry[]>()
    const walkItems = (items: PresentationItem[]) => {
      for (const item of items) {
        if (item.type === "field") {
          const fieldDef = findFieldDef(item.nodeId, item.field)
          if (fieldDef) {
            const nodeData = nodeMap.get(item.nodeId)?.data as Record<string, unknown> | undefined
            const inputVals = isFullscreen ? presInputValues[item.nodeId] : undefined
            const value = inputVals?.[item.field] ?? nodeData?.[item.field] ?? fieldDef.defaultValue
            const existing = map.get(item.nodeId)
            if (existing) {
              existing.push({ id: item.id, fieldDef, value })
            } else {
              map.set(item.nodeId, [{ id: item.id, fieldDef, value }])
            }
          }
        }
        if (item.type === "group") walkItems(item.items)
      }
    }
    walkItems(outputItems)
    return map
  }, [outputItems, findFieldDef, nodeMap, isFullscreen, presInputValues])

  const renderOutputCard = useCallback((node: WorkflowNode) => {
    // Resolve element size from node-level + card-level overrides
    const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
    const cardDisplay = settings.cardMeta?.[node.id]?.display
    const elementSize = cardDisplay?.elementSize ?? nodeDisplay?.elementSize ?? "lg"
    const fieldBadges = fieldBadgesByNode.get(node.id)

    // Build per-node action callbacks for share/edit/hide
    const isNodeHidden = hiddenNodeIds.has(node.id)
    const nodeActions: OutputCardActions = {
      onEdit: handleEditNode,
      onHide: isNodeHidden ? undefined : handleHideNode,
      onUnhide: isNodeHidden ? handleUnhideNode : undefined,
      isRevealed: isNodeHidden && isRevealingHidden,
    }

    // Preview node: show all visible items with their actual values
    if (node.type === "preview") {
      const nodeData = node.data as Record<string, unknown>
      // Tab mode: read from node data; fullscreen mode: prefer execution state
      let previewItems = (nodeData.previewItems as
        | Array<{ type: string; value: string; sourceNodeLabel: string; visible?: boolean }>
        | undefined) ?? []
      if (isFullscreen) {
        const execState = presNodeStates[node.id]
        const execItems = (execState?.output as Record<string, unknown> | undefined)?.previewItems as typeof previewItems | undefined
        if (execItems && execItems.length > 0) previewItems = execItems
      }
      const visibleItems = previewItems.filter((item) => item.visible !== false)
      const status = getNodeStatus(node.id)
      if (visibleItems.length === 0) {
        return <OutputCard nodeId={node.id} label={getCardTitle(node)} outputType="text" status={status} elementSize={elementSize} actions={nodeActions} />
      }
      return (
        <div className="flex flex-col gap-2">
          {visibleItems.map((item, i) => (
            <OutputCard
              key={`${node.id}-preview-${i}`}
              nodeId={node.id}
              label={item.sourceNodeLabel || getCardTitle(node)}
              outputType={item.type === "data" ? "text" : item.type}
              status={status}
              url={["image", "video", "audio"].includes(item.type) ? item.value : undefined}
              text={["text", "data"].includes(item.type) ? item.value : undefined}
              onOpenMedia={handleOpenMedia}
              elementSize={elementSize}
              actions={nodeActions}
            />
          ))}
        </div>
      )
    }
    // Social media format: show PlatformPreview with platform badge
    if (node.type === "social-media-format") {
      const nodeData = node.data as Record<string, unknown>
      const result = getResult(node.id)
      const status = getNodeStatus(node.id)
      const platform = (nodeData.platform as string) ?? "instagram"
      return (
        <div className="rounded-lg border border-border bg-card overflow-hidden cursor-pointer" onClick={() => setConfigNode(node)}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-foreground">{getCardTitle(node)}</span>
            <div className="flex items-center gap-2">
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: (PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] ?? "#888") + "20", color: PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] ?? "#888" }}
              >
                {PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}
              </span>
              <StatusBadge status={status} />
            </div>
          </div>
          <div className="flex items-center justify-center py-2 scale-75 origin-center" style={{ height: "200px" }}>
            <PlatformPreview
              platform={platform as "instagram"}
              specKey={(nodeData.specKey as string) ?? ""}
              mediaUrl={result.url}
              isVideo={result.url ? isVideoUrl(result.url) : undefined}
              caption={(nodeData.formattedText as string) ?? ""}
              size="sm"
            />
          </div>
        </div>
      )
    }
    // Config-type output nodes open a modal with their full config panel
    if (node.type && CONFIG_INPUT_TYPES.has(node.type)) {
      const label = getCardTitle(node)
      const resultData = getNodeResult(node.data as Record<string, unknown>)
      const mediaType = getOutputType(node.type)
      return (
        <button
          type="button"
          onClick={() => setConfigNode(node)}
          className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer overflow-hidden"
        >
          {resultData.url && mediaType === "image" && (
            <img src={resultData.url} alt={label} className="w-full h-32 object-cover" />
          )}
          {resultData.url && mediaType === "video" && (
            <video src={resultData.url} muted playsInline className="w-full h-32 object-cover" />
          )}
          <div className="p-3">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Click to edit settings</p>
          </div>
        </button>
      )
    }
    const outputType = getOutputType(node.type)
    const status = getNodeStatus(node.id)
    const result = getResult(node.id)
    const progress = combinedProgress[node.id]
    const displayMode = settings.outputDisplayModes?.[node.id] ?? "individual"
    const { listResults, iterationTotal, iterationCompleted } = getListResults(node)

    // Gallery mode: single card with all results
    if (listResults && listResults.length > 1 && displayMode === "gallery") {
      return (
        <OutputCard
          nodeId={node.id}
          label={getCardTitle(node)}
          outputType={outputType}
          status={status}
          url={result.url}
          text={result.text}
          onOpenMedia={handleOpenMedia}
          progress={progress}
          listResults={listResults}
          displayMode="gallery"
          iterationTotal={iterationTotal}
          iterationCompleted={iterationCompleted}
          elementSize={elementSize}
          fieldBadges={fieldBadges}
          actions={nodeActions}
        />
      )
    }

    // Individual mode with listResults: render multiple OutputCard instances
    if (listResults && listResults.length > 1 && displayMode === "individual") {
      return (
        <div className="flex flex-col gap-2">
          {listResults.filter(Boolean).map((resultUrl, i) => (
            <OutputCard
              key={`${node.id}-${i}`}
              nodeId={node.id}
              label={`${getCardTitle(node)} #${i + 1}`}
              outputType={outputType}
              status={status}
              url={outputType !== "text" ? resultUrl : undefined}
              text={outputType === "text" ? resultUrl : undefined}
              onOpenMedia={handleOpenMedia}
              elementSize={elementSize}
              fieldBadges={i === 0 ? fieldBadges : undefined}
              actions={nodeActions}
            />
          ))}
        </div>
      )
    }

    // Single result (default)
    return (
      <OutputCard
        nodeId={node.id}
        label={getCardTitle(node)}
        outputType={outputType}
        status={status}
        url={result.url}
        text={result.text}
        onOpenMedia={handleOpenMedia}
        progress={progress}
        elementSize={elementSize}
        fieldBadges={fieldBadges}
        actions={nodeActions}
      />
    )
  }, [getNodeStatus, getResult, getCardTitle, handleOpenMedia, combinedProgress, settings.outputDisplayModes, getListResults, isFullscreen, presNodeStates, settings.cardMeta, fieldBadgesByNode, hiddenNodeIds, isRevealingHidden, handleHideNode, handleUnhideNode, handleEditNode])

  // Render a single PresentationItem — dispatches by type for input side
  const renderInputItem = useCallback(
    (item: PresentationItem): React.ReactNode => {
      switch (item.type) {
        case "node": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          return renderInputCard(node)
        }
        case "field": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          const fieldDef = findFieldDef(item.nodeId, item.field)
          if (!fieldDef) return null
          const nodeData = (node.data ?? {}) as Record<string, unknown>
          const inputVals = isFullscreen ? presInputValues[item.nodeId] : undefined
          const mergedNodeData = inputVals ? { ...nodeData, ...inputVals } : nodeData
          const currentValue = inputVals?.[item.field] ?? nodeData[item.field] ?? fieldDef.defaultValue
          const customTitle = settings.cardMeta?.[item.id]?.title
          return (
            <ConfigFieldRenderer
              nodeType={node.type ?? ""}
              field={item.field}
              value={currentValue}
              nodeData={mergedNodeData}
              onChange={(v) => {
                if (isFullscreen) {
                  presUpdateInput(item.nodeId, item.field, v)
                } else {
                  updateNodeData(item.nodeId, { [item.field]: v })
                }
              }}
              allowedValues={item.allowedValues}
              readOnly={inputsReadOnly ?? (isShareReadOnly || isRunning || isTerminal)}
              customLabel={customTitle}
            />
          )
        }
        case "richtext": {
          if (isEditing) {
            return (
              <RichtextEditor
                content={item.content}
                onChange={(html) => {
                  const key = inputItems ? "inputItems" : undefined
                  if (!key) return
                  const items = settings[key] ?? []
                  const updatedItems = updateItemContent(items, item.id, html)
                  updatePresentationSettings({ [key]: updatedItems })
                }}
                placeholder="Type something..."
              />
            )
          }
          return <RichtextBlock content={item.content} />
        }
        case "group": {
          return (
            <GroupCard
              title={item.title}
              isEditing={isEditing}
              showTitle={item.showTitle ?? true}
              showBackground={item.showBackground ?? true}
              onTitleChange={(title) => {
                const items = settings.inputItems ?? []
                const updated = updateGroupTitle(items, item.id, title)
                updatePresentationSettings({ inputItems: updated })
              }}
              onShowTitleChange={(v) => {
                const items = settings.inputItems ?? []
                updatePresentationSettings({ inputItems: updateGroupField(items, item.id, "showTitle", v) })
              }}
              onShowBackgroundChange={(v) => {
                const items = settings.inputItems ?? []
                updatePresentationSettings({ inputItems: updateGroupField(items, item.id, "showBackground", v) })
              }}
              onDelete={() => {
                const items = settings.inputItems ?? []
                updatePresentationSettings({ inputItems: items.filter((i) => !(i.type === "group" && i.id === item.id)) })
              }}
              onAddRichtext={() => addRichtextToGroup("inputItems", item.id)}
            >
              {item.items.map((child) => (
                <div key={child.type === "node" ? child.nodeId : child.id}>
                  {renderInputItem(child)}
                </div>
              ))}
            </GroupCard>
          )
        }
        default:
          return null
      }
    },
    [nodeMap, renderInputCard, findFieldDef, isFullscreen, presInputValues, presUpdateInput, updateNodeData, inputsReadOnly, isShareReadOnly, isRunning, isTerminal, isEditing, inputItems, settings, updatePresentationSettings],
  )

  // Render a single PresentationItem — dispatches by type for output side
  const renderOutputItem = useCallback(
    (item: PresentationItem): React.ReactNode => {
      switch (item.type) {
        case "node": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          return renderOutputCard(node)
        }
        case "field": {
          // Field items are already rendered as inline badges on the output card
          // via fieldBadgesByNode — skip standalone rendering to avoid duplicates
          return null
        }
        case "output": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          return renderOutputCard(node)
        }
        case "richtext": {
          if (isEditing) {
            return (
              <RichtextEditor
                content={item.content}
                onChange={(html) => {
                  const items = settings.outputItems ?? []
                  const updatedItems = updateItemContent(items, item.id, html)
                  updatePresentationSettings({ outputItems: updatedItems })
                }}
                placeholder="Type something..."
              />
            )
          }
          return <RichtextBlock content={item.content} />
        }
        case "group": {
          return (
            <GroupCard
              title={item.title}
              isEditing={isEditing}
              showTitle={item.showTitle ?? true}
              showBackground={item.showBackground ?? true}
              onTitleChange={(title) => {
                const items = settings.outputItems ?? []
                const updated = updateGroupTitle(items, item.id, title)
                updatePresentationSettings({ outputItems: updated })
              }}
              onShowTitleChange={(v) => {
                const items = settings.outputItems ?? []
                updatePresentationSettings({ outputItems: updateGroupField(items, item.id, "showTitle", v) })
              }}
              onShowBackgroundChange={(v) => {
                const items = settings.outputItems ?? []
                updatePresentationSettings({ outputItems: updateGroupField(items, item.id, "showBackground", v) })
              }}
              onDelete={() => {
                const items = settings.outputItems ?? []
                updatePresentationSettings({ outputItems: items.filter((i) => !(i.type === "group" && i.id === item.id)) })
              }}
              onAddRichtext={() => addRichtextToGroup("outputItems", item.id)}
            >
              {item.items.map((child) => (
                <div key={child.type === "node" ? child.nodeId : child.id}>
                  {renderOutputItem(child)}
                </div>
              ))}
            </GroupCard>
          )
        }
        default:
          return null
      }
    },
    [nodeMap, renderOutputCard, findFieldDef, isFullscreen, presInputValues, isEditing, settings, updatePresentationSettings],
  )

  // Add a group item to the specified side
  const addGroup = useCallback(
    (side: "input" | "output") => {
      const key = side === "input" ? "inputItems" : "outputItems"
      const current = settings[key] ?? []
      updatePresentationSettings({
        [key]: [...current, { type: "group" as const, id: crypto.randomUUID(), title: "New Group", items: [] }],
      })
    },
    [settings, updatePresentationSettings],
  )

  // Add a richtext item inside a group
  const addRichtextToGroup = useCallback(
    (settingsKey: "inputItems" | "outputItems", groupId: string) => {
      const items = settings[settingsKey] ?? []
      const updated = items.map((item) => {
        if (item.type === "group" && item.id === groupId) {
          return {
            ...item,
            items: [...item.items, { type: "richtext" as const, id: crypto.randomUUID(), content: "" }],
          }
        }
        return item
      })
      updatePresentationSettings({ [settingsKey]: updated })
    },
    [settings, updatePresentationSettings],
  )

  // Items-based drag-end handler (reorders within the flat items list)
  const makeItemsDragEndHandler = useCallback(
    (items: PresentationItem[], settingsKey: "inputItems" | "outputItems") =>
      (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const ids = items.map((item) => item.type === "node" ? item.nodeId : item.id)
        const oldIndex = ids.indexOf(active.id as string)
        const newIndex = ids.indexOf(over.id as string)
        if (oldIndex === -1 || newIndex === -1) return
        updatePresentationSettings({ [settingsKey]: arrayMove([...items], oldIndex, newIndex) })
      },
    [updatePresentationSettings],
  )

  const handleInputItemsDragEnd = useMemo(
    () => inputItems ? makeItemsDragEndHandler(inputItems, "inputItems") : handleInputDragEnd,
    [inputItems, makeItemsDragEndHandler, handleInputDragEnd],
  )
  const handleOutputItemsDragEnd = useMemo(
    () => outputItems ? makeItemsDragEndHandler(outputItems, "outputItems") : handleOutputDragEnd,
    [outputItems, makeItemsDragEndHandler, handleOutputDragEnd],
  )

  const costLabel = hasCredits() && estimatedCost > 0 ? ` (${estimatedCost} CR)` : ""

  // Stable reference for ShareDialog nodes prop
  const allPresentationNodes = useMemo(
    () => [...orderedInputNodes, ...visibleOutputNodes],
    [orderedInputNodes, visibleOutputNodes],
  )

  // Shared props for all views
  const viewProps = {
    orderedInputNodes,
    orderedOutputNodes: visibleOutputNodes,
    getNodeStatus,
    getResult,
    getCardTitle,
    onOpenMedia: handleOpenMedia,
    onOpenConfig: setConfigNode,
  }

  const editableProps = {
    ...viewProps,
    isEditing,
    sensors,
    handleInputDragEnd: handleInputItemsDragEnd,
    handleOutputDragEnd: handleOutputItemsDragEnd,
    handleRemoveNode,
    handleRemoveItem,
    settings,
    updateCardMeta,
    setPickerSection: setPickerSection as (section: "inputs" | "outputs") => void,
    renderInputCard,
    renderOutputCard,
    getNodeColumns,
    inputItems,
    outputItems,
    renderInputItem,
    renderOutputItem,
    addGroup,
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between px-3 md:px-6 border-b border-border bg-card shrink-0" style={{ paddingTop: 'max(0.5rem, var(--safe-area-top))' }}>
        {/* Top row: title + right-side controls */}
        <div className="flex items-center justify-between h-11 md:h-14 w-full md:w-auto min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {headerLeft}
            <h1 className="text-sm md:text-lg font-semibold truncate text-foreground min-w-[3rem]">
              {workflowName || "Untitled"}
            </h1>
          </div>
          {/* Mobile-only: compact right-side controls */}
          <div className="flex items-center gap-1 md:hidden shrink-0">
            {isFullscreen && <ThemeToggle />}
            {user && hasCredits() && (
              isAppRunner ? (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div><CreditBalance userId={user.id} onClick={() => setShowGetCreditsModal(true)} /></div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">View credits &amp; plans</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <CreditBalance userId={user.id} />
              )
            )}
            {user && isAppRunner && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={signOut} className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground touch-manipulation">
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{user.email}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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

        {/* App runner: action buttons — scrollable row on mobile, centered on desktop */}
        {isAppRunner && (
          <div className="flex items-center gap-2 pb-2 md:pb-0 md:absolute md:left-1/2 md:-translate-x-1/2 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0 md:overflow-x-visible">
            {user && (
              <button
                type="button"
                onClick={onNewRun}
                className={`shrink-0 whitespace-nowrap h-10 md:h-8 px-4 rounded-full text-sm font-medium flex items-center gap-2 transition-all duration-200 touch-manipulation ${
                  newRunLabel === "Retry" || newRunLabel === "Clear"
                    ? "text-foreground bg-muted hover:bg-muted/80 border border-border"
                    : "text-white bg-[#ff0073] hover:bg-[#ff0073]/90"
                }`}
              >
                {newRunLabel === "Retry" || newRunLabel === "Clear"
                  ? <RotateCcw className="h-4 w-4" />
                  : <Plus className="h-4 w-4" />}
                <span className="hidden sm:inline">{newRunLabel ?? "New Run"}</span>
              </button>
            )}

            {isRunning ? (
              <button
                type="button"
                onClick={onCancel}
                className="shrink-0 whitespace-nowrap h-10 md:h-8 px-4 rounded-full text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 transition-all duration-200 touch-manipulation"
                disabled={!onCancel}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            ) : (
              inputsReadOnly !== true && (
                needsMoreCredits ? (
                  <button
                    type="button"
                    onClick={() => setShowGetCreditsModal(true)}
                    className="shrink-0 whitespace-nowrap h-10 md:h-8 px-4 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center gap-2 transition-all duration-200 touch-manipulation"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span className="hidden sm:inline">{userCredits?.tier === "free" ? "Get Free Credits" : "Get Credits"}</span>
                  </button>
                ) : (
                  <>
                    {underMinWarning && (
                      <p className="text-xs text-amber-400 mb-1">{underMinWarning}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleRunClick}
                      className="shrink-0 whitespace-nowrap h-10 md:h-8 px-4 rounded-full text-sm font-medium text-white bg-[#ff0073] hover:bg-[#ff0073]/90 flex items-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                      disabled={!!user && !allInputsFilled}
                    >
                      {!user ? (
                        <><LogIn className="h-4 w-4" /><span className="hidden sm:inline">Sign in to Run</span></>
                      ) : (
                        <><Play className="h-4 w-4" />Run<span className="hidden sm:inline">{costLabel}</span></>
                      )}
                    </button>
                  </>
                )
              )
            )}

            {/* Remix: create editable copy (only when app creator enabled it) */}
            {appSupportsRemix && (
              <>
                <div className="w-px h-5 bg-border hidden md:block shrink-0" />
                <button
                  type="button"
                  onClick={handleRemix}
                  disabled={isRemixing}
                  title="Remix this app"
                  className="shrink-0 whitespace-nowrap h-10 md:h-8 px-3 md:px-4 rounded-full text-sm font-medium text-foreground bg-muted hover:bg-muted/80 border border-border flex items-center gap-2 transition-all duration-200 disabled:opacity-50 touch-manipulation"
                >
                  {isRemixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  <span className="hidden md:inline">Remix</span>
                </button>
              </>
            )}

            {/* More Apps */}
            <button
              type="button"
              onClick={() => window.open("/apps", "_blank")}
              title="Explore more apps"
              className="shrink-0 whitespace-nowrap h-10 md:h-8 px-3 md:px-4 rounded-full text-sm font-medium text-foreground bg-muted hover:bg-muted/80 border border-border flex items-center gap-2 transition-all duration-200 touch-manipulation"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden md:inline">More Apps</span>
            </button>
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
          {user && hasCredits() && (
            isAppRunner ? (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div><CreditBalance userId={user.id} onClick={() => setShowGetCreditsModal(true)} /></div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">View credits &amp; plans</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <CreditBalance userId={user.id} />
            )
          )}
          {user && isAppRunner && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={signOut}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{user.email}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPublishTemplate(true)}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <LayoutGrid className="h-4 w-4 mr-1" />
                Template
              </Button>
              <PublishTemplateDialog
                workflowId={workflowId}
                nodes={nodes.map((n) => ({ id: n.id, type: n.type ?? "", data: (n.data ?? {}) as Record<string, unknown> }))}
                edges={edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))}
                open={showPublishTemplate}
                onOpenChange={setShowPublishTemplate}
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
              <>
                {underMinWarning && (
                  <p className="text-xs text-amber-400 mb-1">{underMinWarning}</p>
                )}
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
              </>
            )
          )}
        </div>
      </div>

      {/* Hidden nodes pill */}
      {hiddenNodeIds.size > 0 && (
        <div className="flex justify-center mb-3">
          <HiddenNodesPill
            count={hiddenNodeIds.size}
            isRevealing={isRevealingHidden}
            onToggleReveal={handleToggleReveal}
          />
        </div>
      )}

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

      {/* Config modal for config-type input nodes */}
      <NodeConfigModal
        node={configNode}
        open={!!configNode}
        onOpenChange={(o) => { if (!o) setConfigNode(null) }}
      />

      {/* Get Credits modal for app runner */}
      {isAppRunner && userCredits && (
        <GetCreditsModal
          open={showGetCreditsModal}
          onClose={() => setShowGetCreditsModal(false)}
          tier={userCredits.tier}
          balance={userCredits.total}
          required={estimatedCost}
        />
      )}

      {/* Editor modals (fullscreen renders locally; tab mode for audio only) */}
      {editState && (
        <Suspense fallback={null}>
          {editState.type === "video" && (
            <FreeCutEditorModal
              videoUrl={editState.url}
              onExportComplete={(blob) => handleEditorSave(blob)}
              onClose={() => setEditState(null)}
            />
          )}
          {editState.type === "image" && (
            <FilerobotEditorModal
              imageUrl={editState.url}
              onSaveComplete={(blob: Blob) => handleEditorSave(blob)}
              onClose={() => setEditState(null)}
            />
          )}
          {editState.type === "audio" && (
            <AudiomassEditorModal
              audioUrl={editState.url}
              onExportComplete={(blob) => handleEditorSave(blob)}
              onClose={() => setEditState(null)}
            />
          )}
        </Suspense>
      )}
    </div>
  )
}
