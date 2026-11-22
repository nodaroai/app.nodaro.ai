/**
 * ElevenLabs speech-to-speech (Voice Changer) — the provider-$ rate and the
 * cost it implies. CORE (not ee/): the worker records `provider_cost` on a
 * Voice Changer run priced by its audio's length, in every edition
 * (`audio-ai.ts`). ElevenLabs' API answers with the revoiced audio and no
 * bill, so the cost recorded is the length sent × this rate.
 *
 * Kept out of `@nodaro/shared` (published Apache-2.0) and out of `docs/`: a
 * vendor rate is never published.
 *
 * Basis: the vendor's public API pricing page, read 2026-11-21 — Voice
 * Changer, 0.12 per minute of audio.
 */

/** USD per minute of audio sent. */
export const ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE = 0.12

/** What revoicing `seconds` of audio costs the platform, in USD. */
export function elevenlabsVoiceChangerCostUsd(seconds: number): number {
  const n = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return (n / 60) * ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE
}
