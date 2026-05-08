/**
 * Voice-delivery catalog: pace + emotion + archetype. Feeds
 * Voice Design's voiceDescription via the Sound aggregator.
 */

export interface VoiceDeliveryEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const VOICE_PACES: ReadonlyArray<VoiceDeliveryEntry> = [
  { id: "very-slow",   label: "Very Slow",  description: "Deliberate, ponderous",          promptHint: "very slow" },
  { id: "slow",        label: "Slow",       description: "Measured",                       promptHint: "slow" },
  { id: "drawl",       label: "Drawl",      description: "Drawn-out, lazy",                promptHint: "drawled" },
  { id: "measured",    label: "Measured",   description: "Steady, intentional",            promptHint: "measured" },
  { id: "moderate",    label: "Moderate",   description: "Conversational pace",            promptHint: "moderate" },
  { id: "punchy",      label: "Punchy",     description: "Clipped, emphatic",              promptHint: "punchy" },
  { id: "brisk",       label: "Brisk",      description: "Lively pace",                    promptHint: "brisk" },
  { id: "rapid",       label: "Rapid",      description: "Fast",                           promptHint: "rapid" },
  { id: "rapid-fire",  label: "Rapid-fire", description: "Machine-gun delivery",           promptHint: "rapid-fire" },
  { id: "frenetic",    label: "Frenetic",   description: "Breathless, urgent",             promptHint: "frenetic" },
  { id: "halting",     label: "Halting",    description: "Pausing, uncertain",             promptHint: "halting" },
] as const

export const VOICE_EMOTIONS: ReadonlyArray<VoiceDeliveryEntry> = [
  { id: "neutral",     label: "Neutral",     description: "Even, matter-of-fact",        promptHint: "neutral" },
  { id: "cheerful",    label: "Cheerful",    description: "Upbeat, positive",            promptHint: "cheerful" },
  { id: "warm",        label: "Warm",        description: "Friendly",                    promptHint: "warm" },
  { id: "reassuring",  label: "Reassuring",  description: "Calming, grounding",          promptHint: "reassuring" },
  { id: "compassionate",label: "Compassionate",description: "Empathetic, caring",        promptHint: "compassionate" },
  { id: "somber",      label: "Somber",      description: "Serious, grave",              promptHint: "somber" },
  { id: "stoic",       label: "Stoic",       description: "Restrained, composed",        promptHint: "stoic" },
  { id: "urgent",      label: "Urgent",      description: "Pressing",                    promptHint: "urgent" },
  { id: "frantic",     label: "Frantic",     description: "Panicked, scattered",         promptHint: "frantic" },
  { id: "anxious",     label: "Anxious",     description: "Tense",                       promptHint: "anxious" },
  { id: "scared",      label: "Scared",      description: "Afraid, trembling",           promptHint: "scared" },
  { id: "excited",     label: "Excited",     description: "Energetic, animated",         promptHint: "excited" },
  { id: "enthusiastic",label: "Enthusiastic",description: "Hyped, eager",                promptHint: "enthusiastic" },
  { id: "wistful",     label: "Wistful",     description: "Yearning, nostalgic",         promptHint: "wistful" },
  { id: "melancholic", label: "Melancholic", description: "Sad, mourning",               promptHint: "melancholic" },
  { id: "menacing",    label: "Menacing",    description: "Threatening",                 promptHint: "menacing" },
  { id: "angry",       label: "Angry",       description: "Hostile, hot",                promptHint: "angry" },
  { id: "sarcastic",   label: "Sarcastic",   description: "Wry, dry",                    promptHint: "sarcastic" },
  { id: "smug",        label: "Smug",        description: "Self-satisfied",              promptHint: "smug" },
  { id: "playful",     label: "Playful",     description: "Light, teasing",              promptHint: "playful" },
  { id: "flirty",      label: "Flirty",      description: "Suggestive, teasing",         promptHint: "flirty" },
  { id: "intimate",    label: "Intimate",    description: "Close, personal",             promptHint: "intimate" },
  { id: "seductive",   label: "Seductive",   description: "Sensual, alluring",           promptHint: "seductive" },
] as const

export const VOICE_ARCHETYPES: ReadonlyArray<VoiceDeliveryEntry> = [
  // Broadcast / Narration
  { id: "newscaster",            label: "Newscaster",            description: "Authoritative news delivery",     promptHint: "newscaster" },
  { id: "anchor",                label: "TV Anchor",             description: "Polished broadcast",              promptHint: "TV anchor" },
  { id: "documentary-narrator",  label: "Documentary Narrator",  description: "Informative, measured",           promptHint: "documentary narrator" },
  { id: "nature-narrator",       label: "Nature Narrator",       description: "Soft-spoken Attenborough-style",  promptHint: "nature documentary narrator" },
  { id: "fairy-tale-narrator",   label: "Fairy-Tale Narrator",   description: "Storyteller for children",        promptHint: "fairy-tale narrator" },
  { id: "audiobook-narrator",    label: "Audiobook Narrator",    description: "Long-form fiction reading",       promptHint: "audiobook narrator" },
  { id: "podcaster",             label: "Podcaster",             description: "Conversational",                  promptHint: "podcaster" },
  { id: "talk-show-host",        label: "Talk Show Host",        description: "Personable interviewer",          promptHint: "talk show host" },
  { id: "radio-dj",              label: "Radio DJ",              description: "Smooth FM voice",                 promptHint: "radio DJ" },
  // Performance
  { id: "asmr",                  label: "ASMR",                  description: "Whispered, intimate",             promptHint: "ASMR" },
  { id: "sportscaster",          label: "Sportscaster",          description: "Excitable play-by-play",          promptHint: "sportscaster" },
  { id: "auctioneer",            label: "Auctioneer",            description: "Rapid bidding chant",             promptHint: "auctioneer" },
  { id: "preacher",              label: "Preacher",              description: "Impassioned sermon",              promptHint: "preacher" },
  { id: "politician",            label: "Politician",            description: "Stump-speech rhetoric",           promptHint: "politician" },
  { id: "lawyer",                label: "Lawyer",                description: "Courtroom argument",              promptHint: "lawyer" },
  { id: "professor",             label: "Professor",             description: "Lecturer, academic",              promptHint: "professor" },
  { id: "infomercial",           label: "Infomercial",           description: "Selling, hyped",                  promptHint: "infomercial" },
  { id: "voice-actor",           label: "Voice Actor",           description: "Animated character work",         promptHint: "voice actor" },
  { id: "drag-queen",            label: "Drag Queen",            description: "Theatrical, fierce",              promptHint: "drag queen" },
  // Character archetypes
  { id: "villain",               label: "Villain",               description: "Sinister, scheming",              promptHint: "villain" },
  { id: "hero",                  label: "Hero",                  description: "Earnest, courageous",             promptHint: "heroic" },
  { id: "mentor",                label: "Mentor",                description: "Wise, guiding",                   promptHint: "mentor" },
  { id: "comedian",              label: "Comedian",              description: "Comedic timing",                  promptHint: "comedic" },
  { id: "stand-up-comic",        label: "Stand-up Comic",        description: "Punchline-driven",                promptHint: "stand-up comic" },
  { id: "drill-sergeant",        label: "Drill Sergeant",        description: "Barking commands",                promptHint: "drill sergeant" },
  { id: "meditation-guide",      label: "Meditation Guide",      description: "Soft, slow guidance",             promptHint: "meditation guide" },
  { id: "yoga-instructor",       label: "Yoga Instructor",       description: "Calm, grounding cues",            promptHint: "yoga instructor" },
  { id: "noir-detective",        label: "Noir Detective",        description: "Hard-boiled, brooding",           promptHint: "noir detective" },
  { id: "wizard",                label: "Wizard",                description: "Mystic, ancient",                 promptHint: "wizard" },
  { id: "robot",                 label: "Robot",                 description: "Synthetic, mechanical",           promptHint: "robotic" },
  { id: "ai-assistant",          label: "AI Assistant",          description: "Polished synthetic helper",       promptHint: "AI assistant" },
  { id: "siri-style",            label: "Virtual Assistant",     description: "Siri/Alexa-style helper",         promptHint: "virtual assistant" },
] as const

const PACE_BY_ID = new Map(VOICE_PACES.map((x) => [x.id, x]))
const EMOTION_BY_ID = new Map(VOICE_EMOTIONS.map((x) => [x.id, x]))
const ARCHETYPE_BY_ID = new Map(VOICE_ARCHETYPES.map((x) => [x.id, x]))

export function getVoicePace(id: string | undefined) { return id ? PACE_BY_ID.get(id) : undefined }
export function getVoiceEmotion(id: string | undefined) { return id ? EMOTION_BY_ID.get(id) : undefined }
export function getVoiceArchetype(id: string | undefined) { return id ? ARCHETYPE_BY_ID.get(id) : undefined }

/**
 * Compose a delivery clause.
 * Examples:
 *   { pace, archetype, emotion } → "measured documentary-narrator-style delivery, reassuring tone"
 *   { archetype }                → "documentary-narrator-style delivery"
 *   { emotion }                  → "reassuring tone"
 *   { pace }                     → "measured pace"
 */
export function buildVoiceDeliveryHints(data: {
  readonly pace?: string
  readonly emotion?: string
  readonly archetype?: string
}): string {
  const pace = getVoicePace(data.pace)
  const emotion = getVoiceEmotion(data.emotion)
  const archetype = getVoiceArchetype(data.archetype)

  let deliveryClause = ""
  if (pace && archetype) deliveryClause = `${pace.promptHint} ${archetype.promptHint}-style delivery`
  else if (archetype)   deliveryClause = `${archetype.promptHint}-style delivery`
  else if (pace)        deliveryClause = `${pace.promptHint} pace`

  const emotionClause = emotion ? `${emotion.promptHint} tone` : ""

  if (deliveryClause && emotionClause) return `${deliveryClause}, ${emotionClause}`
  return deliveryClause || emotionClause
}

export const VOICE_DELIVERY_DEFAULT_DATA: {
  pace?: string; emotion?: string; archetype?: string
} = {}
