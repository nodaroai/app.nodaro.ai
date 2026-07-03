/**
 * ElevenLabs speech-to-speech (voice changer) models — single source of truth
 * for the Voice Changer node's model picker (frontend config panel) AND the
 * `/v1/voice-changer` route Zod enum (backend). Lifting the list here keeps the
 * dropdown and the validation enum from ever drifting apart.
 *
 * These are the two `model_id` values ElevenLabs' `/v1/speech-to-speech/{voiceId}`
 * endpoint accepts with `can_do_voice_conversion`. ElevenLabs' own docs
 * recommend Multilingual v2 even for English source audio (it often
 * outperforms the English-only model), and it's required for non-English
 * audio (e.g. Hebrew), so it's the default — English v2 stays selectable.
 */
export const VOICE_CHANGER_MODELS = [
  {
    value: "eleven_multilingual_sts_v2",
    label: "Multilingual v2",
    desc: "29 languages; preserves emotion, cadence & timing. Default — ElevenLabs recommends this even for English audio.",
  },
  {
    value: "eleven_english_sts_v2",
    label: "English v2",
    desc: "English-optimized speech-to-speech.",
  },
] as const

export type VoiceChangerModel = (typeof VOICE_CHANGER_MODELS)[number]["value"]

/** Plain id list for the route's `z.enum(...)`. */
export const VOICE_CHANGER_MODEL_IDS: VoiceChangerModel[] = VOICE_CHANGER_MODELS.map(
  (m) => m.value,
)

/** ElevenLabs recommends Multilingual v2 even for English source audio (it
 *  often outperforms the English-only model), and it's required for
 *  non-English audio — so it's the default. English v2 remains selectable. */
export const DEFAULT_VOICE_CHANGER_MODEL: VoiceChangerModel = "eleven_multilingual_sts_v2"
