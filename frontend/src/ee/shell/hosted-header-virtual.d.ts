/**
 * `virtual:hosted-header` — resolved by `header-module-plugin.ts`: the hosted
 * Nodaro header's product side (its loader address, its events, the frozen
 * fallback and the small helpers every product shares) on a build that can
 * show it, a stub everywhere else. Typed here, by the names and shapes the app
 * uses, so public CI typechecks without the package;
 * `contract/props.contract.ts` holds each of them to the package's own.
 *
 * The event names are the contract's: frozen across header releases.
 */
declare module "virtual:hosted-header" {
  import type { ComponentType } from "react"

  /** True only when the build resolved the real package. */
  export const hostedHeaderAvailable: boolean
  /** Where the header's loader is: one address for every product and every environment. */
  export const LOADER_URL: string
  /** The one element a page renders. */
  export const HEADER_TAG: "nodaro-header"
  /** What the header says, on its element (the events bubble and cross the shadow boundary). */
  export const HEADER_EVENTS: {
    readonly navigate: "nodaro-header:navigate"
    readonly language: "nodaro-header:language"
    readonly signedOut: "nodaro-header:signed-out"
    readonly overlay: "nodaro-header:overlay"
    readonly ready: "nodaro-header:ready"
    readonly failed: "nodaro-header:failed"
  }
  /** The element's one child: shown by the reserve stylesheet only when the header cannot draw. */
  export const HeaderFallback: ComponentType
  /** The app's router takes the header's links to its own routes (same-origin; every path by default). */
  export function useHeaderNavigation(navigate: (path: string) => void, isOwnRoute?: (path: string) => boolean): void
  /** Calls `onFailure` once if the header cannot draw (failed, or still undefined after `afterMs`); returns the remover. */
  export function onHeaderFailure(onFailure: (reason: string) => void, afterMs?: number): () => void
  /** Closes any overlay the header has open (the app is about to open a sheet of its own). */
  export function closeHeaderOverlays(): void
}
