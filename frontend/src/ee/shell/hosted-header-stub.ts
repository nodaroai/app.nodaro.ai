/**
 * `virtual:hosted-header` on every build without the header package
 * (community, business, public CI, a cloud build with the flag off) and in
 * tests. Nothing reaches it at run time: the hosted mount is imported only on a
 * build that shows Nodaro's header (`components/layout/site-header-slot.tsx`),
 * and the resolver forces that flag off whenever this stub is what the build
 * got. Its loader address is empty, so no such bundle can name the header's
 * real one.
 */

export const hostedHeaderAvailable = false
export const LOADER_URL = ""
export const HEADER_TAG = "nodaro-header"
export const HEADER_EVENTS = Object.freeze({
  navigate: "nodaro-header:navigate",
  language: "nodaro-header:language",
  signedOut: "nodaro-header:signed-out",
  overlay: "nodaro-header:overlay",
  ready: "nodaro-header:ready",
  failed: "nodaro-header:failed",
} as const)

export function HeaderFallback(): null {
  return null
}

export function useHeaderNavigation(): void {
  // No header on this build, so there are no links to take.
}

export function onHeaderFailure(): () => void {
  return () => {}
}

export function closeHeaderOverlays(): void {
  // No header on this build, so no overlay is ever open.
}
