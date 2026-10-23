import { useCallback, useSyncExternalStore } from "react"
import type { router as appRouter } from "@/router"
import { accessibilityStatementShown } from "@/lib/accessibility-statement"
import { AccessibilityMenu } from "./accessibility-menu"

type AppRouter = typeof appRouter

/**
 * Mounts the accessibility menu once, beside the router (main.tsx renders it
 * outside <RouterProvider>), following the router's location so the button
 * knows the pages whose corners belong to a canvas. Shown where Nodaro runs the
 * service, the same gate as the accessibility statement it links to.
 */
export function AccessibilityMenuRoot({ router }: { readonly router: AppRouter }) {
  const subscribe = useCallback((onChange: () => void) => router.subscribe(onChange), [router])
  const pathname = useSyncExternalStore(subscribe, () => router.state.location.pathname)
  if (!accessibilityStatementShown()) return null
  return (
    <AccessibilityMenu
      pathname={pathname}
      showStatementLink
      onNavigate={(path) => void router.navigate(path)}
    />
  )
}
