/**
 * Core shim for the home page's Copilot composer.
 *
 * Same rule as the editor rail (`copilot-panel-slot.tsx`): core may not import
 * from `ee/`, so the component arrives through `lazy()` and the import factory
 * is only ever constructed on a build that has credits. A community build
 * renders nothing and requests no chunk — and renders nothing with no layout
 * shift, since the slot itself is the only thing in the tree.
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
  // No fallback height: a placeholder that then collapses would push the
  // whole grid down and back on every visit.
  return (
    <Suspense fallback={null}>
      <Composer />
    </Suspense>
  )
}
