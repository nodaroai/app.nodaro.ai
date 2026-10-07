/**
 * The page the real-browser cut budget is measured on (review-cut.perf.spec.ts):
 * the review inspector open on the 3-hour episode, with the editor's store
 * subscribers mounted beside it, exactly as the jsdom budget test mounts them.
 * Built by vite.config.ts in production mode, so React's production build is
 * what is timed. It is never part of the app's own build.
 */
import "@/globals.css"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { ReviewInspector } from "@/components/edl-review/review-inspector"
import { EditorListeners, createWoke, type Woke } from "@/components/edl-review/__tests__/editor-listeners"
import { loadCanvas } from "@/components/edl-review/__tests__/review-canvas"
import { threeHourSession } from "@/lib/edl-review/__tests__/three-hour-fixture"

declare global {
  interface Window {
    /** What the spec reads: how often each editor subscriber has woken. */
    __reviewHarness?: { readonly woke: Woke }
  }
}

const { base, transcript } = threeHourSession()
loadCanvas({ plan: JSON.parse(JSON.stringify(base)) as Record<string, unknown>, transcript })

const woke = createWoke()
window.__reviewHarness = { woke }

createRoot(document.getElementById("root")!).render(
  <>
    <EditorListeners woke={woke} renderId="cut" />
    <ReviewInspector open renderId="cut" onClose={() => {}} />
    <Toaster />
  </>,
)
