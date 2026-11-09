import { useEffect, useLayoutEffect, type ComponentType, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { HEADER_EVENTS, HEADER_TAG, HeaderFallback, LOADER_URL, closeHeaderOverlays, onHeaderFailure, useHeaderNavigation } from "virtual:hosted-header"
import type { SiteHeaderSlotProps } from "@/components/layout/site-header-slot"
import { useUiLanguage } from "@/hooks/use-ui-language"
import { markSharedHeaderFailed, markSharedHeaderMounted } from "@/lib/shared-header"

/**
 * The app's mount of the hosted Nodaro header on Nodaro's own deployments
 * (reached only through `components/layout/site-header-slot.tsx`, inside
 * `DashboardLayout`). A white-label deployment keeps the npm header
 * (`white-label-header.tsx`): the hosted element has no white-label mode.
 *
 * The page says only which page it is on: the element and its one attribute.
 * Everything else — the links, the words, the menus, the balance, the session —
 * is the header's own, loaded live, so a change to it needs no change here.
 * What stays here is what only the page can do:
 *
 *   - its links to this app's routes go through the router;
 *   - a language picked in the header switches the app in place;
 *   - signing out lands on this app's sign-in page, as it always has (a
 *     reload would send the next sign-in back to this account's page);
 *   - a header overlay and the app's sidebar drawer never stack;
 *   - if the header cannot draw (its loader did not load, the header says it
 *     failed, or nothing defined it after 4 s), the gate closes
 *     (`markSharedHeaderFailed`) and the app goes back to its own chrome;
 *   - the app's own accessibility menu steps aside only once the header has
 *     drawn (a failed or still-loading header never hides it).
 */

/** The element, as JSX: the package declares it for itself in `JSX.IntrinsicElements`, and this app typechecks without the package. */
const NodaroHeader = HEADER_TAG as unknown as ComponentType<{ readonly page: string; readonly children?: ReactNode }>

type HostedHeaderProps = Pick<SiteHeaderSlotProps, "compact" | "onHeaderOverlay" | "drawerOpen"> & Partial<Pick<SiteHeaderSlotProps, "onOpenMenu">>

/** The loader's tag (and a preconnect to its origin), added once for the page's life. */
function addHeaderLoader(): void {
  if (!LOADER_URL || document.querySelector(`script[src="${LOADER_URL}"]`)) return
  const preconnect = document.createElement("link")
  preconnect.rel = "preconnect"
  preconnect.href = new URL(LOADER_URL).origin
  preconnect.crossOrigin = ""
  document.head.appendChild(preconnect)
  const loader = document.createElement("script")
  loader.type = "module"
  loader.async = true
  loader.src = LOADER_URL
  document.head.appendChild(loader)
}

export default function HostedHeader({ compact, onHeaderOverlay, drawerOpen }: HostedHeaderProps) {
  const navigate = useNavigate()
  const { rows, pick } = useUiLanguage()

  useHeaderNavigation(navigate)
  useEffect(() => addHeaderLoader(), [])
  // The header's failure hands the page back its own chrome (the gate closes).
  useEffect(() => onHeaderFailure(() => markSharedHeaderFailed()), [])

  // The events go out on the element and cross the shadow boundary, so a
  // listener on `window` hears them all without holding a ref to the element.
  useEffect(() => {
    const onOverlay = (event: Event) => {
      if ((event as CustomEvent<{ readonly open: string | null }>).detail?.open) onHeaderOverlay()
    }
    window.addEventListener(HEADER_EVENTS.overlay, onOverlay)
    return () => window.removeEventListener(HEADER_EVENTS.overlay, onOverlay)
  }, [onHeaderOverlay])

  // The app's drawer opening closes the header's overlays: the two never stack.
  useEffect(() => {
    if (drawerOpen) closeHeaderOverlays()
  }, [drawerOpen])

  // A language the app offers switches in place; the header has already saved
  // the shared cookie (and the account's language), so any other id is left to
  // its default: a reload boots the app in the saved language.
  useEffect(() => {
    const onLanguage = (event: Event) => {
      const id = (event as CustomEvent<{ readonly id: string }>).detail?.id
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) return
      event.preventDefault()
      pick(row.id)
    }
    window.addEventListener(HEADER_EVENTS.language, onLanguage)
    return () => window.removeEventListener(HEADER_EVENTS.language, onLanguage)
  }, [rows, pick])

  // A sign-out lands on this app's sign-in page, as it always has. The
  // header's default is a reload, after which the layout would send the next
  // sign-in back to the previous account's page (`loginPathFor`).
  useEffect(() => {
    const onSignedOut = (event: Event) => {
      event.preventDefault()
      navigate("/login")
    }
    window.addEventListener(HEADER_EVENTS.signedOut, onSignedOut)
    return () => window.removeEventListener(HEADER_EVENTS.signedOut, onSignedOut)
  }, [navigate])

  // Mounted (the app's accessibility menu steps aside) only once the header
  // has drawn: a layout effect, so it runs before the header can say so.
  useLayoutEffect(() => {
    let release: (() => void) | null = null
    const onReady = () => {
      release ??= markSharedHeaderMounted()
    }
    window.addEventListener(HEADER_EVENTS.ready, onReady)
    return () => {
      window.removeEventListener(HEADER_EVENTS.ready, onReady)
      release?.()
    }
  }, [])

  return (
    <NodaroHeader page={compact ? "flow-canvas" : "flow"}>
      <HeaderFallback />
    </NodaroHeader>
  )
}
