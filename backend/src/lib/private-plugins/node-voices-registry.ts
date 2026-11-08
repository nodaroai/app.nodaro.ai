import type { PluginNodeVoiceReader } from "./types.js"

/**
 * LEAF module (imports only a type): the voice readers the loaded plugins
 * declare, by node type (`nodeVoices()`, plugin → host). Under the
 * deployment's voice lock the workflow engine reads a plugin-served speech
 * node's voices with them before the node's job exists
 * (`plugin-node-voices.ts`), and the API answers the standalone orchestrator's
 * ask with them. Set by every `loadPrivatePlugins()` outcome — cleared on
 * community/business, a failed load, or an optional-mode skip.
 */
let readers: ReadonlyMap<string, PluginNodeVoiceReader> = new Map()
/** Whether this process ran `loadPrivatePlugins()` at all. The standalone
 *  orchestrator never does, so an empty registry there means "not known
 *  here", not "the plugin declares none" (`plugin-node-voices.ts`). */
let loaded = false

export function setPluginNodeVoiceReaders(next: ReadonlyMap<string, PluginNodeVoiceReader>): void {
  readers = next
  loaded = true
}

/** The reader declared for `type`, or undefined when none is. */
export function pluginNodeVoiceReaderOf(type: string): PluginNodeVoiceReader | undefined {
  return readers.get(type)
}

/** True once `loadPrivatePlugins()` has set the readers in this process. */
export function pluginNodeVoiceReadersLoaded(): boolean {
  return loaded
}

/** Test seam: forget the readers and that they were ever set. */
export function _resetPluginNodeVoiceReadersForTests(): void {
  readers = new Map()
  loaded = false
}
