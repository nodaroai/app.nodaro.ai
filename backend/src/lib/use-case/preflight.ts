/**
 * What a use-case run is refused with BEFORE its wrapper, fee hold or any
 * inner job exists:
 *  - a self-hosted install that is not connected, when the built graph has a
 *    cloud-exclusive step (Edit Plan): the relay shims' own 503;
 *  - a transcribe step with no local key that the connection does not cover:
 *    the honest keyless message the worker would otherwise fail with later —
 *    a Transcribe node's lane, and the lane an Add Captions node set to
 *    transcribe for itself calls (its own, or the worker's default);
 *  - an Add Captions step set to transcribe for itself, where the deployment
 *    restricts models, whose engine it withholds or that has no engine
 *    offered at all (`model_not_available`), so the run is refused before
 *    the use case's fee is held, not when the step is built.
 * On cloud the exclusive steps run in-process, so only the key check applies.
 */
import type { UseCaseGraph } from "@nodaro/render-rules"
import { hasCredits } from "../config.js"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"
import { nodaroConnectionRefusal, type NodaroConnectionRefusal } from "../nodaro-connection-gate.js"
import { transcribeLaneKey, transcribeLaneKeyName } from "../transcribe-lane-key.js"
import { addCaptionsEngine } from "../add-captions-engine.js"
import { deniedModelRejectionMessage, isModelDenied, modelRestrictionConfigured } from "../surface-deny.js"
import { NO_CAPTION_ENGINE_OFFERED_MESSAGE } from "@nodaro/render-rules"
import { MissingProviderKeyError } from "../../providers/provider-keys.js"

export type UseCasePreflightRefusal =
  | NodaroConnectionRefusal
  /** A caption step whose transcription engine the deployment does not offer (decided 2026-11-15). */
  | { readonly status: 403; readonly code: "model_not_available"; readonly message: string }

const named = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/**
 * The transcribe lane a built node calls, or null when it transcribes nothing.
 * Add Captions transcribes only when set to; its data is read in both
 * spellings the run's payload reads (camelCase node data, snake_case API), and
 * a node that names no engine calls the one its run will (`addCaptionsEngine`).
 * Where the deployment offers no engine there is no lane to check: the node is
 * refused when it is built (`model_not_available`), like every step's model.
 */
function transcribeLaneOf(node: UseCaseGraph["nodes"][number]): string | undefined | null {
  if (node.type === "transcribe") return named(node.data.provider)
  if (node.type === "add-captions" && (node.data.autoTranscribe ?? node.data.auto_transcribe) === true) {
    return addCaptionsEngine(named(node.data.transcribeProvider) ?? named(node.data.transcribe_provider)) ?? null
  }
  return null
}

export async function usecasePreflight(graph: UseCaseGraph): Promise<UseCasePreflightRefusal | null> {
  if (!hasCredits() && graph.nodes.some((n) => NODARO_EXCLUSIVE_NODE_TYPES.has(n.type))) {
    const refusal = await nodaroConnectionRefusal()
    if (refusal) return refusal
  }
  if (modelRestrictionConfigured()) {
    for (const node of graph.nodes) {
      if (node.type !== "add-captions" || (node.data.autoTranscribe ?? node.data.auto_transcribe) !== true) continue
      const engine = addCaptionsEngine(named(node.data.transcribeProvider) ?? named(node.data.transcribe_provider))
      if (engine === undefined) return { status: 403, code: "model_not_available", message: NO_CAPTION_ENGINE_OFFERED_MESSAGE }
      if (isModelDenied(engine)) return { status: 403, code: "model_not_available", message: deniedModelRejectionMessage([engine]) }
    }
  }
  for (const node of graph.nodes) {
    const provider = transcribeLaneOf(node)
    if (provider === null) continue
    const key = transcribeLaneKey(provider)
    if (typeof key === "string" && key.trim().length > 0) continue
    const { shouldRunOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
    if (await shouldRunOnCloud(key)) continue
    const err = new MissingProviderKeyError(transcribeLaneKeyName(provider), node.type === "transcribe" ? "Transcribe" : "Add Captions")
    return { status: 503, code: err.code, message: err.message }
  }
  return null
}
