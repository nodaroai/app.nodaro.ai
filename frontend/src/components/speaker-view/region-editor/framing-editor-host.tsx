"use client"

/**
 * The one place Speaker View's region editor is mounted (U4): the canvas
 * renders this beside the review inspector's host, and both ways in — the
 * panel's "Edit framing…" and `?framing=<nodeId>` — open it here. Its code
 * loads when it is first opened; a chunk that fails to load is a toast and a
 * closed editor, never the canvas replaced by the error screen.
 */
import { Component, Suspense, useEffect, type ReactNode } from "react"
import { toast } from "sonner"
import { useFramingOpenStore } from "@/hooks/use-framing-open-store"
import { useFramingRoute } from "@/hooks/use-framing-route"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"

const RegionEditorDialog = lazy(() => import("./region-editor-dialog").then((m) => ({ default: m.RegionEditorDialog })))

class EditorLoadBoundary extends Component<{ readonly onFail: () => void; readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    toast.error(tx("speakerView.framing.openFailed"))
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function FramingEditorHost() {
  const setHostMounted = useFramingOpenStore((s) => s.setHostMounted)
  useEffect(() => {
    setHostMounted(true)
    return () => setHostMounted(false)
  }, [setHostMounted])

  const { nodeId, close } = useFramingRoute()
  const label = useWorkflowStore((s) => {
    const node = nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined
    return node?.type === "speaker-view" ? String((node.data as { label?: unknown }).label ?? "Speaker View") : null
  })
  if (!nodeId || label === null) return null
  return (
    <EditorLoadBoundary key={nodeId} onFail={close}>
      <Suspense fallback={null}>
        <RegionEditorDialog key={nodeId} nodeId={nodeId} label={label} onClose={close} />
      </Suspense>
    </EditorLoadBoundary>
  )
}
