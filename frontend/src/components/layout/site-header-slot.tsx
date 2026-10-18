/**
 * Core slot for the shared Nodaro site header (Cloud).
 *
 * Core may not statically import from `ee/`, so the mount arrives through
 * `lazy(() => import(...))` — the pattern of `welcome-offer-popup-slot.tsx`.
 * The import sits behind the flag READ IN THIS MODULE: Vite inlines
 * `import.meta.env.VITE_SHARED_HEADER`, so on a build without the flag (every
 * self-host build, production until the cut-over — and any build where the
 * resolver forced the flag off) the branch is dead and the header's chunk is
 * never emitted. Per page, the gate (`lib/shared-header.ts`) decides
 * (embedded, white-label, prepaid pages keep today's chrome).
 *
 * If the header's chunk fails to load or the header throws, the boundary below
 * closes the gate (`markSharedHeaderFailed`): the layout, the sidebar and the
 * editor toolbar re-render with today's chrome — sign-out, credits, language
 * and theme included — instead of the route's error view.
 *
 * Rendered by `DashboardLayout` only, so admin and every public route never get
 * the header (`__tests__/site-header-routes.test.ts`).
 */
import { Component, Suspense, lazy, type ComponentType, type ReactNode } from "react"
import { markSharedHeaderFailed, useSharedHeaderActive } from "@/lib/shared-header"
import { cn } from "@/lib/utils"

export interface SiteHeaderSlotProps {
  /** Editor pages: the header's one-row phone layout. */
  readonly compact: boolean
  readonly onOpenMenu: () => void
  readonly onHeaderOverlay: () => void
}

const AppHeader: ComponentType<SiteHeaderSlotProps> | null =
  import.meta.env.VITE_SHARED_HEADER === "true" ? lazy(() => import("@/ee/shell/app-header")) : null

/** Catches a failed chunk or a throwing header: renders nothing and hands the page back its own chrome. */
class HeaderFailureBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    markSharedHeaderFailed()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export function SiteHeaderSlot(props: SiteHeaderSlotProps) {
  const active = useSharedHeaderActive()
  if (!AppHeader || !active) return null
  // While the chunk loads, hold the header's measured height so the page does
  // not jump (desktop 116 px; phone 119 px, or 61 px compact).
  const placeholder = (
    <div aria-hidden="true" className={cn("shrink-0 h-[116px]", props.compact ? "max-md:h-[61px]" : "max-md:h-[119px]")} />
  )
  return (
    <HeaderFailureBoundary>
      <Suspense fallback={placeholder}>
        <AppHeader {...props} />
      </Suspense>
    </HeaderFailureBoundary>
  )
}
