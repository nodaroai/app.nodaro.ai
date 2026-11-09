/**
 * Core slot for the shared Nodaro site header (Cloud).
 *
 * Core may not statically import from `ee/`, so the mounts arrive through
 * `lazy(() => import(...))` — the pattern of `welcome-offer-popup-slot.tsx`.
 * The imports sit behind the flag READ IN THIS MODULE: Vite inlines
 * `import.meta.env.VITE_SHARED_HEADER`, so on a build without the flag (every
 * self-host build, production until the cut-over — and any build where the
 * resolver forced the flag off) the branches are dead and the headers' chunks
 * are never emitted; those builds never add the header's loader. Per page, the
 * gate (`lib/shared-header.ts`) decides which header shows, if any: the hosted
 * header on Nodaro's own deployments, the white-label mount where a
 * deployment's surface profile asks for its own (the hosted element has no
 * white-label mode). Embedded pages, and deployments that are neither Nodaro's
 * own nor asking for their own header, keep today's chrome.
 *
 * Each mount waits for the header's accessibility stylesheet as well as its
 * chunk (`linkSharedAccessibilityStylesheet`): the header draws its
 * accessibility menu only where those rules are on the page, and checks once,
 * when it mounts, while the app's own menu steps aside for it.
 *
 * If a header's chunk fails to load or the header throws, the boundary below
 * closes the gate (`markSharedHeaderFailed`): the layout, the sidebar and the
 * editor toolbar re-render with today's chrome — sign-out, credits, language
 * and theme included — instead of the route's error view. The hosted header
 * can also fail after this point (its files, loaded live): its mount closes
 * the gate on its failure event (`ee/shell/hosted-header.tsx`).
 *
 * Rendered by `DashboardLayout` only, so admin and every public route never get
 * the header (`__tests__/site-header-routes.test.ts`).
 */
import { Component, Suspense, lazy, type ComponentType, type ReactNode } from "react"
import { linkSharedAccessibilityStylesheet } from "@/lib/accessibility-preferences"
import { markSharedHeaderFailed, useSharedHeaderMode } from "@/lib/shared-header"
import { cn } from "@/lib/utils"

export interface SiteHeaderSlotProps {
  /** Editor pages: the header's one-row phone layout. */
  readonly compact: boolean
  /** Opens the sidebar drawer: the white-label header's leading button (the hosted header has no slot for one). */
  readonly onOpenMenu: () => void
  /** A header overlay opened: the app closes its drawer, so the two never stack. */
  readonly onHeaderOverlay: () => void
  /** The app's phone drawer is open: the hosted header closes its overlays, so the two never stack. */
  readonly drawerOpen: boolean
}

const HostedHeader: ComponentType<SiteHeaderSlotProps> | null =
  import.meta.env.VITE_SHARED_HEADER === "true"
    ? lazy(() => Promise.all([import("@/ee/shell/hosted-header"), linkSharedAccessibilityStylesheet()]).then(([header]) => header))
    : null

const WhiteLabelHeader: ComponentType<SiteHeaderSlotProps> | null =
  import.meta.env.VITE_SHARED_HEADER === "true" || import.meta.env.VITE_SHARED_HEADER === "white-label"
    ? lazy(() => Promise.all([import("@/ee/shell/white-label-header"), linkSharedAccessibilityStylesheet()]).then(([header]) => header))
    : null

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
  const mode = useSharedHeaderMode()
  const Header = mode === "default" ? HostedHeader : mode === "white-label" ? WhiteLabelHeader : null
  if (!Header) return null
  // While the chunk loads, hold the header's height so the page does not jump
  // (desktop: one 60 px row; phone: its 56 px top row under the safe area —
  // the reserve the hosted element holds; the white-label header's compact
  // row is 57 px). The phone's bottom bar is fixed: no height here.
  const placeholder = (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 h-[60px]",
        mode === "white-label" && props.compact ? "max-md:h-[calc(57px+env(safe-area-inset-top))]" : "max-md:h-[calc(56px+env(safe-area-inset-top))]",
      )}
    />
  )
  return (
    <HeaderFailureBoundary>
      <Suspense fallback={placeholder}>
        <Header {...props} />
      </Suspense>
    </HeaderFailureBoundary>
  )
}
