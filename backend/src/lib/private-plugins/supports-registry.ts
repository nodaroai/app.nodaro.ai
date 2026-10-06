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

export function setPluginSupports(s: PluginSupports): void {
  pluginSupports = s
}

export function getPluginSupports(): PluginSupports {
  return pluginSupports
}
