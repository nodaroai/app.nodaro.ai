/**
 * Core shim for the marketing-consent prompt.
 *
 * Core may not statically import from `ee/`, so the gate arrives through
 * `lazy(() => import(...))` — the same pattern as `free-grant-banner-slot.tsx`.
 * On community/business builds `hasCredits()` is false, the import expression is
 * never evaluated, and the chunk is never requested. Inside an embed (e.g.
 * studio's iframe of app billing) the nag is suppressed entirely.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"
import { isEmbedded } from "@/hooks/use-embed-session-handoff"

let lazyGate: ComponentType | null = null
function resolveGate() {
  if (!hasCredits()) return null
  lazyGate ??= lazy(() =>
    import("@/ee/components/consent/consent-gate").then((m) => ({ default: m.ConsentGate })),
  )
  return lazyGate
}

export function ConsentGateSlot() {
  if (isEmbedded()) return null
  const Gate = resolveGate()
  if (!Gate) return null
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  )
}
