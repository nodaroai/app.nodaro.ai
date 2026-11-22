/**
 * ElevenLabs dubbing — the provider-$ rates and the cost a dub implies.
 * CORE (not ee/): delivery records `provider_cost` on every dub in every
 * edition (`lib/dubbing-delivery.ts`). ElevenLabs answers a dub with the dubbed
 * media and no bill, so the cost recorded is the minutes dubbed × the rate of
 * the API that dubbed it.
 *
 * Kept out of `@nodaro/shared` (published Apache-2.0) and out of `docs/`: a
 * vendor rate is never published.
 *
 * Basis: the vendor's public API pricing page, read 2026-11-21 — Dubbing (the
 * dubbing API) 0.50 per minute, 0.33 with the vendor's own watermark; Dubbing
 * v2 (the project API, which dubs into Hebrew) 2.20 per minute. Billed per
 * minute of the source; recorded here per minute held, the way the run is
 * charged, so the figure never reads lower than what the vendor bills.
 */
import { dubbingHeldMinutes } from "@nodaro/render-rules"
import { PROJECT_DUBBING_MODEL_ID } from "../dubbing-model.js"

/** USD per minute on the dubbing API, without the vendor's watermark (what a dub is sent with unless it asks for one). */
export const ELEVENLABS_DUBBING_USD_PER_MINUTE = 0.5

/** USD per minute on the dubbing API with the vendor's own watermark on the video. */
export const ELEVENLABS_DUBBING_WATERMARKED_USD_PER_MINUTE = 0.33

/** USD per minute on the project API (Dubbing v2). */
export const ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE = 2.2

/**
 * What dubbing `spanSec` seconds on the row `modelId` cost the platform, in
 * USD: the started minutes the run is held for (`dubbingHeldMinutes`) × the
 * rate of the API that dubbed it. 0 for a span that is not a positive length.
 */
export function elevenlabsDubbingCostUsd(modelId: string, spanSec: number, opts: { readonly watermark?: boolean } = {}): number {
  if (!Number.isFinite(spanSec) || spanSec <= 0) return 0
  const rate = modelId === PROJECT_DUBBING_MODEL_ID
    ? ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE
    : opts.watermark === true ? ELEVENLABS_DUBBING_WATERMARKED_USD_PER_MINUTE : ELEVENLABS_DUBBING_USD_PER_MINUTE
  return dubbingHeldMinutes(spanSec) * rate
}
