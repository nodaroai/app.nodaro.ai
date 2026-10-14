/**
 * What a use-case run is refused with BEFORE its wrapper, fee hold or any
 * inner job exists:
 *  - a self-hosted install that is not connected, when the built graph has a
 *    cloud-exclusive step (Edit Plan): the relay shims' own 503;
 *  - a transcribe step with no local key that the connection does not cover:
 *    the honest keyless message the worker would otherwise fail with later.
 * On cloud the exclusive steps run in-process, so only the key check applies.
 */
import type { UseCaseGraph } from "@nodaro/render-rules"
import { hasCredits } from "../config.js"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "../cloud-only-nodes.js"
import { nodaroConnectionRefusal, type NodaroConnectionRefusal } from "../nodaro-connection-gate.js"
import { transcribeLaneKey, transcribeLaneKeyName } from "../transcribe-lane-key.js"
import { MissingProviderKeyError } from "../../providers/provider-keys.js"

export type UseCasePreflightRefusal = NodaroConnectionRefusal

export async function usecasePreflight(graph: UseCaseGraph): Promise<UseCasePreflightRefusal | null> {
  if (!hasCredits() && graph.nodes.some((n) => NODARO_EXCLUSIVE_NODE_TYPES.has(n.type))) {
    const refusal = await nodaroConnectionRefusal()
    if (refusal) return refusal
  }
  for (const node of graph.nodes) {
    if (node.type !== "transcribe") continue
    const provider = typeof node.data.provider === "string" ? node.data.provider : undefined
    const key = transcribeLaneKey(provider)
    if (typeof key === "string" && key.trim().length > 0) continue
    const { shouldRunOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
    if (await shouldRunOnCloud(key)) continue
    const err = new MissingProviderKeyError(transcribeLaneKeyName(provider), "Transcribe")
    return { status: 503, code: err.code, message: err.message }
  }
  return null
}
