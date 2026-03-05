/**
 * Embed page — lightweight app runner for iframe embedding.
 * No header, compact layout, theme query param, postMessage API.
 */

import { useEffect } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

export default function EmbedPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { loading: authLoading } = useAuth()
  const theme = searchParams.get("theme") ?? "dark"

  const loadApp = useAppRunnerStore((s) => s.loadApp)
  const app = useAppRunnerStore((s) => s.app)
  const loading = useAppRunnerStore((s) => s.loading)
  const errorMessage = useAppRunnerStore((s) => s.errorMessage)
  const executionStatus = useAppRunnerStore((s) => s.executionStatus)
  const nodeStates = useAppRunnerStore((s) => s.nodeStates)
  const completedNodes = useAppRunnerStore((s) => s.completedNodes)
  const totalNodes = useAppRunnerStore((s) => s.totalNodes)
  const appRun = useAppRunnerStore((s) => s.run)
  const updateInputValue = useAppRunnerStore((s) => s.updateInputValue)
  const reset = useAppRunnerStore((s) => s.reset)

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme !== "light")
  }, [theme])

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
    usePresentationStore.setState({ run: appRun })
  }, [appRun])

  // postMessage API — listen for commands from parent frame
  useEffect(() => {
    const handler = (event: MessageEvent) => {
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
      }
    }

    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [updateInputValue, appRun])

  // Notify parent frame of execution status changes
  useEffect(() => {
    if (!window.parent || window.parent === window) return

    if (executionStatus === "completed") {
      // Collect outputs from node states
      const outputs: Record<string, unknown> = {}
      for (const [nodeId, state] of Object.entries(nodeStates)) {
        const s = state as { output?: Record<string, unknown> }
        if (s.output) {
          outputs[nodeId] = s.output
        }
      }
      window.parent.postMessage({ type: "nodaro:runComplete", outputs }, "*")
    } else if (executionStatus === "failed") {
      window.parent.postMessage({ type: "nodaro:runFailed", error: errorMessage }, "*")
    } else if (executionStatus === "running") {
      window.parent.postMessage({ type: "nodaro:runStarted" }, "*")
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

  return (
    <div className="h-screen overflow-hidden">
      <PresentationView mode="fullscreen" isOwner={false} />
    </div>
  )
}
