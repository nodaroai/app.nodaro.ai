/**
 * Core shim for the home page's Copilot composer.
 *
 * Same rule as the editor rail (`copilot-panel-slot.tsx`): core may not import
 * from `ee/`, so the component arrives through `lazy()` and the import factory
 * is only ever constructed on a build that has credits. A community build
 * renders nothing and requests no chunk.
 *
 * The composer itself is a FIXED dock at the bottom of the viewport, so this
 * slot belongs at the END of the page: what it contributes to the flow is the
 * spacer that keeps the dock from covering the last row of cards.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"

let lazyComposer: ComponentType<Record<string, never>> | null = null

function resolveComposer() {
  if (!hasCredits()) return null
  lazyComposer ??= lazy(() => import("@/ee/components/copilot/copilot-home-composer")) as unknown as ComponentType<
    Record<string, never>
  >
  return lazyComposer
}

export function CopilotHomeSlot() {
  const Composer = resolveComposer()
  if (!Composer) return null
  // No fallback height: a placeholder that then collapses would jump the page
  // on every visit, and the dock measures its own spacer once it mounts.
  return (
    <Suspense fallback={null}>
      <Composer />
    </Suspense>
  )
}
