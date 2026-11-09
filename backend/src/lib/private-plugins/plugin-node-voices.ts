import { pluginNodeVoiceReaderOf, pluginNodeVoiceReadersLoaded } from "./node-voices-registry.js"
import type { PluginNodeVoiceReader } from "./types.js"

/**
 * The voices a workflow run of a plugin-served node will speak in, read with
 * the reader its plugin declares (`nodeVoices()`, see `PluginNodeVoiceReader`):
 * the voice lock's input for a node the workflow engine dispatches straight to
 * a plugin's handler, past the plugin's own route and its voice check. The
 * engine asks only under a lock (`pluginVoicesTheBuildDispatches`,
 * services/workflow-engine/dispatched-voices.ts).
 *
 *   - A process that loaded the plugins (the API server, whose in-process
 *     orchestrator runs workflows too): the reader itself.
 *   - The standalone orchestrator loads no plugin. At boot it registers a
 *     source (`setPluginNodeVoicesSource`) that asks this container's own API,
 *     which runs the same reader (`POST /v1/voices/internal/node-voices`).
 *   - Neither: no reader.
 *
 * `null` = no reader is declared for the type, which the engine refuses under
 * a lock (fail closed). A reader that throws or answers anything but a list of
 * strings, and an API that cannot be asked, THROW: a server error, never an
 * allow. The reader is handed JSON copies, so it sees the node exactly as the
 * API would receive it and can never change the node the engine builds.
 */

type NodeFields = Readonly<Record<string, unknown>>

/** How a process that loads no plugin asks for a reader's answer: `null` = none declared. */
export type PluginNodeVoicesSource = (type: string, data: NodeFields, inputs: NodeFields) => Promise<unknown>

export interface PluginNodeVoicesDeps {
  readersLoaded: () => boolean
  readerOf: (type: string) => PluginNodeVoiceReader | undefined
}

const defaultDeps: PluginNodeVoicesDeps = {
  readersLoaded: pluginNodeVoiceReadersLoaded,
  readerOf: pluginNodeVoiceReaderOf,
}

let source: PluginNodeVoicesSource | null = null

/** The standalone orchestrator's way to ask the API (registered once at boot). */
export function setPluginNodeVoicesSource(fn: PluginNodeVoicesSource | null): void {
  source = fn
}

export async function readPluginNodeVoices(
  type: string,
  data: NodeFields,
  inputs: NodeFields,
  deps: PluginNodeVoicesDeps = defaultDeps,
): Promise<string[] | null> {
  if (deps.readersLoaded()) return readDeclaredNodeVoices(type, data, inputs, deps)
  if (!source) return null
  const answer = await source(type, data, inputs)
  return answer === null ? null : checkedVoices(type, answer)
}

/** The reader this process loaded for `type`, run and checked; `null` when none is declared. What the API's route answers. */
export function readDeclaredNodeVoices(
  type: string,
  data: NodeFields,
  inputs: NodeFields,
  deps: PluginNodeVoicesDeps = defaultDeps,
): string[] | null {
  const reader = deps.readerOf(type)
  if (!reader) return null
  return checkedVoices(type, reader(jsonCopy(data), jsonCopy(inputs)))
}

/** A reader's answer as voice ids, or a throw: anything but a list of strings fails the node, never allows it. */
export function checkedVoices(type: string, voices: unknown): string[] {
  if (!Array.isArray(voices) || !voices.every((v) => typeof v === "string")) {
    throw new Error(`The voice reader declared for "${type}" did not answer a list of voice ids`)
  }
  return [...voices]
}

function jsonCopy(value: NodeFields): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>
}

/** Test seam — the source is process-global. */
export function _resetPluginNodeVoicesSourceForTests(): void {
  source = null
}
