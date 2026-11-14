/**
 * Google's Gemini text-to-speech models (served through KIE): the facts their
 * capability sheets are built from. DATA only — each list is what the model
 * accepts on the wire, so the catalog, the routes, the editor and any client
 * read one place instead of copying a table that drifts.
 *
 * Two generations with different inputs:
 *   - 3.8 (Flash-Lite, Flash): 70 named voices grouped by use, `<angle>` tone
 *     tags from a closed list, and a free-text style per line.
 *   - 3.1 Flash and 2.5 Pro: 30 named voices, `[square]` tone tags written
 *     freely, and per-speaker style, pace, accent and audio profile.
 * Neither takes a language field: the language follows the text.
 */

/** What a Gemini 3.8 voice is meant for, as KIE groups them. A stable id; clients translate it. */
export const GEMINI_TTS_VOICE_GROUPS = [
  "tutor",
  "commercial-voiceover",
  "instructional",
  "podcast",
  "storyteller",
  "digital-assistant",
  "call-center",
  "concierge",
  "tech-support",
  "professional",
] as const
export type GeminiTtsVoiceGroup = (typeof GEMINI_TTS_VOICE_GROUPS)[number]

/** A named voice a speech model speaks: its wire name (the id a request sends), and what it is meant for when the model groups its voices. */
export interface TtsNamedVoice {
  readonly id: string
  readonly group?: GeminiTtsVoiceGroup
}

/** Gemini 3.8's 70 voices, in KIE's order, by use. */
const GEMINI_3_8_VOICES_BY_GROUP: Readonly<Record<GeminiTtsVoiceGroup, readonly string[]>> = {
  "tutor": ["Bodi", "Lumi", "Sadaltager", "Sola", "Sulafat", "Varo", "Zephyr"],
  "commercial-voiceover": ["Koda", "Kore", "Nika", "Tavi", "Zeno"],
  "instructional": ["Algenib", "Despina", "Erinome", "Kira", "Ludo", "Mako", "Rasalgethi", "Rina"],
  "podcast": ["Alnilam", "Brio", "Jori", "Laomedeia", "Rami", "Veda"],
  "storyteller": ["Achird", "Enzo", "Riko", "Sami", "Zali", "Zubenelgenubi"],
  "digital-assistant": ["Algieba", "Aoede", "Autonoe", "Callirrhoe", "Enceladus", "Gero", "Iapetus", "Neno", "Olin", "Tari", "Umbriel"],
  "call-center": ["Achernar", "Charon", "Daro", "Fola", "Hali", "Milo", "Puck"],
  "concierge": ["Arlo", "Cleo", "Fenrir", "Finn", "Leda", "Lora", "Orus"],
  "tech-support": ["Enya", "Jett", "Knox", "Nyla", "Sadachbia", "Vindemiatrix"],
  "professional": ["Cruz", "Elio", "Gacrux", "Pulcherrima", "Schedar", "Tova", "Zuri"],
}

export const GEMINI_3_8_TTS_VOICES: readonly TtsNamedVoice[] = GEMINI_TTS_VOICE_GROUPS.flatMap((group) =>
  GEMINI_3_8_VOICES_BY_GROUP[group].map((id) => ({ id, group })),
)

/** Gemini 3.1 Flash's and 2.5 Pro's 30 voices (one list for both), alphabetical as KIE lists them. */
export const GEMINI_3_1_TTS_VOICES: readonly TtsNamedVoice[] = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck",
  "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
].map((id) => ({ id }))

/** The voice a 3.8 request runs with when it names none — KIE's own default. */
export const GEMINI_3_8_DEFAULT_VOICE = "Fola"
/** The voice a 3.1 / 2.5 request runs with when it names none (3.8's default is not on their list). */
export const GEMINI_3_1_DEFAULT_VOICE = "Kore"

/**
 * The tone tags Gemini 3.8 performs, by their own names. A request writes them
 * in angle brackets (`<laugh>`); the platform's `[square]` tags are rewritten
 * to these where they match, and every other tag is taken out
 * (`@nodaro/prompts` `toAngleTags`).
 */
export const GEMINI_3_8_TONE_TAGS = [
  "argh", "breath", "cackle", "cheer", "chuckle", "chuckles", "cough", "cry", "exhales", "gasp",
  "giggle", "groan", "growl", "grr", "grunt", "heavy breath", "hiss", "laugh", "laughter", "long pause",
  "moan", "pant", "pff", "phew", "scream", "short pause", "shout", "shriek", "sigh", "sighs",
  "sneeze", "snicker", "snort", "sob", "throat-clearing", "tsk", "whimper", "whispering", "whispers", "yawn",
] as const

/** Gemini 3.1 / 2.5's speaking styles (one per request: the speaker's). */
export const GEMINI_3_1_TTS_STYLES = ["Vocal Smile", "Newscaster", "Whisper", "Empathetic", "Promo/Hype", "Deadpan"] as const
/** Gemini 3.1 / 2.5's paces. */
export const GEMINI_3_1_TTS_PACES = ["Natural", "Rapid Fire", "The Drift", "Staccato"] as const
/** Gemini 3.1 / 2.5's accents. */
export const GEMINI_3_1_TTS_ACCENTS = [
  "Neutral",
  "American (Gen)",
  "American (Valley)",
  "American (South)",
  "British (RP)",
  "British (Brixton)",
  "Transatlantic",
  "Australian",
] as const

/**
 * The longest free-text direction a request may carry (3.8's style, 3.1 /
 * 2.5's audio profile). The provider names no limit; a direction is a
 * sentence or two, and this keeps a request from carrying a script's worth of
 * unbilled text (decided 2026-11-12: style text is not billed).
 */
export const TTS_DIRECTION_MAX_CHARS = 1000

/**
 * Per-request text cap of every Gemini speech model: the provider's limit on
 * one turn's text. Taken from its schema, not measured.
 */
export const GEMINI_TTS_MAX_CHARS = 10000

/**
 * A one-off clone of a speaker's voice for ONE request (KIE's `replica`, Gemini
 * 3.8 Flash; decided 2026-11-13): two WAV recordings of the same adult — a
 * reference of natural speech and a consent recording of the owner reading
 * {@link REPLICA_CONSENT_SENTENCE} — sent in place of a named voice. Nothing is
 * saved as a voice. Each is an https link.
 */
export interface TtsReplica {
  readonly sourceAudioUrl: string
  readonly consentAudioUrl: string
}

/** The most bytes either recording may have (KIE: 10 MB per file). */
export const REPLICA_MAX_BYTES = 10 * 1024 * 1024
/** The reference recording's length, in seconds (KIE: 10–30 s of natural speech). */
export const REPLICA_SOURCE_MIN_SEC = 10
export const REPLICA_SOURCE_MAX_SEC = 30
/** The consent recording's most seconds (one sentence; KIE sets no range for it). */
export const REPLICA_CONSENT_MAX_SEC = 30
/** The sentence the voice's owner reads in the consent recording (KIE's; other supported languages' versions are accepted too). */
export const REPLICA_CONSENT_SENTENCE = "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."

/**
 * What a caller confirms for a one-off clone (decided 2026-11-13): the editor's
 * consent checkbox says it, and an API or MCP request says it with
 * `replica.consent: true`. A clone without it is refused before anything is
 * read or held.
 */
export const REPLICA_CONSENT_ATTESTATION =
  "I confirm the voice in these recordings is my own, or that its owner, an adult, has given me consent to clone it for this generation, and that neither recording is AI-generated."

/** A one-off clone as an API or MCP request sends it: the two recordings and the caller's consent (`REPLICA_CONSENT_ATTESTATION`). */
export interface TtsReplicaRequest extends TtsReplica {
  readonly consent: true
}

