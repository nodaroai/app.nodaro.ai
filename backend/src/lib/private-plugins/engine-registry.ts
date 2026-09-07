import type { PluginEngines } from "./types.js"

let engines: PluginEngines = {}

/** A small accessor keeps request-time seams independent of loader imports. */
export function getPluginEngines(): Readonly<PluginEngines> {
  return engines
}

export function setPluginEngines(value: PluginEngines): void {
  engines = { ...value }
}
