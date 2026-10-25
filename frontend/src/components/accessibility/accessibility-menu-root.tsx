import { useCallback, useSyncExternalStore } from "react"
import type { router as appRouter } from "@/router"
import { accessibilityStatementShown } from "@/lib/accessibility-statement"
import { useSharedHeaderMounted } from "@/lib/shared-header"
import { AccessibilityMenu } from "./accessibility-menu"

type AppRouter = typeof appRouter

/**
 * Mounts the accessibility menu once, beside the router (main.tsx renders it
 * outside <RouterProvider>), following the router's location so the button
 * knows the pages whose corners belong to a canvas. Shown where Nodaro runs the
 * service, the same gate as the accessibility statement it links to.
 *
 * Where the shared Nodaro site header is on the page, accessibility is the
 * header's: its menu is the one every product shares, so this one steps aside
 * (one button, one Alt+A). Everywhere else — every build without the header,
 * and the pages that have none (sign-in, shares, published apps, admin, an
 * embedded page, a header that failed) — this menu stays, keeping the same
 * choices as the header's (`lib/accessibility-preferences.ts`).
 */
export function AccessibilityMenuRoot({ router }: { readonly router: AppRouter }) {
  const subscribe = useCallback((onChange: () => void) => router.subscribe(onChange), [router])
  const pathname = useSyncExternalStore(subscribe, () => router.state.location.pathname)
  const headerMenuOnPage = useSharedHeaderMounted()
  if (!accessibilityStatementShown() || headerMenuOnPage) return null
  return (
    <AccessibilityMenu
      pathname={pathname}
      showStatementLink
      onNavigate={(path) => void router.navigate(path)}
    />
  )
}
