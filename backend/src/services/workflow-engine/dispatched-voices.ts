/**
 * What a speech node dispatches, read the way `buildPayload` reads it: the
 * one spelling shared by the builder's speech cases, which send and vet the
 * voices, and the workflow engine's pre-resolution for the voice lock
 * (`node-executor.ts`), which looks those voices up before the synchronous
 * build. Its own module, so the executor reads it without importing the
 * builder (which its tests replace).
 */
import { carriedNodeSettings } from "@nodaro/render-rules"
import { withRunningVideoProvider } from "./normalize-node-types.js"
import type { ResolvedInputs, SimpleEdge, SimpleNode } from "./types.js"

/**
 * The node as `buildPayload` builds it: its carried per-wire settings applied
 * (`carriedNodeSettings`) and a retired video model run as the model it
 * became. One spelling, so a caller that reads ahead of the build (the voice
 * lock's pre-resolution) reads the same node the build does.
 */
export function nodeAsBuilt(rawNode: SimpleNode, edges: readonly SimpleEdge[]): SimpleNode {
  return withRunningVideoProvider(carriedNodeSettings(rawNode, edges))
}

/**
 * The voice a text-to-speech node dispatches: the auto-wired voice (an
 * upstream Character's), else the node's own `voiceId`, else its `voice`.
 * Empty = the worker's default voice, which the voice policy owns. Takes the
 * values, not the node, so the builder's case keeps its own `data.<key>`
 * reads (the published-app settings guard reads those).
 */
export function ttsVoiceOf(autoWired: unknown, voiceId: unknown, voice: unknown): unknown {
  return autoWired || voiceId || voice
}

/**
 * The voice a Voice Changer node converts its clip INTO: the node's `voiceId`,
 * else its legacy `voice`. Empty = the funnel's default voice, which the voice
 * policy owns (`resolveDirectVoiceId`). Takes the values, like `ttsVoiceOf`.
 */
export function voiceChangerVoiceOf(voiceId: unknown, voice: unknown): unknown {
  return voiceId || voice
}

/** A text-to-dialogue node's lines that have text (an empty line is dropped, as the editor drops it). */
export function dialogueLinesOf(lines: unknown): Array<{ text: string; voice?: string }> | undefined {
  return (lines as Array<{ text: string; voice?: string }> | undefined)?.filter((l) => l.text?.trim())
}

/** The voices among `values` there is something to judge about: the non-empty strings. */
export function voicesToJudge(values: readonly unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0)
}

/**
 * Every voice a speech node of `type` will dispatch; [] for any other node
 * type. The same helpers the builder's speech cases send with, so the voices
 * resolved ahead of the build are the voices the build vets and sends (a
 * parity test pins it); a drift would only leave a voice unresolved, which the
 * lock refuses.
 */
export function dispatchedVoicesOf(type: string, data: SimpleNode["data"], resolvedInputs: ResolvedInputs): string[] {
  if (type === "text-to-speech") return voicesToJudge([ttsVoiceOf(resolvedInputs.voice, data.voiceId, data.voice)])
  if (type === "text-to-dialogue") return voicesToJudge((dialogueLinesOf(data.dialogue ?? data.script) ?? []).map((l) => l.voice))
  if (type === "voice-changer") return voicesToJudge([voiceChangerVoiceOf(data.voiceId, data.voice)])
  return []
}

/**
 * The voices `buildPayload` will dispatch for `rawNode` — `dispatchedVoicesOf`
 * on the node as built (`nodeAsBuilt`). What the workflow engine resolves
 * ahead of the build (the builder is synchronous) and hands in as
 * `voiceGenders`.
 */
export function voicesTheBuildDispatches(rawNode: SimpleNode, resolvedInputs: ResolvedInputs, edges: readonly SimpleEdge[] = []): string[] {
  const node = nodeAsBuilt(rawNode, edges)
  return dispatchedVoicesOf(node.type, node.data, resolvedInputs)
}
