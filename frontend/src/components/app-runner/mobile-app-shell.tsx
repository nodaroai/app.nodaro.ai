/**
 * MobileAppShell — tab-based mobile orchestrator for the app runner.
 * Replaces the desktop PresentationView on mobile breakpoints.
 * Reads from existing stores and wires them to mobile-specific sub-components.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Plus, Inbox, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth, refreshAuth, setAuthFromTokens } from "@/hooks/use-auth"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"
import { hasCredits } from "@/lib/edition"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"
import {
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeResult,
} from "@/lib/presentation-utils"
import { createClient } from "@/lib/supabase"
import { toast } from "sonner"
import { isVideoUrl } from "@/lib/media-type"
import type { WorkflowNode, PresentationDisplay } from "@/types/nodes"
import type { PublishedApp } from "@/lib/api"
import type { PresentationViewMode, PresentationSettings } from "@/hooks/use-workflow-store"

import { MobileAppHeader } from "./mobile-app-header"
import { MobileTabBar, type MobileTab } from "./mobile-tab-bar"
import { MobileStickyAction } from "./mobile-sticky-action"
import { RunSlotItem } from "./run-slot-item"
import { ORIGINAL_SLOT_ID } from "./types"
import type { useRunSlots } from "./use-run-slots"

import { InputCard } from "@/components/presentation/input-card"
import { OutputCard, type FieldBadgeEntry } from "@/components/presentation/output-card"
import { ConfigFieldRenderer } from "@/components/presentation/config-field-renderer"
import { RichtextBlock } from "@/components/presentation/richtext-block"
import { GroupCard } from "@/components/presentation/group-card"
import { getCardTitle as getCardTitleHelper, orderNodesByIds, getNodeResultWithInputFallback, areAllInputsFilled, resolveInputItems, resolveOutputItems } from "@/components/presentation/helpers"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { PresentationItem } from "@nodaro-shared/presentation-types"
import { NodeConfigModal, CONFIG_INPUT_TYPES } from "@/components/presentation/node-config-modal"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { GetCreditsModal } from "@/components/credits/GetCreditsModal"
import { PlatformPreview, PLATFORM_COLORS } from "@/components/nodes/platform-preview"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"
import { StatusBadge } from "@/components/presentation/output-cards/shared"
import { ALL_VIEW_MODES } from "@/components/presentation/view-mode-selector"
import {
  GalleryView,
  FullscreenView,
  CompareView,
} from "@/components/presentation/views"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// orderNodesByIds, getNodeResultWithInputFallback, areAllInputsFilled — imported from helpers

const VALID_VIEW_MODES = new Set<PresentationViewMode>(ALL_VIEW_MODES)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MobileAppShellProps {
  app: PublishedApp
  user: ReturnType<typeof useAuth>["user"]
  runSlots: ReturnType<typeof useRunSlots>
  cancel: () => void
  initialRunId?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MobileAppShell({
  app,
  user,
  runSlots,
  cancel,
  initialRunId,
}: MobileAppShellProps) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- Stores ----
  const presNodes = usePresentationStore((s) => s.nodes)
  const presEdges = usePresentationStore((s) => s.edges)
  const presNodeStates = usePresentationStore((s) => s.nodeStates)
  const presInputValues = usePresentationStore((s) => s.inputValues)
  const presUpdateInput = usePresentationStore((s) => s.updateInputValue)
  const presRun = usePresentationStore((s) => s.run)
  const presEstimatedCost = usePresentationStore((s) => s.estimatedCost)
  const presPresentationSettings = usePresentationStore((s) => s.presentationSettings)
  const presExecutionStatus = usePresentationStore((s) => s.executionStatus)
  const presCompletedNodes = usePresentationStore((s) => s.completedNodes)
  const presTotalNodes = usePresentationStore((s) => s.totalNodes)

  const appRunnerInsufficientCredits = useAppRunnerStore((s) => s.insufficientCredits)
  const appSupportsRemix = useAppRunnerStore((s) => s.app?.supportsRemix ?? false)
  const combinedProgress = useAppRunnerStore((s) => s.combinedProgress)

  const { data: userCredits } = useUserCredits(user?.id)

  // ---- Derived node lists ----
  const inputNodes = useMemo(() => getInputNodes(presNodes, true), [presNodes])
  const outputNodes = useMemo(() => getOutputNodes(presNodes, presEdges, true), [presNodes, presEdges])

  const settings = presPresentationSettings
  const orderedInputNodes = useMemo(
    () => orderNodesByIds(inputNodes, settings.inputOrder),
    [inputNodes, settings.inputOrder],
  )
  const orderedOutputNodes = useMemo(
    () => orderNodesByIds(outputNodes, settings.outputOrder),
    [outputNodes, settings.outputOrder],
  )

  const nodeMap = useMemo(() => new Map(presNodes.map((n) => [n.id, n])), [presNodes])

  // ---- Items-based input rendering (field items, groups, richtext) ----
  const inputItems = useMemo(() => resolveInputItems(settings), [settings.inputItems, settings.inputOrder])
  const outputItems = useMemo(() => resolveOutputItems(settings), [settings.outputItems, settings.outputOrder])
  const useItemsRendering = inputItems && inputItems.length > 0
  const useOutputItemsRendering = outputItems && outputItems.length > 0

  const findFieldDef = useCallback(
    (nodeId: string, fieldKey: string) => {
      const node = nodeMap.get(nodeId)
      if (!node?.type) return undefined
      const def = NODE_DEF_MAP.get(node.type)
      return def?.exposableFields?.find((f) => f.key === fieldKey)
    },
    [nodeMap],
  )

  // ---- Execution derived state ----
  const isRunning = presExecutionStatus === "running"
  const suppressOutputFallback = runSlots.activeSlotId !== null && runSlots.activeSlotId !== ORIGINAL_SLOT_ID
  const inputsReadOnly = runSlots.inputsReadOnlyValue
  const estimatedCost = presEstimatedCost

  const needsMoreCredits = useMemo(() => {
    if (!user || !hasCredits() || !userCredits || estimatedCost <= 0) return false
    return userCredits.total < estimatedCost
  }, [user, userCredits, estimatedCost])

  const costLabel = hasCredits() && estimatedCost > 0 ? ` (${estimatedCost} CR)` : ""

  const allInputsFilled = useMemo(
    () => areAllInputsFilled(orderedInputNodes, presInputValues),
    [orderedInputNodes, presInputValues],
  )

  // ---- Local state ----
  const [activeTab, setActiveTab] = useState<MobileTab>(initialRunId ? "outputs" : "inputs")
  const [hasUnseenOutputs, setHasUnseenOutputs] = useState(false)
  const [showGetCreditsModal, setShowGetCreditsModal] = useState(false)
  const [configNode, setConfigNode] = useState<WorkflowNode | null>(null)
  const [lightboxNodeId, setLightboxNodeId] = useState<string | null>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [isRemixing, setIsRemixing] = useState(false)

  // Auto-create new run after login redirect (?newrun=1)
  const newRunHandled = useRef(false)
  useEffect(() => {
    if (newRunHandled.current) return
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("newrun") === "1") {
      newRunHandled.current = true
      runSlots.handleCreateNew()
      setActiveTab("inputs")
      // Clean up the URL param
      params.delete("newrun")
      const clean = params.toString()
      window.history.replaceState({}, "", window.location.pathname + (clean ? `?${clean}` : ""))
    }
  }, [user, runSlots])

  // Scroll position preservation per tab
  const scrollPositions = useRef<Record<string, number>>({ inputs: 0, outputs: 0, runs: 0 })
  const contentRef = useRef<HTMLDivElement>(null)

  // ---- Swipe between runs on outputs tab ----
  const touchStartY = useRef<number | null>(null)
  const swipeHandled = useRef(false)

  const handleOutputTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    swipeHandled.current = false
  }, [])

  const handleOutputTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || swipeHandled.current) return
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    touchStartY.current = null
    if (Math.abs(deltaY) < 80) return // threshold

    const slots = runSlots.slots
    if (slots.length < 2) return
    const currentIdx = slots.findIndex((s) => s.id === runSlots.activeSlotId)
    if (currentIdx === -1) return

    if (deltaY > 0 && currentIdx > 0) {
      // Swipe down → previous run
      swipeHandled.current = true
      runSlots.handleSelectSlot(slots[currentIdx - 1].id)
    } else if (deltaY < 0 && currentIdx < slots.length - 1) {
      // Swipe up → next run
      swipeHandled.current = true
      runSlots.handleSelectSlot(slots[currentIdx + 1].id)
    }
  }, [runSlots])

  // ---- View mode (URL-synced) ----
  const urlViewMode = searchParams.get("view") as PresentationViewMode | null
  const allowedModes = settings.shareAllowedModes ?? ALL_VIEW_MODES
  const allowedSet = useMemo(() => new Set(allowedModes), [allowedModes])
  const effectiveDefault = (settings.shareDefaultMode && allowedSet.has(settings.shareDefaultMode))
    ? settings.shareDefaultMode
    : (allowedModes[0] ?? "horizontal")
  const viewMode: PresentationViewMode = (urlViewMode && VALID_VIEW_MODES.has(urlViewMode) && allowedSet.has(urlViewMode)
    ? urlViewMode : null) ?? effectiveDefault
  // Non-standard views (gallery/fullscreen/compare) override the tab content
  const isViewOverride = viewMode === "gallery" || viewMode === "fullscreen" || viewMode === "compare"

  const handleViewModeChange = useCallback((newMode: PresentationViewMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (newMode === "horizontal" || newMode === "vertical") {
        next.delete("view")
      } else {
        next.set("view", newMode)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleExitViewOverride = useCallback(
    () => handleViewModeChange("horizontal"),
    [handleViewModeChange],
  )

  const updatePresPresentationSettings = useCallback(
    (patch: Partial<PresentationSettings>) => {
      usePresentationStore.setState((prev) => ({
        presentationSettings: { ...prev.presentationSettings, ...patch },
      }))
    },
    [],
  )

  // ---- Auto-tab-switch on execution complete ----
  const prevStatus = useRef(presExecutionStatus)
  useEffect(() => {
    if (prevStatus.current === "running" && presExecutionStatus === "completed") {
      setActiveTab("outputs")
      setHasUnseenOutputs(false)
    } else if (
      prevStatus.current !== presExecutionStatus &&
      presExecutionStatus === "completed" &&
      activeTab !== "outputs"
    ) {
      // Only set badge on actual status transitions, not on tab switches
      setHasUnseenOutputs(true)
    }
    prevStatus.current = presExecutionStatus
  }, [presExecutionStatus, activeTab])

  // Clear badge on manual switch to outputs
  useEffect(() => {
    if (activeTab === "outputs") setHasUnseenOutputs(false)
  }, [activeTab])

  // ---- Auto-open credits modal on insufficient credits ----
  useEffect(() => {
    if (appRunnerInsufficientCredits) {
      setShowGetCreditsModal(true)
    }
  }, [appRunnerInsufficientCredits])

  // ---- Keyboard focus detection (hide tab bar + sticky action) ----
  useEffect(() => {
    const container = contentRef.current
    if (!container) return
    let focusOutTimer: ReturnType<typeof setTimeout> | null = null
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        if (focusOutTimer) { clearTimeout(focusOutTimer); focusOutTimer = null }
        setIsInputFocused(true)
      }
    }
    const handleFocusOut = () => {
      // Delay to prevent flicker when tabbing between inputs
      focusOutTimer = setTimeout(() => setIsInputFocused(false), 100)
    }
    container.addEventListener("focusin", handleFocusIn)
    container.addEventListener("focusout", handleFocusOut)
    return () => {
      if (focusOutTimer) clearTimeout(focusOutTimer)
      container.removeEventListener("focusin", handleFocusIn)
      container.removeEventListener("focusout", handleFocusOut)
    }
  }, [])

  // ---- Scroll position save/restore ----
  const handleTabChange = useCallback((tab: MobileTab) => {
    // Save current scroll
    if (contentRef.current) {
      scrollPositions.current[activeTab] = contentRef.current.scrollTop
    }
    setActiveTab(tab)
    // Restore after paint
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = scrollPositions.current[tab] ?? 0
      }
    })
  }, [activeTab])

  // ---- Node status / result callbacks (replicate PresentationView fullscreen logic) ----
  const getNodeStatus = useCallback(
    (nodeId: string): "idle" | "waiting" | "running" | "completed" | "failed" => {
      const state = presNodeStates[nodeId]
      if (!state) return "idle"
      if (state.status === "running") return "running"
      if (state.status === "completed") return "completed"
      if (state.status === "failed") return "failed"
      if (state.status === "pending") return "waiting"
      return "idle"
    },
    [presNodeStates],
  )

  const getFullscreenResult = useCallback(
    (nodeId: string) => {
      const state = presNodeStates[nodeId]
      if (state?.output) {
        const output = state.output as Record<string, unknown>
        const url = (output.imageUrl ?? output.videoUrl ?? output.audioUrl) as string | undefined
        const text = output.text as string | undefined
        if (url || text) return { url, text }
      }
      const inputUrl = presInputValues[nodeId]?.url as string | undefined
      if (inputUrl) return { url: inputUrl, text: undefined }
      if (suppressOutputFallback) return { url: undefined, text: undefined }
      const node = nodeMap.get(nodeId)
      if (!node) return { url: undefined, text: undefined }
      return getNodeResultWithInputFallback(node)
    },
    [presNodeStates, presInputValues, nodeMap, suppressOutputFallback],
  )

  const getCardTitle = useCallback(
    (node: WorkflowNode) => getCardTitleHelper(node, settings.cardMeta),
    [settings.cardMeta],
  )

  const handleOpenMedia = setLightboxNodeId

  // Extract listResults for gallery/individual display (mirrors PresentationView)
  const getListResults = useCallback(
    (node: WorkflowNode): { listResults?: string[]; iterationTotal?: number; iterationCompleted?: number } => {
      const nodeState = presNodeStates[node.id]
      if (nodeState?.output) {
        const output = nodeState.output as Record<string, unknown>
        const listResults = output.listResults as string[] | undefined
        if (listResults && listResults.length > 0) {
          const stateRecord = nodeState as unknown as Record<string, unknown>
          return {
            listResults,
            iterationTotal: stateRecord.iterationTotal as number | undefined,
            iterationCompleted: stateRecord.iterationCompleted as number | undefined,
          }
        }
        // Check generatedResults array
        const results = output.generatedResults as Array<{ url?: string; text?: string }> | undefined
        if (results && results.length > 1) {
          const allOutputs = results.map((r) => r.url || r.text || "").filter((v) => v.length > 0)
          if (allOutputs.length > 1) return { listResults: allOutputs }
        }
      }
      return {}
    },
    [presNodeStates],
  )

  // ---- Item-based input renderer (mirrors PresentationView renderInputItem) ----
  const renderInputItem = useCallback(
    (item: PresentationItem): React.ReactNode => {
      switch (item.type) {
        case "node": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
          const cardDisplay = settings.cardMeta?.[node.id]?.display
          const display = { ...nodeDisplay, ...cardDisplay }
          return (
            <InputCard
              node={node}
              nodes={presNodes}
              edges={presEdges}
              isFullscreen
              inputValues={presInputValues}
              onUpdateInput={presUpdateInput}
              readOnly={inputsReadOnly || isRunning}
              onOpenMedia={handleOpenMedia}
              onOpenConfig={setConfigNode}
              display={display}
            />
          )
        }
        case "field": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          const fieldDef = findFieldDef(item.nodeId, item.field)
          if (!fieldDef) return null
          const nodeData = (node.data ?? {}) as Record<string, unknown>
          const inputVals = presInputValues[item.nodeId]
          const mergedNodeData = inputVals ? { ...nodeData, ...inputVals } : nodeData
          const currentValue = inputVals?.[item.field] ?? nodeData[item.field] ?? fieldDef.defaultValue
          const customTitle = settings.cardMeta?.[item.id]?.title
          return (
            <ConfigFieldRenderer
              nodeType={node.type ?? ""}
              field={item.field}
              value={currentValue}
              nodeData={mergedNodeData}
              onChange={(v) => presUpdateInput(item.nodeId, item.field, v)}
              allowedValues={item.allowedValues}
              readOnly={inputsReadOnly || isRunning}
              customLabel={customTitle}
            />
          )
        }
        case "richtext":
          return <RichtextBlock content={item.content} />
        case "group":
          return (
            <GroupCard
              title={item.title}
              showTitle={item.showTitle ?? true}
              showBackground={item.showBackground ?? true}
            >
              {item.items.map((child) => (
                <div key={child.type === "node" ? child.nodeId : child.id}>
                  {renderInputItem(child)}
                </div>
              ))}
            </GroupCard>
          )
        default:
          return null
      }
    },
    [nodeMap, presNodes, presEdges, presInputValues, presUpdateInput, inputsReadOnly, isRunning, handleOpenMedia, setConfigNode, findFieldDef, settings.cardMeta],
  )

  // ---- Media lightbox ----
  // Only compute media items when lightbox is open — avoids recalculating on every nodeStates poll
  const mediaItems = useMemo(() => {
    if (!lightboxNodeId) return []
    const items: { nodeId: string; type: "image" | "video"; url: string }[] = []
    for (const node of [...orderedInputNodes, ...orderedOutputNodes]) {
      const outputType = getOutputType(node.type)
      if (outputType !== "image" && outputType !== "video") continue
      const result = getFullscreenResult(node.id)
      if (!result.url) continue
      items.push({ nodeId: node.id, type: outputType, url: result.url })
    }
    return items
  }, [lightboxNodeId, orderedInputNodes, orderedOutputNodes, getFullscreenResult])

  const lightboxIndex = lightboxNodeId ? mediaItems.findIndex((m) => m.nodeId === lightboxNodeId) : -1
  const lightboxItem = lightboxIndex >= 0 ? mediaItems[lightboxIndex] : null

  const handleLightboxPrev = useCallback(() => {
    if (lightboxIndex > 0) setLightboxNodeId(mediaItems[lightboxIndex - 1].nodeId)
  }, [lightboxIndex, mediaItems])
  const handleLightboxNext = useCallback(() => {
    if (lightboxIndex < mediaItems.length - 1) setLightboxNodeId(mediaItems[lightboxIndex + 1].nodeId)
  }, [lightboxIndex, mediaItems])

  // ---- Run click ----
  const handleRunClick = useCallback(() => {
    if (!user) {
      openLoginPopup()
      return
    }
    presRun()
    setActiveTab("outputs")
  }, [user, presRun, navigate])

  // ---- Remix ----
  const handleRemix = useCallback(async () => {
    if (!user) {
      openLoginPopup()
      return
    }
    const appData = useAppRunnerStore.getState().app
    if (!appData) return

    setIsRemixing(true)
    try {
      const supabase = createClient()
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

      let thumbnailUrl: string | null = appData.previewMediaUrl ?? null
      if (!thumbnailUrl) {
        const snapshotNodes = appData.snapshotNodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>
        const thumbNode = appData.thumbnailNodeId
          ? snapshotNodes.find((n) => n.id === appData.thumbnailNodeId)
          : null
        if (thumbNode?.data) {
          const result = getNodeResult(thumbNode.data)
          if (result.url) thumbnailUrl = result.url
        }
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

  // ---- Login popup (stays on app page) ----
  const openLoginPopup = useCallback((onSuccess?: () => void) => {
    const w = 500, h = 650
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    const popup = window.open(
      `${window.location.origin}/login`,
      "nodaro-login",
      `width=${w},height=${h},left=${left},top=${top},popup=1`,
    )
    if (!popup) {
      // Popup blocked — fall back to redirect
      const returnUrl = window.location.pathname + window.location.search
      localStorage.setItem(AUTH_REDIRECT_KEY, returnUrl)
      navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`)
      return
    }
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === "nodaro:authComplete" && event.data.access_token) {
        window.removeEventListener("message", handleAuthMessage)
        clearInterval(interval)
        setAuthFromTokens(event.data.access_token, event.data.refresh_token)
        onSuccess?.()
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
  }, [navigate])

  const handleSignIn = useCallback(() => openLoginPopup(), [openLoginPopup])

  // ---- Pre-compute field badges for output nodes ----
  const fieldBadgesByNode = useMemo(() => {
    if (!outputItems) return new Map<string, FieldBadgeEntry[]>()
    const map = new Map<string, FieldBadgeEntry[]>()
    const walkItems = (items: PresentationItem[]) => {
      for (const item of items) {
        if (item.type === "field") {
          const fieldDef = findFieldDef(item.nodeId, item.field)
          if (fieldDef) {
            const nodeData = nodeMap.get(item.nodeId)?.data as Record<string, unknown> | undefined
            const inputVals = presInputValues[item.nodeId]
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
  }, [outputItems, findFieldDef, nodeMap, presInputValues])

  // ---- Render output card (replicate PresentationView logic) ----
  const renderOutputCard = useCallback((node: WorkflowNode) => {
    // Social media format: show PlatformPreview with platform badge
    if (node.type === "social-media-format") {
      const nodeData = node.data as Record<string, unknown>
      const result = getFullscreenResult(node.id)
      const status = getNodeStatus(node.id)
      const platform = (nodeData.platform as string) ?? "instagram"
      return (
        <div
          key={node.id}
          className="rounded-lg border border-border bg-card overflow-hidden cursor-pointer"
          onClick={() => setConfigNode(node)}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-foreground">{getCardTitle(node)}</span>
            <div className="flex items-center gap-2">
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: (PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] ?? "#888") + "20",
                  color: PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] ?? "#888",
                }}
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

    // Config-type output nodes open a modal
    if (node.type && CONFIG_INPUT_TYPES.has(node.type)) {
      const label = getCardTitle(node)
      const resultData = getNodeResult(node.data as Record<string, unknown>)
      const mediaType = getOutputType(node.type)
      return (
        <button
          key={node.id}
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

    // Standard output card
    const outputType = getOutputType(node.type)
    const status = getNodeStatus(node.id)
    const result = getFullscreenResult(node.id)
    const progress = combinedProgress[node.id]
    const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
    const cardDisplay = settings.cardMeta?.[node.id]?.display
    const elementSize = cardDisplay?.elementSize ?? nodeDisplay?.elementSize ?? "md"
    const fieldBadges = fieldBadgesByNode.get(node.id)
    const displayMode = settings.outputDisplayModes?.[node.id] ?? "individual"
    const { listResults, iterationTotal, iterationCompleted } = getListResults(node)

    // Gallery mode: single card with all results
    if (listResults && listResults.length > 1 && displayMode === "gallery") {
      return (
        <OutputCard
          key={node.id}
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
            />
          ))}
        </div>
      )
    }

    return (
      <OutputCard
        key={node.id}
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
      />
    )
  }, [getNodeStatus, getFullscreenResult, getCardTitle, handleOpenMedia, combinedProgress, settings.cardMeta, fieldBadgesByNode, settings.outputDisplayModes, getListResults])

  // ---- Item-based output renderer (mirrors PresentationView renderOutputItem) ----
  const renderOutputItem = useCallback(
    (item: PresentationItem): React.ReactNode => {
      switch (item.type) {
        case "node":
        case "output": {
          const node = nodeMap.get(item.nodeId)
          if (!node) return null
          return renderOutputCard(node)
        }
        case "field":
          return null
        case "richtext":
          return <RichtextBlock content={item.content} />
        case "group":
          return (
            <GroupCard
              title={item.title}
              showTitle={item.showTitle ?? true}
              showBackground={item.showBackground ?? true}
            >
              {item.items.map((child) => (
                <div key={child.type === "node" ? child.nodeId : child.id}>
                  {renderOutputItem(child)}
                </div>
              ))}
            </GroupCard>
          )
        default:
          return null
      }
    },
    [nodeMap, renderOutputCard],
  )

  // ---- View props for override views (gallery/fullscreen/compare) ----
  const viewProps = useMemo(() => ({
    orderedInputNodes,
    orderedOutputNodes,
    getNodeStatus,
    getResult: getFullscreenResult,
    getCardTitle,
    onOpenMedia: handleOpenMedia,
    onOpenConfig: setConfigNode,
  }), [orderedInputNodes, orderedOutputNodes, getNodeStatus, getFullscreenResult, getCardTitle, handleOpenMedia])

  // ---- Version data ----
  const versions = runSlots.versions
  const hasMultipleVersions = versions.length > 1

  // ---- Header ----
  const executionStatusForHeader = presExecutionStatus === "loading" ? "idle" : presExecutionStatus

  // ---- Content height accounting for header + tab bar + sticky action ----
  // Header ~48px, tab bar ~56px, sticky action ~56px
  const showStickyAction = activeTab === "inputs" && !isInputFocused && !inputsReadOnly && !isViewOverride
  const bottomPadding = showStickyAction ? "calc(112px + var(--safe-area-bottom, 0px))" : "calc(56px + var(--safe-area-bottom, 0px))"

  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header */}
      <MobileAppHeader
        appName={app.name}
        completedNodes={presCompletedNodes}
        totalNodes={presTotalNodes}
        executionStatus={executionStatusForHeader}
        userId={user?.id}
        userEmail={user?.email ?? undefined}
        onSignIn={handleSignIn}
        onSignOut={async () => {
          const supabase = (await import("@/lib/supabase")).createClient()
          await supabase.auth.signOut()
          // Stay on the app page instead of redirecting to /login
        }}
        onGetCredits={() => setShowGetCreditsModal(true)}
        onNewRun={() => {
          if (!user) {
            openLoginPopup(() => {
              runSlots.handleCreateNew()
              setActiveTab("inputs")
            })
            return
          }
          runSlots.handleCreateNew()
          setActiveTab("inputs")
        }}
        supportsRemix={appSupportsRemix}
        onRemix={handleRemix}
        isRemixing={isRemixing}
        nodes={presNodes}
        presentationSettings={settings}
        onUpdateSettings={updatePresPresentationSettings}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        allowedModes={allowedModes}
        versions={versions}
        selectedVersion={runSlots.selectedVersion}
        onSelectVersion={runSlots.setSelectedVersion}
        latestVersion={runSlots.latestVersion}
      />

      {/* Content area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto"
        style={{
          paddingTop: "calc(48px + var(--safe-area-top, 0px))",
          paddingBottom: isViewOverride ? "0px" : bottomPadding,
        }}
      >
        {isViewOverride ? (
          // View mode override: render the full view component
          viewMode === "gallery" ? (
            <GalleryView {...viewProps} />
          ) : viewMode === "fullscreen" ? (
            <div onTouchStart={handleOutputTouchStart} onTouchEnd={handleOutputTouchEnd}>
              <FullscreenView {...viewProps} onBack={handleExitViewOverride} />
            </div>
          ) : viewMode === "compare" ? (
            <CompareView
              {...viewProps}
              initialLeft={settings.compareLeft}
              initialRight={settings.compareRight}
            />
          ) : null
        ) : activeTab === "inputs" ? (
          // Inputs tab
          <div className="space-y-4 p-4">
            {orderedInputNodes.length === 0 && !useItemsRendering ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Play className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">This app runs automatically</p>
              </div>
            ) : useItemsRendering ? (
              inputItems!.map((item) => {
                const key = item.type === "node" ? item.nodeId : item.id
                return <div key={key}>{renderInputItem(item)}</div>
              })
            ) : (
              orderedInputNodes.map((node) => {
                const nodeDisplay = (node.data as Record<string, unknown>).presentationDisplay as PresentationDisplay | undefined
                const cardDisplay = settings.cardMeta?.[node.id]?.display
                const display = { ...nodeDisplay, ...cardDisplay }
                return (
                  <InputCard
                    key={node.id}
                    node={node}
                    isFullscreen
                    inputValues={presInputValues}
                    onUpdateInput={presUpdateInput}
                    readOnly={inputsReadOnly || isRunning}
                    onOpenMedia={handleOpenMedia}
                    onOpenConfig={setConfigNode}
                    display={display}
                    nodes={presNodes}
                    edges={presEdges}
                  />
                )
              })
            )}
          </div>
        ) : activeTab === "outputs" ? (
          // Outputs tab
          <div className="space-y-4 p-4">
            {orderedOutputNodes.length === 0 && !useOutputItemsRendering && !isRunning ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">Run the app to see results here</p>
              </div>
            ) : useOutputItemsRendering ? (
              outputItems!.map((item) => {
                const key = item.type === "node" ? item.nodeId : item.id
                const rendered = renderOutputItem(item)
                if (!rendered) return null
                return <div key={key}>{rendered}</div>
              })
            ) : (
              orderedOutputNodes.map((node) => renderOutputCard(node))
            )}
          </div>
        ) : activeTab === "runs" ? (
          // Runs tab
          <div className="flex flex-col">
            {/* Version picker (if multiple versions) */}
            {hasMultipleVersions && (
              <div className="px-4 pb-2">
                <select
                  value={runSlots.selectedVersion ?? ""}
                  onChange={(e) => runSlots.setSelectedVersion(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">v{runSlots.latestVersion} (latest)</option>
                  {versions
                    .filter((v) => v.version !== runSlots.latestVersion)
                    .map((v) => (
                      <option key={v.id} value={v.version}>
                        v{v.version} - {new Date(v.createdAt).toLocaleDateString()}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Slot list */}
            <div className="flex-1">
              {runSlots.slots.map((slot) => (
                <RunSlotItem
                  key={slot.id}
                  slot={slot}
                  isActive={slot.id === runSlots.activeSlotId}
                  hasMultipleVersions={hasMultipleVersions}
                  onSelect={() => {
                    runSlots.handleSelectSlot(slot.id)
                    setActiveTab("outputs")
                  }}
                  onDuplicate={() => runSlots.handleDuplicateSlot(slot.id)}
                  onDelete={() => runSlots.handleRequestDelete(slot.id)}
                  onRename={(name) => runSlots.handleRenameSlot(slot.id, name)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Sticky action bar (inputs tab only) */}
      {!isViewOverride && (
        <MobileStickyAction
          isRunning={isRunning}
          isAuthenticated={!!user}
          allInputsFilled={allInputsFilled}
          needsMoreCredits={needsMoreCredits}
          costLabel={costLabel}
          onRun={handleRunClick}
          onCancel={cancel}
          onNewRun={user ? () => { runSlots.handleHeaderAction(); setActiveTab("inputs") } : undefined}
          newRunLabel={runSlots.newRunLabel}
          onGetCredits={() => setShowGetCreditsModal(true)}
          inputsReadOnly={inputsReadOnly}
          hidden={activeTab !== "inputs" || isInputFocused}
        />
      )}

      {/* Tab bar */}
      {!isViewOverride && (
        <MobileTabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          showRunsTab={!!user}
          hasUnseenOutputs={hasUnseenOutputs}
          runCount={runSlots.slots.length}
          hidden={isInputFocused}
        />
      )}

      {/* Config modal for config-type nodes */}
      <NodeConfigModal
        node={configNode}
        open={configNode !== null}
        onOpenChange={(open) => { if (!open) setConfigNode(null) }}
      />

      {/* Media lightbox */}
      <MediaPreviewModal
        isOpen={!!lightboxItem}
        onClose={() => setLightboxNodeId(null)}
        type={lightboxItem?.type ?? "image"}
        url={lightboxItem?.url ?? ""}
        currentIndex={lightboxIndex >= 0 ? lightboxIndex : undefined}
        totalCount={mediaItems.length > 0 ? mediaItems.length : undefined}
        onPrev={lightboxIndex > 0 ? handleLightboxPrev : undefined}
        onNext={lightboxIndex < mediaItems.length - 1 ? handleLightboxNext : undefined}
      />

      {/* Get Credits modal */}
      {hasCredits() && (
        <GetCreditsModal
          open={showGetCreditsModal}
          onClose={() => setShowGetCreditsModal(false)}
          tier={userCredits?.tier ?? "free"}
          balance={userCredits?.total ?? 0}
          required={estimatedCost}
        />
      )}

      {/* Delete confirmation dialog is hoisted to AppRunnerPage — shared by both layouts */}
    </div>
  )
}
