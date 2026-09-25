import type { RecipeTable } from "./types.js"

/**
 * LEAF module (imports only a type): the `get_recipe` MCP tool reads plugin
 * recipes from here without pulling in `load.ts`'s toolkit graph. Set by
 * every `loadPrivatePlugins()` outcome — cleared on community/business, a
 * failed load, or an optional-mode skip.
 */
let pluginRecipes: RecipeTable = {}

export function setPluginRecipes(t: RecipeTable): void {
  pluginRecipes = t
}

export function getPluginRecipes(): RecipeTable {
  return pluginRecipes
}
