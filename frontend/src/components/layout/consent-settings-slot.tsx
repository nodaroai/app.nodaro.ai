/**
 * Core shim for the Settings email-preferences toggle. Same lazy/`hasCredits()`
 * pattern as the other consent slot — community/business builds never request
 * the chunk. Renders nothing until the ee component resolves the user's status.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"

let lazyPanel: ComponentType | null = null
function resolvePanel() {
  if (!hasCredits()) return null
  lazyPanel ??= lazy(() =>
    import("@/ee/components/consent/consent-settings").then((m) => ({ default: m.ConsentSettings })),
  )
  return lazyPanel
}

export function ConsentSettingsSlot() {
  const Panel = resolvePanel()
  if (!Panel) return null
  return (
    <Suspense fallback={null}>
      <Panel />
    </Suspense>
  )
}
