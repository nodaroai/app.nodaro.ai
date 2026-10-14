/**
 * The one-shot KIE retry for a direct lane whose PLATFORM account refused
 * (balance/quota gone, key refused — `../llm-platform-exhaustion.ts`).
 */

import { getLlmModel, type LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import { LlmPlatformExhaustedError } from "../llm-errors.js"
import { directLaneLatch } from "../llm-platform-exhaustion.js"
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

/**
 * KIE in place of a DIRECT lane whose platform account is latched out
 * (`DIRECT_LANE_LATCH_MS`, armed by the refusal itself in `toPlatformExhausted`):
 * the call goes straight to the leg a refusal would have sent it to, without
 * paying the refused round-trip first. Undefined — run the lanes as usual — when
 * nothing is latched for `provider`, or there is no KIE leg that can take the
 * call (no key, a KIE pin, media KIE cannot carry: pass the leg
 * {@link exhaustionKieFallback} builds, which already says so). The skip goes
 * through `serveFromFallback` with the refusal the latch remembers, so its log
 * line names the latch, and a KIE failure still reads as the capacity sentence.
 */
export function serveIfDirectLatched<T>(
  ctx: LaneFallbackCtx, provider: string, kie: (() => Promise<T>) | undefined,
): Promise<T> | undefined {
  if (!kie) return undefined
  const latch = directLaneLatch(provider)
  if (!latch) return undefined
  const left = Math.max(1, Math.ceil((latch.until - Date.now()) / 1000))
  const remembered = new LlmPlatformExhaustedError(
    `${provider} direct lane: platform account out of credit/quota — latched, not re-asked for ${left} s more — ${latch.detail}`,
    { lane: "direct", provider, exhaustion: latch.kind },
  )
  return serveFromFallback({ ...ctx, primary: `${ctx.primary}, latched` }, remembered, kie)
}

/** Run a direct lane; on a platform-account refusal ONLY, serve once from KIE. A latched lane is skipped ({@link serveIfDirectLatched}). */
export async function withExhaustionFallback(
  ctx: LaneFallbackCtx,
  provider: string,
  primary: () => Promise<LlmResponse>,
  kie: (() => Promise<LlmResponse>) | undefined,
): Promise<LlmResponse> {
  const latched = serveIfDirectLatched(ctx, provider, kie)
  if (latched) return latched
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
  provider: string,
  primary: (onToken: (chunk: string) => void) => Promise<LlmResponse>,
  kie: ((onToken: (chunk: string) => void) => Promise<LlmResponse>) | undefined,
  onToken: (chunk: string) => void,
): Promise<LlmResponse> {
  const latched = serveIfDirectLatched(ctx, provider, kie && (() => kie(onToken)))
  if (latched) return latched
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
