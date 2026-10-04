// Audio tags for ElevenLabs TTS
// Which models perform [audio tags] and which honour <break .../> SSML is read
// from each model's capability sheet (`MODEL_CATALOG[id].tts`, @nodaro/shared):
// `ttsSupportsAudioTags` / `ttsSupportsSsmlBreaks`. Nothing here names a model.
import { MODEL_CATALOG, ttsLanguageCodes, ttsSupportsAudioTags, ttsSupportsSsmlBreaks } from "@nodaro/shared"

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

/**
 * Which warning inserting `tag` earns on `provider`, if any: an SSML break
 * (`<break …/>`) on a model whose sheet says it does not honour them, or an audio
 * tag (`[whispers]`) on a model that does not perform them. A node with no model
 * chosen (`provider === undefined`) never warns; a legacy or unknown id is judged
 * as the turbo model it runs as.
 *
 * The text area sets the matching message and then dismisses its own dropdown,
 * which clears it, so the warning does not reach the screen today (pre-existing,
 * and a visible change to fix on its own). The decision lives here, pinned by
 * tests, so it is right the day that is fixed.
 */
export function tagInsertWarning(provider: string | undefined, tag: string): "ssml" | "audioTag" | null {
  if (provider === undefined) return null
  if (tag.startsWith("<")) return ttsSupportsSsmlBreaks(provider) ? null : "ssml"
  if (tag.startsWith("[")) return ttsSupportsAudioTags(provider) ? null : "audioTag"
  return null
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

/**
 * English display name of every language a speech model is offered in. A
 * model's `tts.languages` (its capability sheet, @nodaro/shared) holds codes
 * only, so a name is written once, here. `audio-tags.test.ts` fails when a code
 * on any sheet has no name.
 */
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  en: "English", ja: "Japanese", zh: "Chinese", de: "German", hi: "Hindi",
  fr: "French", ko: "Korean", pt: "Portuguese", it: "Italian", es: "Spanish",
  id: "Indonesian", nl: "Dutch", tr: "Turkish", fil: "Filipino", pl: "Polish",
  sv: "Swedish", bg: "Bulgarian", ro: "Romanian", ar: "Arabic", cs: "Czech",
  el: "Greek", fi: "Finnish", hr: "Croatian", ms: "Malay", sk: "Slovak",
  da: "Danish", ta: "Tamil", uk: "Ukrainian", ru: "Russian",
  hu: "Hungarian", no: "Norwegian", vi: "Vietnamese",
  he: "Hebrew", th: "Thai", bn: "Bengali", ur: "Urdu", fa: "Persian",
  sr: "Serbian", lt: "Lithuanian", lv: "Latvian", et: "Estonian",
  ka: "Georgian", is: "Icelandic", ca: "Catalan", af: "Afrikaans", sw: "Swahili",
}

/** Display order is ALPHABETICAL BY LABEL, everywhere a language list renders —
 *  a 46-item dropdown in release order is unfindable (user report, 2026-08-31).
 *  The lists below are built fresh on every call, so sorting them in place is safe. */
const byLabel = (a: LanguageOption, b: LanguageOption) => a.label.localeCompare(b.label)

function toOptions(codes: readonly string[]): LanguageOption[] {
  return codes.map((value) => ({ value, label: LANGUAGE_LABELS[value] ?? value }))
}

/** Languages offered for the given TTS provider (a missing or unknown id lists what turbo offers). */
export function getLanguagesForModel(provider?: string): LanguageOption[] {
  return toOptions(ttsLanguageCodes(provider)).sort(byLabel)
}

/** All languages across all speech models — the voice browser's library filter and the dubbing / dialogue pickers. */
export const ALL_LANGUAGES: LanguageOption[] = toOptions([
  ...new Set(Object.values(MODEL_CATALOG).flatMap((m) => m.tts?.languages ?? [])),
]).sort(byLabel)

