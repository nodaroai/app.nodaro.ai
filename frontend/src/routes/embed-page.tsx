/**
 * Embed page — lightweight app runner for iframe embedding.
 * No header, compact layout, theme query param, postMessage API.
 *
 * Theme can be set via:
 *   - URL query param: ?theme=light or ?theme=dark (default: dark)
 *   - postMessage: { type: "nodaro:setTheme", theme: "light" | "dark" }
 *
 * Features:
 *   - Run history sidebar (when authenticated)
 *   - Create/delete/duplicate/rename runs
 *   - Version selection
 *   - Touch event forwarding for mobile iframe scroll
 */

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { useTheme } from "next-themes"
import { Loader2, Clock } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { useRunSlots, AppRunnerLayout, RunsSidebar, ORIGINAL_SLOT_ID } from "@/components/app-runner"

export default function EmbedPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { setTheme } = useTheme()
  const themeParam = searchParams.get("theme")

  // Deep-linking query params
  const initialRunId = searchParams.get("run") ?? undefined
  const initialSidebar = searchParams.get("sidebar") as "open" | "closed" | null

  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const app = useAppRunnerStore((s) => s.app)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)
  const appRun = useAppRunnerStore((s) => s.run)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const updateInputValue = useAppRunnerStore((s) => s.updateInputValue)
  const reset = useAppRunnerStore((s) => s.reset)

  // Apply theme from URL param on mount
  useEffect(() => {
    if (themeParam === "light" || themeParam === "dark") {
      setTheme(themeParam)
    }
  }, [themeParam, setTheme])

  // Prevent internal scrolling and forward wheel + touch events to parent page.
  // Only apply overflow:hidden to html/body — NOT to .overflow-auto (needed for sidebar scroll).
  useEffect(() => {
    const style = document.createElement("style")
    style.setAttribute("data-embed-scroll", "")
    style.textContent = "html, body { overflow: hidden !important; overscroll-behavior: none; }"
    document.head.appendChild(style)

    const onWheel = (e: WheelEvent) => {
      if (window.parent && window.parent !== window) {
        // Try direct scrollBy first (works same-origin, no parent code needed)
        try {
          window.parent.scrollBy(e.deltaX, e.deltaY)
        } catch {
          // Cross-origin: fall back to postMessage (parent must listen)
          window.parent.postMessage(
            { type: "nodaro:wheel", deltaX: e.deltaX, deltaY: e.deltaY },
            "*",
          )
        }
      }
    }
    window.addEventListener("wheel", onWheel, { passive: true })

    // Touch event forwarding for mobile
    let touchStartY = 0
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) touchStartY = e.touches[0].clientY
    }
    const onTouchMove = (e: TouchEvent) => {
      if (window.parent && window.parent !== window && e.touches.length === 1) {
        const deltaY = touchStartY - e.touches[0].clientY
        touchStartY = e.touches[0].clientY
        try {
          window.parent.scrollBy(0, deltaY)
        } catch {
          window.parent.postMessage(
            { type: "nodaro:touch", deltaX: 0, deltaY },
            "*",
          )
        }
      }
    }
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })

    return () => {
      style.remove()
      window.removeEventListener("wheel", onWheel)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
    }
  }, [])

  // Load app — don't wait for auth (app is public)
  useEffect(() => {
    if (slug) loadApp(slug)
    return () => { reset() }
  }, [slug, loadApp, reset])

  // Sync to presentation store (structural data only —
  // nodeStates + executionStatus are managed by the auto-select in useRunSlots)
  useEffect(() => {
    if (!app) return
    const snapshotSettings = (app.snapshotSettings ?? {}) as Record<string, unknown>
    const presentationSettings = (snapshotSettings.presentationSettings ?? DEFAULT_PRESENTATION_SETTINGS) as PresentationSettings
    usePresentationStore.setState({
      workflowId: app.workflowId,
      workflowName: app.name,
      nodes: app.snapshotNodes as WorkflowNode[],
      edges: app.snapshotEdges as WorkflowEdge[],
      isOwner: false,
      estimatedCost: app.estimatedCredits,
      presentationSettings,
    })
  }, [app])

  // Run slots hook — all slot state, CRUD, DB sync
  const runSlots = useRunSlots({ slug, user, persistRuns: !!user, initialRunId, initialSidebar })

  // postMessage API — listen for commands from parent frame
  useEffect(() => {
    const allowedOrigins = new Set<string>()
    allowedOrigins.add(window.location.origin)
    const configuredOrigins = (app as Record<string, unknown> | null)?.allowedOrigins as string[] | undefined
    if (configuredOrigins) {
      for (const origin of configuredOrigins) allowedOrigins.add(origin)
    }

    const handler = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) return

      const data = event.data
      if (!data || typeof data !== "object" || !data.type) return

      switch (data.type) {
        case "nodaro:setInputs": {
          const inputs = data.inputs as Record<string, Record<string, unknown>> | undefined
          if (inputs) {
            for (const [nodeId, values] of Object.entries(inputs)) {
              for (const [key, value] of Object.entries(values)) {
                updateInputValue(nodeId, key, value)
              }
            }
          }
          break
        }
        case "nodaro:run": {
          appRun()
          break
        }
        case "nodaro:setTheme": {
          const theme = data.theme as string | undefined
          if (theme === "light" || theme === "dark") {
            setTheme(theme)
          }
          break
        }
      }
    }

    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [updateInputValue, appRun, setTheme, app])

  // Notify parent frame of execution status changes
  useEffect(() => {
    if (!window.parent || window.parent === window) return

    let targetOrigin = window.location.origin
    try {
      if (document.referrer) {
        targetOrigin = new URL(document.referrer).origin
      }
    } catch {
      // Invalid referrer — fall back to same-origin
    }

    if (executionStatus === "completed") {
      const outputs: Record<string, unknown> = {}
      for (const [nodeId, state] of Object.entries(nodeStates)) {
        const s = state as { output?: Record<string, unknown> }
        if (s.output) {
          outputs[nodeId] = s.output
        }
      }
      window.parent.postMessage({ type: "nodaro:runComplete", outputs }, targetOrigin)
    } else if (executionStatus === "failed") {
      window.parent.postMessage({ type: "nodaro:runFailed", error: errorMessage }, targetOrigin)
    } else if (executionStatus === "running") {
      window.parent.postMessage({ type: "nodaro:runStarted" }, targetOrigin)
    }
  }, [executionStatus, nodeStates, errorMessage])

  if (errorMessage && !app) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
      </div>
    )
  }

  if (!app) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <AppRunnerLayout
      showHistory={runSlots.showHistory && !!user}
      collapsed={runSlots.sidebarCollapsed}
      onCloseHistory={() => runSlots.setShowHistory(false)}
      sidebar={user ? (
        <RunsSidebar
          slots={runSlots.slots}
          activeSlotId={runSlots.activeSlotId}
          onSelectSlot={runSlots.handleSelectSlot}
          onCreateNew={runSlots.handleCreateNew}
          onDuplicateSlot={runSlots.handleDuplicateSlot}
          onDeleteSlot={runSlots.handleRequestDelete}
          onRenameSlot={runSlots.handleRenameSlot}
          onClose={runSlots.handleCloseSidebar}
          collapsed={runSlots.sidebarCollapsed}
          versions={runSlots.versions}
          selectedVersion={runSlots.selectedVersion}
          onSelectVersion={runSlots.setSelectedVersion}
          latestVersion={runSlots.latestVersion}
        />
      ) : null}
    >
      <PresentationView
        mode="fullscreen"
        isOwner={false}
        onCancel={cancel}
        onNewRun={user ? runSlots.handleHeaderAction : undefined}
        newRunLabel={runSlots.newRunLabel}
        inputsReadOnly={runSlots.inputsReadOnlyValue}
        suppressOutputFallback={runSlots.activeSlotId !== null && runSlots.activeSlotId !== ORIGINAL_SLOT_ID}
        showFullscreenToggle
        headerLeft={
          user && !runSlots.showHistory ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runSlots.setShowHistory(true)}
              className="h-8 border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted touch-manipulation shrink-0 md:hidden"
            >
              <Clock className="h-4 w-4 mr-1" />
              Runs
            </Button>
          ) : null
        }
      />

      {/* Delete confirmation dialog */}
      <Dialog open={runSlots.deleteConfirmSlotId !== null} onOpenChange={(open) => { if (!open) runSlots.setDeleteConfirmSlotId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Run</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this run? This action cannot be undone.
          </p>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => runSlots.setDeleteConfirmSlotId(null)} autoFocus>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runSlots.handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppRunnerLayout>
  )
}
