/**
 * Replicate API Client - Shared client and helpers
 *
 * Provides a singleton Replicate client and common utilities
 * used by all Replicate provider modules (image, video).
 */

import Replicate from "replicate"
import { config } from "../../lib/config.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { liveProviderClient, requireProviderKey } from "../provider-keys.js"
import { egressSdkFetch } from "../egress.js"

// Singleton Replicate client.
//
// Guarded at the boundary on purpose: a dozen modules import this singleton
// and call it directly (audio/*, replicate/sfx.ts, ltx-video.ts, the audio and
// video worker handlers...), bypassing runReplicatePrediction. Without the
// guard a keyless self-host got a raw "401 Unauthorized" from api.replicate.com
// with no hint about what to do — and every new call site would inherit that.
//
// Built from the key IN FORCE and rebuilt when it changes (provider keys are
// live: env, then the operator-supplied key from /setup) — a client
// constructed once at import would keep a stale token after a paste.
export const replicate = liveProviderClient(
  // Inject the egress-decorated fetch so the SDK's own transport (predictions,
  // wait, models.*) flows through the seam like every other provider call.
  (auth) => new Replicate({ auth, fetch: egressSdkFetch("replicate") }),
  "REPLICATE_API_TOKEN",
  () => config.REPLICATE_API_TOKEN,
)

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
 * Shared dispatch envelope for the single-prediction Replicate providers
 * (image, video, face-swap, lip-sync): `predictions.create` →
 * `fireOnTaskCreated(prediction.id)` (BEFORE the wait, so a worker crash
 * mid-poll still leaves the row recoverable by the reconcile cron) →
 * `replicate.wait` → cost extraction via `extractCost`.
 *
 * Returns the RAW `completed.output` untouched so each caller keeps its own
 * output-shape handling (some expect a string, some an array, some a
 * FileOutput object) downstream via `extractUrl`. Pass exactly one of
 * `version` / `model` (the SDK's create-options is `{version} | {model}`);
 * `costModelKey` is forwarded to `extractCost` for the per-model GPU rate.
 */
export async function runReplicatePrediction(opts: {
  version?: string
  model?: string
  input: Record<string, unknown>
  label: string
  reconcileOpts?: ReconcileOpts
  /** Forwarded to `extractCost` so the correct hardware $/sec is used. */
  costModelKey?: string
}): Promise<{ output: unknown; cost: number | null; predictionId: string }> {
  // Keyless self-hosts reach this through DIRECT handlers (face-swap,
  // lip-sync, ...) that bypass the registry, so key-aware registration can't
  // protect them — without this guard the call dies as a raw Replicate 401
  // (founder hit it live on face-swap, 2026-08-15).
  requireProviderKey(config.REPLICATE_API_TOKEN, "REPLICATE_API_TOKEN", opts.label)
  const createOptions =
    opts.version !== undefined
      ? { version: opts.version, input: opts.input }
      : { model: opts.model as `${string}/${string}`, input: opts.input }

  const prediction = await replicate.predictions.create(createOptions)
  await fireOnTaskCreated(opts.reconcileOpts, prediction.id, opts.label)
  const completed = await replicate.wait(prediction)
  const cost = extractCost(
    completed.metrics as Record<string, unknown> | undefined,
    opts.costModelKey,
  )
  return { output: completed.output, cost, predictionId: prediction.id }
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
