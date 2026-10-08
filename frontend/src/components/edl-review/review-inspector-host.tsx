"use client"

/**
 * The one place the review inspector is mounted in the editor (A3-5): the canvas
 * renders this, and every entry point — a render's Review cut, the context
 * menu, the Edit Plan's Expand, `?review=<id>` — opens the review through
 * `openReview` / the URL (`use-review-route.ts`). The inspector's code loads
 * when a review is first opened; until then the canvas carries only this shell.
 *
 * A tab kept open across a deploy asks for a chunk that no longer exists. The
 * load retries and reloads like every other lazy chunk in the app
 * (`lazyWithRetry`), and a load that still fails is contained HERE: a toast and
 * a closed review, never the canvas replaced by the editor's error screen.
 */
import { Component, Suspense, useEffect, type ReactNode } from "react"
import { toast } from "sonner"
import { useReviewOpenStore } from "@/hooks/use-review-open-store"
import { useReviewRoute } from "@/hooks/use-review-route"
import { tx } from "@/lib/i18n"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"

const ReviewInspector = lazy(() => import("./review-inspector").then((m) => ({ default: m.ReviewInspector })))

/** Turns a failed inspector (its chunk, or its render) into a toast and a closed review. */
class InspectorLoadBoundary extends Component<{ readonly onFail: () => void; readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    toast.error(tx("edlReview.openFailed"))
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function ReviewInspectorHost() {
  const setHostMounted = useReviewOpenStore((s) => s.setHostMounted)
  useEffect(() => {
    setHostMounted(true)
    return () => setHostMounted(false)
  }, [setHostMounted])

  const { renderId, close, changeRender } = useReviewRoute()
  if (!renderId) return null
  // Mounted only while a review is open, so a failure is forgotten with the close.
  return (
    <InspectorLoadBoundary onFail={close}>
      <Suspense fallback={null}>
        <ReviewInspector open renderId={renderId} onClose={close} onRenderChange={changeRender} />
      </Suspense>
    </InspectorLoadBoundary>
  )
}
