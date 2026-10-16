import type { PluginServices } from "./types.js"

/**
 * LEAF module (imports only a type): the merged `services` of the loaded
 * private plugins, set by every `loadPrivatePlugins()` outcome (load.ts) and
 * read by the core seams through `getPluginServices()`. Deliberately a module
 * singleton rather than threaded state: a seam (an auth hook, a billing
 * resolver) has no path back to the loader's return value, and both boot
 * paths that register seams — the API server and the workers — call
 * `loadPrivatePlugins()` exactly once at startup.
 *
 * Kept apart from load.ts (which re-exports the getter) so a seam that only
 * READS the services does not load the loader and, through it, the whole
 * plugin toolkit — the same split as engine-registry.ts / supports-registry.ts.
 */
let pluginServices: PluginServices = {}

/**
 * The private plugins' service surface, or `{}` when no plugin provided one
 * (community/business, a plugin-version lag, or a load that failed under
 * `PRIVATE_MODULES=optional`). Core seams MUST treat an absent member as
 * "this feature does not exist here" and return their inert answer.
 */
export function getPluginServices(): PluginServices {
  return pluginServices
}

/** Written only by load.ts — every load outcome, and the gen-skills stand-in. */
export function setPluginServices(services: PluginServices): void {
  pluginServices = services
}
