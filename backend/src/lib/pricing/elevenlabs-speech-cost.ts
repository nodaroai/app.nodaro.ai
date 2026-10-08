/**
 * ElevenLabs speech — the provider-$ rate table and the cost it implies.
 * CORE (not ee/): the worker records `provider_cost` on every speech job in
 * every edition (`audio-ai.ts`), and `speech-unit-pricing.test.ts` re-derives
 * each per-100-characters credit row from these rates — a rate edit that is not
 * followed by a row edit fails that test instead of silently losing money.
 *
 * Kept out of `@nodaro/shared` (published Apache-2.0 — an irrevocable grant):
 * the package carries the SHAPE of the price (credit-estimators/speech.ts),
 * never a vendor rate. `tools/check-pricing-leaks.mjs` does not scan
 * backend/, which is why this file may spell dollars.
 *
 * Basis (decided 2026-10-06, Q-BASIS): the vendor's public API pricing page,
 * read 2026-10-05, per 1,000 characters — v3 / v4 / multilingual v2 0.08,
 * Flash/Turbo v2.5 0.04. v4's launch discount (0.022 until 2026-10-12) is
 * deliberately NOT used: a seven-day price would be baked into a row. If the
 * account's invoices show a higher marginal rate (Phase 0, step 4), change the
 * rate here AND the rows (static + migration) together.
 */
import { TTS_FALLBACK_PROVIDER } from "@nodaro/shared"
import { ttsModelKey } from "../../providers/elevenlabs/tts-models.js"

/** USD per 1,000 characters, keyed by OUR speech model id (text-to-speech models and dialogue). */
export const ELEVENLABS_SPEECH_USD_PER_1K_CHARS: Readonly<Record<string, number>> = {
  "elevenlabs-v3": 0.08,
  "elevenlabs-v4": 0.08,
  "elevenlabs-v4-turbo": 0.04, // the vendor's list rate after 2026-10-12 (half of v4's; the launch discount is deliberately not used — see above)
  "elevenlabs-multilingual": 0.08,
  "elevenlabs-turbo": 0.04,
  "elevenlabs-dialogue": 0.08,
  "elevenlabs-dialogue-v4": 0.08, // v4 dialogue shares v4's rate (decided 2026-10-06: parity with v3 dialogue)
}

/**
 * The id a speech request runs as: a model with a rate (text-to-speech or
 * dialogue) as given; anything else through the text-to-speech lane's own
 * run-as rule (`ttsModelKey`: alias resolved, unknown → the fallback model).
 */
function rateIdFor(modelId: string): string {
  return Object.hasOwn(ELEVENLABS_SPEECH_USD_PER_1K_CHARS, modelId) ? modelId : ttsModelKey(modelId)
}

/** What `chars` characters cost the platform on `modelId`, in USD. */
export function elevenlabsSpeechCostUsd(modelId: string, chars: number): number {
  const rate = ELEVENLABS_SPEECH_USD_PER_1K_CHARS[rateIdFor(modelId)] ?? ELEVENLABS_SPEECH_USD_PER_1K_CHARS[TTS_FALLBACK_PROVIDER]!
  const n = Number.isFinite(chars) && chars > 0 ? chars : 0
  return (rate * n) / 1000
}
