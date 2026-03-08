/**
 * Embed page — lightweight app runner for iframe embedding.
 * No header, compact layout, theme query param, postMessage API.
 *
 * Theme can be set via:
 *   - URL query param: ?theme=light or ?theme=dark (default: dark)
 *   - postMessage: { type: "nodaro:setTheme", theme: "light" | "dark" }
 */

import { useEffect } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { useTheme } from "next-themes"
import { Loader2, RotateCcw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { Button } from "@/components/ui/button"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export default function EmbedPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { loading: authLoading } = useAuth()
  const { setTheme } = useTheme()
  const themeParam = searchParams.get("theme")

  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const app = useAppRunnerStore((s) => s.app)
  const loading = useAppRunnerStore((s) => s.loading)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)
  const appRun = useAppRunnerStore((s) => s.run)
  const cancel = useAppRunnerStore((s) => s.cancel)
  const newRun = useAppRunnerStore((s) => s.newRun)
  const activeRunId = useAppRunnerStore((s) => s.activeRunId)
  const updateInputValue = useAppRunnerStore((s) => s.updateInputValue)
  const reset = useAppRunnerStore((s) => s.reset)

  // Apply theme from URL param on mount
  useEffect(() => {
    if (themeParam === "light" || themeParam === "dark") {
      setTheme(themeParam)
    }
  }, [themeParam, setTheme])

  // Load app
  useEffect(() => {
    if (!authLoading && slug) {
      loadApp(slug)
    }
    return () => { reset() }
  }, [authLoading, slug, loadApp, reset])

  // Sync to presentation store (same pattern as app-runner-page)
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
      executionStatus: "idle",
      nodeStates: {},
    })
  }, [app])

  useEffect(() => {
    usePresentationStore.setState({
      executionStatus,
      nodeStates,
      completedNodes,
      totalNodes,
    })
  }, [executionStatus, nodeStates, completedNodes, totalNodes])

  useEffect(() => {
    usePresentationStore.setState({
      run: createBridgedRun(() => usePresentationStore.getState().inputValues),
    })
  }, [appRun])

  // postMessage API — listen for commands from parent frame
  // Allowed origins are configured via the app's allowedOrigins field;
  // fallback: only accept messages from same origin.
  useEffect(() => {
    const allowedOrigins = new Set<string>()
    // Always allow same-origin
    allowedOrigins.add(window.location.origin)
    // Add app-configured origins if available
    const configuredOrigins = (app as Record<string, unknown> | null)?.allowedOrigins as string[] | undefined
    if (configuredOrigins) {
      for (const origin of configuredOrigins) allowedOrigins.add(origin)
    }

    const handler = (event: MessageEvent) => {
      // Validate origin — reject messages from untrusted origins
      if (!allowedOrigins.has(event.origin)) return

      const data = event.data
      if (!data || typeof data !== "object" || !data.type) return

      switch (data.type) {
        case "nodaro:setInputs": {
          // data.inputs: Record<string, Record<string, unknown>>
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
  // Use document.referrer origin or same-origin as target (not wildcard)
  useEffect(() => {
    if (!window.parent || window.parent === window) return

    // Determine target origin for postMessage
    let targetOrigin = window.location.origin
    try {
      if (document.referrer) {
        targetOrigin = new URL(document.referrer).origin
      }
    } catch {
      // Invalid referrer — fall back to same-origin
    }

    if (executionStatus === "completed") {
      // Collect outputs from node states
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

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (errorMessage && !app) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
      </div>
    )
  }

  if (!app) return null

  const isTerminal = executionStatus === "completed" || executionStatus === "failed"
  const showNewRun = isTerminal || activeRunId !== null

  return (
    <div className="h-screen overflow-hidden relative">
      {/* New Run floating button */}
      {showNewRun && (
        <div className="absolute top-[3.75rem] left-0 right-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="pointer-events-auto">
            <Button
              size="sm"
              onClick={newRun}
              className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white shadow-md"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              New Run
            </Button>
          </div>
        </div>
      )}
      <PresentationView mode="fullscreen" isOwner={false} onCancel={cancel} />
    </div>
  )
}
