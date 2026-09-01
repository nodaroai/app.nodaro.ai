/**
 * Core shim for the withheld-free-grant banner.
 *
 * Core code may not statically import from `ee/`, so the banner arrives through
 * `lazy(() => import(...))` — the same pattern as `copilot-panel-slot.tsx`. On a
 * community build `hasCredits()` is false, the import expression is never
 * evaluated, and the chunk is never requested. The banner itself renders
 * nothing unless the balance says the grant is withheld, so mounting it in the
 * app shell costs a cloud user one already-cached query read.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"

let lazyBanner: ComponentType | null = null
function resolveBanner() {
  if (!hasCredits()) return null
  lazyBanner ??= lazy(() =>
    import("@/ee/components/credits/FreeGrantWithheldBanner").then((m) => ({ default: m.FreeGrantWithheldBanner })),
  )
  return lazyBanner
}

export function FreeGrantBannerSlot() {
  const Banner = resolveBanner()
  if (!Banner) return null
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  )
}
