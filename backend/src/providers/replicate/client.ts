/**
 * Replicate API Client - Shared client and helpers
 *
 * Provides a singleton Replicate client and common utilities
 * used by all Replicate provider modules (image, video).
 */

import Replicate from "replicate"
import { config } from "../../lib/config.js"

// Singleton Replicate client
export const replicate = new Replicate({
  auth: config.REPLICATE_API_TOKEN,
})

/**
 * Helper to extract a URL from Replicate's various output formats.
 * Replicate outputs can be strings, FileOutput objects, or other shapes.
 */
export function extractUrl(item: unknown): string {
  if (typeof item === "string") {
    return item
  }
  if (item && typeof item === "object") {
    // Replicate FileOutput: has .url property or toString() returns URL
    const obj = item as Record<string, unknown>
    if (typeof obj.url === "function") {
      return (obj.url as () => string)()
    }
    if (typeof obj.url === "string") {
      return obj.url
    }
    if (typeof obj.href === "string") {
      return obj.href
    }
    // FileOutput extends ReadableStream and has toString
    const str = String(item)
    if (str.startsWith("http")) {
      return str
    }
    // Try JSON stringification as last resort
    console.warn(
      `[Replicate] Unexpected object shape:`,
      JSON.stringify(item).slice(0, 500)
    )
    throw new Error(
      `Unexpected Replicate output object: ${JSON.stringify(item).slice(0, 200)}`
    )
  }
  throw new Error(
    `Unexpected Replicate output type: ${typeof item}`
  )
}

/** Replicate GPU $/second by hardware SKU (replicate.com/pricing, 2026-05). */
const REPLICATE_GPU_USD_PER_SEC = {
  cpu: 0.000025,
  t4: 0.000225,
  l40s: 0.000975,
  a100_80gb: 0.0014,
  h100: 0.001525,
} as const

const T4_RATE = REPLICATE_GPU_USD_PER_SEC.t4

/**
 * Per-model GPU rate, keyed by the model identifier each caller passes (the
 * lip-sync provider key, the transcribe model name, etc.). The previous code
 * hard-coded the T4 rate ($0.000225/s) for EVERY model, so the metered
 * commit/true-up under-charged anything on L40S/A100/H100 by 4–7×. Only the
 * genuine GPU-time models that can be metered need an entry; fixed/composite-
 * priced Replicate models (flux-2, ltx, runway, pika) commit the reserved tier,
 * so their extractCost is display-only and the T4 fallback is harmless.
 */
const REPLICATE_MODEL_USD_PER_SEC: Record<string, number> = {
  latentsync: REPLICATE_GPU_USD_PER_SEC.l40s,
  wav2lip: REPLICATE_GPU_USD_PER_SEC.l40s,
  sadtalker: REPLICATE_GPU_USD_PER_SEC.a100_80gb,
  "video-retalking": REPLICATE_GPU_USD_PER_SEC.a100_80gb,
  "incredibly-fast-whisper": REPLICATE_GPU_USD_PER_SEC.l40s,
  whisper: REPLICATE_GPU_USD_PER_SEC.t4,
}

/**
 * Extract cost from Replicate prediction metrics = predict_time × the model's
 * GPU $/sec. Pass `modelKey` so the correct hardware rate is used (REQUIRED for
 * any model that will be committed via the metered/true-up path); unknown keys
 * fall back to the T4 rate (safe only for display / fixed-price models that
 * commit the reserved tier). See REPLICATE_MODEL_USD_PER_SEC above.
 */
export function extractCost(
  metrics: Record<string, unknown> | undefined,
  modelKey?: string,
): number | null {
  const predictTime = (metrics as { predict_time?: number })
    ?.predict_time
  if (predictTime && predictTime > 0) {
    const rate = (modelKey && REPLICATE_MODEL_USD_PER_SEC[modelKey]) || T4_RATE
    return predictTime * rate
  }
  return null
}

/**
 * Standard Webhooks signature verifier exported by the Replicate SDK as a
 * top-level function (NOT a static method on the `Replicate` class). The
 * second overload — `{ id, timestamp, signature, body, secret }` — is the
 * one we use, because Fastify's `req.raw` is a Node `IncomingMessage` and
 * NOT a Fetch `Request` (the first overload expects the latter).
 *
 * THROWS on empty `id`/`body`/`secret` — callers MUST wrap in try/catch.
 */
export { validateWebhook } from "replicate"
