import { useSyncExternalStore } from "react"
import { isEmbedded } from "@/hooks/use-embed-session-handoff"
import { hasSharedHeader } from "@/lib/edition"
import {
  surfaceBillingSelfServe,
  surfaceConfiguredBrandName,
  surfacePlatformLinks,
  surfaceSidebarCreditCardHidden,
} from "@/lib/surface-selectors"

/**
 * Whether the shared Nodaro site header replaces the sidebar's own chrome (the
 * logo menu, the credit card, the user row, the language and theme switches,
 * the phone header) on this page. The ONE gate the layout, the sidebar and the
 * editor toolbar read, so they can never disagree about a page.
 *
 * On only when all hold:
 *   - a cloud build with VITE_SHARED_HEADER on (`hasSharedHeader()`; the build
 *     forces the flag off whenever the header itself is not in the bundle);
 *   - the page is not embedded: the products — and the header itself — frame
 *     this app's billing and settings pages, and a framed page never draws a
 *     header;
 *   - the deployment is Nodaro's own: no brand name of its own (white-label),
 *     Nodaro's platform links shown, self-serve billing (not prepaid), and the
 *     credit figure not hidden. Those deployments keep today's sidebar;
 *   - the header has not failed on this page (its chunk did not load, or it
 *     threw): then the app goes back to its own chrome rather than losing
 *     sign-out, credits, language and theme with no header to hold them.
 *
 * Only `DashboardLayout` mounts the header at all, so admin and every public
 * route (sign-in, shares, embeds, published apps) never get one either way.
 */

let headerFailed = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const readFailed = () => headerFailed

/** Called by the header's error boundary: the gate closes for the rest of this page's life. */
export function markSharedHeaderFailed(): void {
  if (headerFailed) return
  headerFailed = true
  for (const listener of listeners) listener()
}

/** Test seam: forget a failure recorded by an earlier test. */
export function resetSharedHeaderFailureForTests(): void {
  headerFailed = false
}

export function sharedHeaderActive(): boolean {
  return (
    !headerFailed &&
    hasSharedHeader() &&
    !isEmbedded() &&
    surfaceConfiguredBrandName() === undefined &&
    surfacePlatformLinks() &&
    surfaceBillingSelfServe() &&
    !surfaceSidebarCreditCardHidden()
  )
}

/** The gate for components: re-renders them when the header fails. */
export function useSharedHeaderActive(): boolean {
  useSyncExternalStore(subscribe, readFailed, readFailed)
  return sharedHeaderActive()
}

/*
 * Whether the header is MOUNTED on this page right now — narrower than the
 * gate: only `DashboardLayout` mounts it, so sign-in, shares, published apps
 * and admin have no header even where the gate is open. The header carries the
 * accessibility menu every product shares; where it is mounted, the app's own
 * menu steps aside (`AccessibilityMenuRoot`), and everywhere else it stays.
 * Set by the header's mount itself, once it rendered (a failed or still-loading
 * header never hides the app's menu).
 */
let headerMounts = 0
const mountListeners = new Set<() => void>()

function subscribeMounts(listener: () => void): () => void {
  mountListeners.add(listener)
  return () => {
    mountListeners.delete(listener)
  }
}

const readMounted = () => headerMounts > 0

/** Called by the header's mount when it renders; returns the unmount. */
export function markSharedHeaderMounted(): () => void {
  headerMounts += 1
  for (const listener of mountListeners) listener()
  let done = false
  return () => {
    if (done) return
    done = true
    headerMounts -= 1
    for (const listener of mountListeners) listener()
  }
}

/** Whether the shared header (and so its accessibility menu) is on this page. */
export function useSharedHeaderMounted(): boolean {
  return useSyncExternalStore(subscribeMounts, readMounted, readMounted)
}
