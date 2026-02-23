// Audio tags for ElevenLabs TTS
// v3 models support [audio tags], v2 models support <break .../> SSML

export interface AudioTag {
  tag: string
  label: string
  category: string
}

export const AUDIO_TAGS: AudioTag[] = [
  // Emotions
  { tag: "[excited]", label: "excited", category: "Emotions" },
  { tag: "[sad]", label: "sad", category: "Emotions" },
  { tag: "[angry]", label: "angry", category: "Emotions" },
  { tag: "[nervous]", label: "nervous", category: "Emotions" },
  { tag: "[frustrated]", label: "frustrated", category: "Emotions" },
  { tag: "[calm]", label: "calm", category: "Emotions" },
  { tag: "[sarcastic]", label: "sarcastic", category: "Emotions" },
  { tag: "[curious]", label: "curious", category: "Emotions" },
  { tag: "[mischievous]", label: "mischievous", category: "Emotions" },
  { tag: "[resigned]", label: "resigned", category: "Emotions" },

  // Reactions
  { tag: "[laughs]", label: "laughs", category: "Reactions" },
  { tag: "[sighs]", label: "sighs", category: "Reactions" },
  { tag: "[gasps]", label: "gasps", category: "Reactions" },
  { tag: "[clears throat]", label: "clears throat", category: "Reactions" },
  { tag: "[gulps]", label: "gulps", category: "Reactions" },
  { tag: "[snorts]", label: "snorts", category: "Reactions" },
  { tag: "[crying]", label: "crying", category: "Reactions" },
  { tag: "[giggles]", label: "giggles", category: "Reactions" },
  { tag: "[wheezing]", label: "wheezing", category: "Reactions" },
  { tag: "[laughs harder]", label: "laughs harder", category: "Reactions" },
  { tag: "[starts laughing]", label: "starts laughing", category: "Reactions" },
  { tag: "[exhales]", label: "exhales", category: "Reactions" },
  { tag: "[swallows]", label: "swallows", category: "Reactions" },
  { tag: "[coughs]", label: "coughs", category: "Reactions" },

  // Delivery
  { tag: "[whispers]", label: "whispers", category: "Delivery" },
  { tag: "[shouting]", label: "shouting", category: "Delivery" },
  { tag: "[singing]", label: "singing", category: "Delivery" },
  { tag: "[stammers]", label: "stammers", category: "Delivery" },
  { tag: "[rushed]", label: "rushed", category: "Delivery" },
  { tag: "[drawn out]", label: "drawn out", category: "Delivery" },
  { tag: "[sings]", label: "sings", category: "Delivery" },
  { tag: "[woo]", label: "woo", category: "Delivery" },

  // Pacing
  { tag: "[pause]", label: "pause", category: "Pacing" },
  { tag: "[hesitates]", label: "hesitates", category: "Pacing" },
  { tag: "[long pause]", label: "long pause", category: "Pacing" },

  // Tone
  { tag: "[cheerfully]", label: "cheerfully", category: "Tone" },
  { tag: "[flatly]", label: "flatly", category: "Tone" },
  { tag: "[deadpan]", label: "deadpan", category: "Tone" },
  { tag: "[playfully]", label: "playfully", category: "Tone" },
  { tag: "[matter-of-fact]", label: "matter-of-fact", category: "Tone" },
  { tag: "[sarcastically]", label: "sarcastically", category: "Tone" },
  { tag: "[resigned tone]", label: "resigned tone", category: "Tone" },

  // Sound Effects
  { tag: "[applause]", label: "applause", category: "Sound Effects" },
  { tag: "[gunshot]", label: "gunshot", category: "Sound Effects" },
  { tag: "[explosion]", label: "explosion", category: "Sound Effects" },
  { tag: "[door creaks]", label: "door creaks", category: "Sound Effects" },
  { tag: "[footsteps]", label: "footsteps", category: "Sound Effects" },
  { tag: "[telephone rings]", label: "telephone rings", category: "Sound Effects" },
  { tag: "[drumroll]", label: "drumroll", category: "Sound Effects" },
  { tag: "[clapping]", label: "clapping", category: "Sound Effects" },
  { tag: "[glass shattering]", label: "glass shattering", category: "Sound Effects" },
  { tag: "[thunder]", label: "thunder", category: "Sound Effects" },
  { tag: "[rain]", label: "rain", category: "Sound Effects" },
  { tag: "[car horn]", label: "car horn", category: "Sound Effects" },
  { tag: "[siren]", label: "siren", category: "Sound Effects" },
  { tag: "[wind blowing]", label: "wind blowing", category: "Sound Effects" },
  { tag: "[crowd cheering]", label: "crowd cheering", category: "Sound Effects" },
]

export interface SSMLBreakOption {
  tag: string
  label: string
}

export const SSML_BREAK_OPTIONS: SSMLBreakOption[] = [
  { tag: '<break time="0.5s" />', label: "Break 0.5s" },
  { tag: '<break time="1.0s" />', label: "Break 1.0s" },
  { tag: '<break time="1.5s" />', label: "Break 1.5s" },
  { tag: '<break time="2.0s" />', label: "Break 2.0s" },
  { tag: '<break time="3.0s" />', label: "Break 3.0s" },
]

// Audio tags ([...]) only work with ElevenLabs v3 models (future)
// SSML break tags (<break .../>) work with Turbo v2.5 and Multilingual v2
export const V3_MODELS = ["elevenlabs-v3"] as const
export const V2_MODELS = ["elevenlabs-turbo", "elevenlabs-multilingual"] as const

export function isV2Model(provider: string | undefined): boolean {
  return !provider || (V2_MODELS as readonly string[]).includes(provider)
}

export function isV3Model(provider: string | undefined): boolean {
  return !!provider && (V3_MODELS as readonly string[]).includes(provider)
}

/** Get all tags available for autocomplete (both audio tags and SSML) */
export function getAudioTagCategories(): Map<string, AudioTag[]> {
  const map = new Map<string, AudioTag[]>()
  for (const tag of AUDIO_TAGS) {
    const existing = map.get(tag.category) ?? []
    existing.push(tag)
    map.set(tag.category, existing)
  }
  return map
}

// ---------------------------------------------------------------------------
// Model-aware language lists
// ---------------------------------------------------------------------------

export interface LanguageOption {
  value: string
  label: string
}

/** 29 languages supported by Multilingual v2 */
const MULTILINGUAL_V2_LANGUAGES: LanguageOption[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "fr", label: "French" },
  { value: "ko", label: "Korean" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "es", label: "Spanish" },
  { value: "id", label: "Indonesian" },
  { value: "nl", label: "Dutch" },
  { value: "tr", label: "Turkish" },
  { value: "fil", label: "Filipino" },
  { value: "pl", label: "Polish" },
  { value: "sv", label: "Swedish" },
  { value: "bg", label: "Bulgarian" },
  { value: "ro", label: "Romanian" },
  { value: "ar", label: "Arabic" },
  { value: "cs", label: "Czech" },
  { value: "el", label: "Greek" },
  { value: "fi", label: "Finnish" },
  { value: "hr", label: "Croatian" },
  { value: "ms", label: "Malay" },
  { value: "sk", label: "Slovak" },
  { value: "da", label: "Danish" },
  { value: "ta", label: "Tamil" },
  { value: "uk", label: "Ukrainian" },
  { value: "ru", label: "Russian" },
]

/** 3 extra languages in Flash v2.5 (on top of Multilingual v2) */
const FLASH_V25_EXTRA: LanguageOption[] = [
  { value: "hu", label: "Hungarian" },
  { value: "no", label: "Norwegian" },
  { value: "vi", label: "Vietnamese" },
]

/** Languages only available in v3 */
const V3_EXTRA_LANGUAGES: LanguageOption[] = [
  { value: "he", label: "Hebrew" },
  { value: "th", label: "Thai" },
  { value: "bn", label: "Bengali" },
  { value: "ur", label: "Urdu" },
  { value: "fa", label: "Persian" },
  { value: "sr", label: "Serbian" },
  { value: "lt", label: "Lithuanian" },
  { value: "lv", label: "Latvian" },
  { value: "et", label: "Estonian" },
  { value: "ka", label: "Georgian" },
  { value: "is", label: "Icelandic" },
  { value: "ca", label: "Catalan" },
  { value: "af", label: "Afrikaans" },
  { value: "sw", label: "Swahili" },
]

/** Get languages supported by the given TTS provider */
export function getLanguagesForModel(provider?: string): LanguageOption[] {
  if (provider === "elevenlabs-v3") {
    return [...MULTILINGUAL_V2_LANGUAGES, ...FLASH_V25_EXTRA, ...V3_EXTRA_LANGUAGES]
  }
  if (provider === "elevenlabs-multilingual") {
    return MULTILINGUAL_V2_LANGUAGES
  }
  // Default: elevenlabs-turbo (Flash v2.5)
  return [...MULTILINGUAL_V2_LANGUAGES, ...FLASH_V25_EXTRA]
}

/** All languages across all models — used for voice browser library filter */
export const ALL_LANGUAGES: LanguageOption[] = [
  ...MULTILINGUAL_V2_LANGUAGES,
  ...FLASH_V25_EXTRA,
  ...V3_EXTRA_LANGUAGES,
]
