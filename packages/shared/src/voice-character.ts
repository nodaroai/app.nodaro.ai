/**
 * Voice-character catalog: age + gender + accent + timbre. Feeds
 * Voice Design's voiceDescription field via the Sound aggregator.
 */

export interface VoiceCharacterEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const VOICE_AGES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "child",        label: "Child",        description: "5-12 years",         promptHint: "child" },
  { id: "teen",         label: "Teen",         description: "13-19 years",        promptHint: "teen" },
  { id: "young-adult",  label: "Young Adult",  description: "20-35 years",        promptHint: "young adult" },
  { id: "middle-aged",  label: "Middle-aged",  description: "36-55 years",        promptHint: "middle-aged" },
  { id: "elderly",      label: "Elderly",      description: "56+ years",          promptHint: "elderly" },
] as const

export const VOICE_GENDERS: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "male",         label: "Male",         description: "Male voice",         promptHint: "male" },
  { id: "female",       label: "Female",       description: "Female voice",       promptHint: "female" },
  { id: "androgynous",  label: "Androgynous",  description: "Gender-neutral",     promptHint: "androgynous" },
] as const

export const VOICE_ACCENTS: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "general-american",   label: "General American",   description: "Neutral US accent",         promptHint: "general American" },
  { id: "southern-us",        label: "Southern US",        description: "US Southern drawl",         promptHint: "Southern US" },
  { id: "new-york",           label: "New York",           description: "NY metro accent",           promptHint: "New York" },
  { id: "british-rp",         label: "British RP",         description: "Received Pronunciation",    promptHint: "British RP" },
  { id: "cockney",            label: "Cockney",            description: "London working-class",      promptHint: "Cockney" },
  { id: "scottish",           label: "Scottish",           description: "Scotland",                  promptHint: "Scottish" },
  { id: "irish",              label: "Irish",              description: "Ireland",                   promptHint: "Irish" },
  { id: "australian",         label: "Australian",         description: "Australia",                 promptHint: "Australian" },
  { id: "south-african",      label: "South African",      description: "South Africa",              promptHint: "South African" },
  { id: "indian-english",     label: "Indian English",     description: "South Asian English",       promptHint: "Indian English" },
  { id: "french-accented",    label: "French",             description: "French-accented English",   promptHint: "French-accented" },
  { id: "italian-accented",   label: "Italian",            description: "Italian-accented English",  promptHint: "Italian-accented" },
  { id: "german-accented",    label: "German",             description: "German-accented English",   promptHint: "German-accented" },
  { id: "russian-accented",   label: "Russian",            description: "Russian-accented English",  promptHint: "Russian-accented" },
  { id: "spanish-accented",   label: "Spanish",            description: "Spanish-accented English",  promptHint: "Spanish-accented" },
  { id: "neutral-international", label: "Neutral International", description: "Region-agnostic",   promptHint: "neutral international" },
] as const

export const VOICE_TIMBRES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "warm",         label: "Warm",         description: "Rich, inviting",         promptHint: "warm" },
  { id: "smooth",       label: "Smooth",       description: "Clean, even",            promptHint: "smooth" },
  { id: "raspy",        label: "Raspy",        description: "Rough, textured",        promptHint: "raspy" },
  { id: "gravelly",     label: "Gravelly",     description: "Deeply textured",        promptHint: "gravelly" },
  { id: "breathy",      label: "Breathy",      description: "Airy, intimate",         promptHint: "breathy" },
  { id: "nasal",        label: "Nasal",        description: "Resonates in nose",      promptHint: "nasal" },
  { id: "deep",         label: "Deep",         description: "Low pitch range",        promptHint: "deep" },
  { id: "high-pitched", label: "High-pitched", description: "Upper register",         promptHint: "high-pitched" },
  { id: "bright",       label: "Bright",       description: "Crisp, forward",         promptHint: "bright" },
  { id: "dark",         label: "Dark",         description: "Heavy, somber",          promptHint: "dark" },
  { id: "youthful",     label: "Youthful",     description: "Light, fresh",           promptHint: "youthful" },
  { id: "authoritative",label: "Authoritative",description: "Commanding",             promptHint: "authoritative" },
] as const

const AGE_BY_ID = new Map(VOICE_AGES.map((x) => [x.id, x]))
const GENDER_BY_ID = new Map(VOICE_GENDERS.map((x) => [x.id, x]))
const ACCENT_BY_ID = new Map(VOICE_ACCENTS.map((x) => [x.id, x]))
const TIMBRE_BY_ID = new Map(VOICE_TIMBRES.map((x) => [x.id, x]))

export function getVoiceAge(id: string | undefined) { return id ? AGE_BY_ID.get(id) : undefined }
export function getVoiceGender(id: string | undefined) { return id ? GENDER_BY_ID.get(id) : undefined }
export function getVoiceAccent(id: string | undefined) { return id ? ACCENT_BY_ID.get(id) : undefined }
export function getVoiceTimbre(id: string | undefined) { return id ? TIMBRE_BY_ID.get(id) : undefined }

/**
 * Compose a natural-language voice character clause.
 * Examples (depending on which sub-fields are set):
 *   { age, gender, timbre, accent } → "middle-aged male voice with warm timbre and British RP accent"
 *   { timbre }                      → "warm timbre"
 *   { accent }                      → "British RP accent"
 *   { age, gender }                 → "middle-aged male voice"
 *   { }                             → ""
 */
export function buildVoiceCharacterHints(data: {
  readonly age?: string
  readonly gender?: string
  readonly accent?: string
  readonly timbre?: string
}): string {
  const age = getVoiceAge(data.age)
  const gender = getVoiceGender(data.gender)
  const accent = getVoiceAccent(data.accent)
  const timbre = getVoiceTimbre(data.timbre)

  const ageGender = [age?.promptHint, gender?.promptHint].filter(Boolean).join(" ")
  const traits: string[] = []
  if (timbre) traits.push(`${timbre.promptHint} timbre`)
  if (accent) traits.push(`${accent.promptHint} accent`)

  if (ageGender && traits.length > 0) {
    return `${ageGender} voice with ${traits.join(" and ")}`
  }
  if (ageGender) return `${ageGender} voice`
  if (traits.length > 0) return traits.join(" and ")
  return ""
}

export const VOICE_CHARACTER_DEFAULT_DATA: {
  age?: string; gender?: string; accent?: string; timbre?: string
} = {}
