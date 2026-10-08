import type { PluginSupports } from "./types.js"

/**
 * LEAF module (imports only a type): the merged `supports()` declaration of
 * the loaded plugins — what their own handlers can do (plugin → host). The
 * API server reads it at request time (`GET /v1/edit-plan/capabilities`), the
 * video worker gates edit-plan modes on it, and both go through
 * `editPlanModesOf()`, so the browser is offered exactly what the worker runs.
 * Set by every `loadPrivatePlugins()` outcome — cleared on community/business,
 * a failed load, or an optional-mode skip.
 */
let pluginSupports: PluginSupports = {}
/** Whether this process ran `loadPrivatePlugins()` at all. The standalone
 *  orchestrator never does, so an empty declaration there means "not known
 *  here", not "the plugin declares nothing" (`edit-plan-per-minute.ts`). */
let loaded = false

export function setPluginSupports(s: PluginSupports): void {
  pluginSupports = s
  loaded = true
}

export function getPluginSupports(): PluginSupports {
  return pluginSupports
}

/** True once `loadPrivatePlugins()` has set the declaration in this process. */
export function pluginSupportsLoaded(): boolean {
  return loaded
}

/** Test seam: forget the declaration and that it was ever set. */
export function _resetPluginSupportsForTests(): void {
  pluginSupports = {}
  loaded = false
}
