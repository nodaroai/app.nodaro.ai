/**
 * ElevenLabs speech-to-speech (voice changer) models — single source of truth
 * for the Voice Changer node's model picker (frontend config panel) AND the
 * `/v1/voice-changer` route Zod enum (backend). Lifting the list here keeps the
 * dropdown and the validation enum from ever drifting apart.
 *
 * These are the two `model_id` values ElevenLabs' `/v1/speech-to-speech/{voiceId}`
 * endpoint accepts with `can_do_voice_conversion`. English v2 is the historical
 * default the provider hardcoded, so it stays the default to preserve behavior.
 */
export const VOICE_CHANGER_MODELS = [
  {
    value: "eleven_english_sts_v2",
    label: "English v2",
    desc: "English-optimized speech-to-speech. Default — best for English audio.",
  },
  {
    value: "eleven_multilingual_sts_v2",
    label: "Multilingual v2",
    desc: "29 languages; preserves emotion, cadence & timing across non-English audio.",
  },
] as const

export type VoiceChangerModel = (typeof VOICE_CHANGER_MODELS)[number]["value"]

/** Plain id list for the route's `z.enum(...)`. */
export const VOICE_CHANGER_MODEL_IDS: VoiceChangerModel[] = VOICE_CHANGER_MODELS.map(
  (m) => m.value,
)

/** Preserves the provider's prior hardcoded model so existing nodes never change. */
export const DEFAULT_VOICE_CHANGER_MODEL: VoiceChangerModel = "eleven_english_sts_v2"
