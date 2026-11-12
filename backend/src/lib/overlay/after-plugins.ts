/**
 * The overlay's checks that must wait for the private plugins (lib/overlay/load.ts):
 * a leaf registry, so the plugin loader runs them without importing the
 * overlay loader. The overlay loader registers its check when it starts a
 * load; `loadPrivatePlugins` runs whatever is registered after every load. With
 * no overlay (mainline), nothing is registered and the run is a no-op.
 */

let check: (() => Promise<void>) | null = null

/** Registered by the overlay loader: what to judge once the plugins have loaded. */
export function setOverlayCheckAfterPlugins(fn: () => Promise<void>): void {
  check = fn
}

/** Run by `loadPrivatePlugins` after every load: the overlay's registered check, if any. */
export async function runOverlayChecksAfterPlugins(): Promise<void> {
  if (check) await check()
}

/** Test hook: forget the registered check. */
export function resetOverlayChecksAfterPluginsForTests(): void {
  check = null
}
