/**
 * ElevenLabs audio isolation — the provider-$ rate and the cost it implies.
 * CORE (not ee/): the worker records `provider_cost` on every isolation job in
 * every edition (`audio-ai.ts`). ElevenLabs' API answers with the isolated
 * audio and no bill, so the cost recorded is the length sent × this rate.
 *
 * Kept out of `@nodaro/shared` (published Apache-2.0) and out of `docs/`:
 * the package carries the SHAPE of the price (audio-isolation-pricing.ts),
 * never a vendor rate.
 *
 * Basis: the vendor's public API pricing page, read 2026-11-18 — Voice
 * Isolator, 0.12 per minute of audio, on every plan.
 */

/** USD per minute of audio sent. */
export const ELEVENLABS_ISOLATION_USD_PER_MINUTE = 0.12

/** What isolating `seconds` of audio costs the platform, in USD. */
export function elevenlabsIsolationCostUsd(seconds: number): number {
  const n = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return (n / 60) * ELEVENLABS_ISOLATION_USD_PER_MINUTE
}
