/**
 * The one-shot KIE retry for a direct lane whose PLATFORM account refused
 * (balance/quota gone, key refused — `../llm-platform-exhaustion.ts`).
 */

import { getLlmModel, type LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import { LlmPlatformExhaustedError } from "../llm-errors.js"
import { callKie, streamKie } from "./kie-lane.js"
import { serveFromFallback, type LaneFallbackCtx } from "./lane-fallback.js"
import type { LlmRequest, LlmResponse } from "./types.js"

/**
 * Can KIE carry this request as it stands? Every registry model has a KIE
 * twin (`kieSlugOrModel` — the same model, served by the aggregator: the
 * registry IS the equivalence table, see `kieEquivalentOf`), but no KIE wire
 * carries inline video bytes, and a video/audio URL would reach it only as an
 * `image_url` stand-in — a differently-grounded answer, not the same call.
 * Text and images travel (`callKie` inlines image URLs where the wire needs it).
 */
export function kieCanCarry(req: LlmRequest): boolean {
  return req.messages.every((m) =>
    typeof m.content === "string" || m.content.every((b) => b.type !== "video_base64" && b.type !== "video" && b.type !== "audio"),
  )
}

/** The KIE model id a registry model is served as there — its own `kieSlugOrModel`. */
export function kieEquivalentOf(modelId: string): string | undefined {
  return getLlmModel(modelId)?.kieSlugOrModel
}

/**
 * KIE as the ONE retry for a DIRECT lane whose platform account refused —
 * even on a call pinned direct, because a pin chooses a lane for the answer's
 * sake, and a drained account gives no answer at all (staging 2026-10-14: the
 * UGC writer, pinned direct by the plugin host's multimodal default, failed
 * outright while KIE served the same model). Undefined when KIE cannot take
 * it: no key, the call is pinned to KIE already, or it carries media KIE
 * cannot carry ({@link kieCanCarry}).
 *
 * Billing is unchanged by it: the user's charge is the node's own reservation,
 * made before any lane ran; only the provider cost recorded follows the lane
 * that answered. KIE ignores a Claude reasoning effort, so an effort-bearing
 * call answered here runs at the model's default — logged, not refused.
 */
export function exhaustionKieFallback(model: LlmModelDef, req: LlmRequest): (() => Promise<LlmResponse>) | undefined {
  if (!config.KIE_API_KEY || req.requireLane === "kie" || !kieCanCarry(req)) return undefined
  return () => {
    if (req.reasoningEffort !== undefined) {
      console.warn(`[llm-lane-fallback] ${model.id}: reasoning effort ${req.reasoningEffort} is not honoured on the KIE lane`)
    }
    return callKie(model, req)
  }
}

/** Run a direct lane; on a platform-account refusal ONLY, serve once from KIE. */
export async function withExhaustionFallback(
  ctx: LaneFallbackCtx,
  primary: () => Promise<LlmResponse>,
  kie: (() => Promise<LlmResponse>) | undefined,
): Promise<LlmResponse> {
  try {
    return await primary()
  } catch (err) {
    if (!kie || !(err instanceof LlmPlatformExhaustedError)) throw err
    return serveFromFallback(ctx, err, kie)
  }
}

/** Streaming twin: only before the first token reached the caller. */
export async function streamWithExhaustionFallback(
  ctx: LaneFallbackCtx,
  primary: (onToken: (chunk: string) => void) => Promise<LlmResponse>,
  kie: ((onToken: (chunk: string) => void) => Promise<LlmResponse>) | undefined,
  onToken: (chunk: string) => void,
): Promise<LlmResponse> {
  let emitted = false
  try {
    return await primary((chunk) => { emitted = true; onToken(chunk) })
  } catch (err) {
    if (emitted || !kie || !(err instanceof LlmPlatformExhaustedError)) throw err
    return serveFromFallback(ctx, err, () => kie(onToken))
  }
}

/** {@link exhaustionKieFallback} for a stream. */
export function exhaustionKieStreamFallback(
  model: LlmModelDef, req: LlmRequest, signal?: AbortSignal,
): ((onToken: (chunk: string) => void) => Promise<LlmResponse>) | undefined {
  if (!config.KIE_API_KEY || req.requireLane === "kie" || !kieCanCarry(req)) return undefined
  return (cb) => streamKie(model, req, cb, signal)
}
