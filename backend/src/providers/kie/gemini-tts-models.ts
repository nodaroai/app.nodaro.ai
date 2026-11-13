/**
 * Our Gemini text-to-speech id → the KIE market model it runs as. The ONE
 * place those KIE names are written for speech; they never leave the backend.
 * Kept apart from models.ts (and import-free) so the speech run-as seam
 * (elevenlabs/tts-models.ts), which the credit counter and the payload
 * builder read, stays a thin import.
 *
 * KIE docs: https://docs.kie.ai/market/google/gemini-3-8-flash-lite-tts and
 * the sibling pages (gemini-3-8-flash-tts, gemini-3-1-flash-tts,
 * gemini-2-5-pro-tts), read 2026-11-12. One market task each
 * (`POST /api/v1/jobs/createTask`); the result is a WAV (24 kHz, mono,
 * 16-bit) at `resultJson.resultUrls[0]`.
 */
export const GEMINI_TTS_WIRE_MODELS: Readonly<Record<string, string>> = {
  "gemini-3-8-flash-lite-tts": "google/gemini-3-8-flash-lite-tts",
  "gemini-3-8-flash-tts": "google/gemini-3-8-flash-tts",
  "gemini-3-1-flash-tts": "google/gemini-3-1-flash-tts",
  "gemini-2-5-pro-tts": "google/gemini-2-5-pro-tts",
}

/** Whether a speech id (already resolved: no alias) runs on KIE's Gemini models. Own properties only. */
export function isGeminiTtsModel(provider: unknown): provider is string {
  return typeof provider === "string" && Object.hasOwn(GEMINI_TTS_WIRE_MODELS, provider)
}
