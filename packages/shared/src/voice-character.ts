/**
 * Voice-character catalog: age + gender + language + accent + timbre. Feeds
 * Voice Design's voiceDescription field via the Sound aggregator.
 *
 * `language` is multi-pick (up to 3) for codeswitching / multilingual
 * voice work. Distinct from `accent` — accent is HOW it sounds, language
 * is WHAT'S being spoken.
 */

import { pickIds } from "./multi-pick.js"

export interface VoiceCharacterEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const VOICE_AGES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "infant",       label: "Infant",       description: "0-2 years",          promptHint: "infant" },
  { id: "child",        label: "Child",        description: "5-12 years",         promptHint: "child" },
  { id: "preteen",      label: "Preteen",      description: "10-13 years",        promptHint: "preteen" },
  { id: "teen",         label: "Teen",         description: "13-19 years",        promptHint: "teen" },
  { id: "young-adult",  label: "Young Adult",  description: "20-35 years",        promptHint: "young adult" },
  { id: "middle-aged",  label: "Middle-aged",  description: "36-55 years",        promptHint: "middle-aged" },
  { id: "mature",       label: "Mature",       description: "55-70 years",        promptHint: "mature" },
  { id: "elderly",      label: "Elderly",      description: "70+ years",          promptHint: "elderly" },
] as const

export const VOICE_GENDERS: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "male",         label: "Male",         description: "Male voice",         promptHint: "male" },
  { id: "female",       label: "Female",       description: "Female voice",       promptHint: "female" },
  { id: "androgynous",  label: "Androgynous",  description: "Gender-neutral",     promptHint: "androgynous" },
] as const

export const VOICE_LANGUAGES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "english",     label: "English",     description: "English",                  promptHint: "English" },
  { id: "spanish",     label: "Spanish",     description: "Spanish (Castilian / LatAm)", promptHint: "Spanish" },
  { id: "french",      label: "French",      description: "French",                   promptHint: "French" },
  { id: "german",      label: "German",      description: "German",                   promptHint: "German" },
  { id: "italian",     label: "Italian",     description: "Italian",                  promptHint: "Italian" },
  { id: "portuguese",  label: "Portuguese",  description: "Portuguese / Brazilian",   promptHint: "Portuguese" },
  { id: "dutch",       label: "Dutch",       description: "Dutch",                    promptHint: "Dutch" },
  { id: "russian",     label: "Russian",     description: "Russian",                  promptHint: "Russian" },
  { id: "polish",      label: "Polish",      description: "Polish",                   promptHint: "Polish" },
  { id: "ukrainian",   label: "Ukrainian",   description: "Ukrainian",                promptHint: "Ukrainian" },
  { id: "swedish",     label: "Swedish",     description: "Swedish",                  promptHint: "Swedish" },
  { id: "norwegian",   label: "Norwegian",   description: "Norwegian",                promptHint: "Norwegian" },
  { id: "danish",      label: "Danish",      description: "Danish",                   promptHint: "Danish" },
  { id: "finnish",     label: "Finnish",     description: "Finnish",                  promptHint: "Finnish" },
  { id: "greek",       label: "Greek",       description: "Greek",                    promptHint: "Greek" },
  { id: "turkish",     label: "Turkish",     description: "Turkish",                  promptHint: "Turkish" },
  { id: "arabic",      label: "Arabic",      description: "Modern Standard Arabic",   promptHint: "Arabic" },
  { id: "hebrew",      label: "Hebrew",      description: "Hebrew",                   promptHint: "Hebrew" },
  { id: "persian",     label: "Persian",     description: "Persian / Farsi",          promptHint: "Persian" },
  { id: "hindi",       label: "Hindi",       description: "Hindi",                    promptHint: "Hindi" },
  { id: "bengali",     label: "Bengali",     description: "Bengali / Bangla",         promptHint: "Bengali" },
  { id: "tamil",       label: "Tamil",       description: "Tamil",                    promptHint: "Tamil" },
  { id: "urdu",        label: "Urdu",        description: "Urdu",                     promptHint: "Urdu" },
  { id: "tagalog",     label: "Tagalog",     description: "Tagalog / Filipino",       promptHint: "Tagalog" },
  { id: "indonesian",  label: "Indonesian",  description: "Bahasa Indonesia",         promptHint: "Indonesian" },
  { id: "thai",        label: "Thai",        description: "Thai",                     promptHint: "Thai" },
  { id: "vietnamese",  label: "Vietnamese",  description: "Vietnamese",               promptHint: "Vietnamese" },
  { id: "mandarin",    label: "Mandarin",    description: "Mandarin Chinese",         promptHint: "Mandarin Chinese" },
  { id: "cantonese",   label: "Cantonese",   description: "Cantonese Chinese",        promptHint: "Cantonese" },
  { id: "japanese",    label: "Japanese",    description: "Japanese",                 promptHint: "Japanese" },
  { id: "korean",      label: "Korean",      description: "Korean",                   promptHint: "Korean" },
  { id: "swahili",     label: "Swahili",     description: "Swahili",                  promptHint: "Swahili" },
  { id: "yoruba",      label: "Yoruba",      description: "Yoruba",                   promptHint: "Yoruba" },
] as const

export const VOICE_ACCENTS: ReadonlyArray<VoiceCharacterEntry> = [
  // North America
  { id: "general-american",      label: "General American",      description: "Neutral US accent",          promptHint: "general American" },
  { id: "southern-us",           label: "Southern US",           description: "US Southern drawl",          promptHint: "Southern US" },
  { id: "new-york",              label: "New York",              description: "NY metro accent",            promptHint: "New York" },
  { id: "boston",                label: "Boston",                description: "Boston / Mass accent",       promptHint: "Boston" },
  { id: "midwestern-us",         label: "Midwestern",            description: "US heartland",               promptHint: "Midwestern American" },
  { id: "chicago",               label: "Chicago",               description: "Upper-Midwest urban",        promptHint: "Chicago" },
  { id: "appalachian",           label: "Appalachian",           description: "Mountain South",             promptHint: "Appalachian" },
  { id: "canadian",              label: "Canadian",              description: "Canada English",             promptHint: "Canadian" },
  // British Isles
  { id: "british-rp",            label: "British RP",            description: "Received Pronunciation",     promptHint: "British RP" },
  { id: "cockney",               label: "Cockney",               description: "London working-class",       promptHint: "Cockney" },
  { id: "estuary-english",       label: "Estuary",               description: "South-East England",         promptHint: "Estuary English" },
  { id: "northern-english",      label: "Northern English",      description: "Manchester / Yorkshire",     promptHint: "Northern English" },
  { id: "scouse",                label: "Scouse",                description: "Liverpool",                  promptHint: "Scouse" },
  { id: "geordie",                label: "Geordie",               description: "Newcastle",                  promptHint: "Geordie" },
  { id: "scottish",              label: "Scottish",              description: "Scotland",                   promptHint: "Scottish" },
  { id: "irish",                 label: "Irish",                 description: "Ireland",                    promptHint: "Irish" },
  { id: "welsh",                 label: "Welsh",                 description: "Wales",                      promptHint: "Welsh" },
  // English-speaking world
  { id: "australian",            label: "Australian",            description: "Australia",                  promptHint: "Australian" },
  { id: "new-zealand",           label: "New Zealand",           description: "NZ Kiwi",                    promptHint: "New Zealand" },
  { id: "south-african",         label: "South African",         description: "South Africa",               promptHint: "South African" },
  { id: "indian-english",        label: "Indian English",        description: "South Asian English",        promptHint: "Indian English" },
  { id: "caribbean",             label: "Caribbean",             description: "Caribbean English",          promptHint: "Caribbean" },
  { id: "jamaican",              label: "Jamaican",              description: "Jamaican Patois",            promptHint: "Jamaican" },
  // Continental European-accented English
  { id: "french-accented",       label: "French",                description: "French-accented English",    promptHint: "French-accented" },
  { id: "italian-accented",      label: "Italian",               description: "Italian-accented English",   promptHint: "Italian-accented" },
  { id: "german-accented",       label: "German",                description: "German-accented English",    promptHint: "German-accented" },
  { id: "dutch-accented",        label: "Dutch",                 description: "Dutch-accented English",     promptHint: "Dutch-accented" },
  { id: "russian-accented",      label: "Russian",               description: "Russian-accented English",   promptHint: "Russian-accented" },
  { id: "polish-accented",       label: "Polish",                description: "Polish-accented English",    promptHint: "Polish-accented" },
  { id: "spanish-accented",      label: "Spanish",               description: "Spanish-accented English",   promptHint: "Spanish-accented" },
  { id: "portuguese-accented",   label: "Portuguese",            description: "Portuguese / Brazilian",     promptHint: "Portuguese-accented" },
  { id: "scandinavian-accented", label: "Scandinavian",          description: "Nordic-accented English",    promptHint: "Scandinavian-accented" },
  // Latin America
  { id: "mexican-accented",      label: "Mexican",               description: "Mexican-accented English",   promptHint: "Mexican-accented" },
  { id: "argentinian-accented",  label: "Argentinian",           description: "Río de la Plata",            promptHint: "Argentinian-accented" },
  // Asia / Middle East
  { id: "japanese-accented",     label: "Japanese",              description: "Japanese-accented English",  promptHint: "Japanese-accented" },
  { id: "korean-accented",       label: "Korean",                description: "Korean-accented English",    promptHint: "Korean-accented" },
  { id: "chinese-accented",      label: "Chinese",               description: "Mandarin-accented",          promptHint: "Chinese-accented" },
  { id: "filipino-accented",     label: "Filipino",              description: "Filipino-accented English",  promptHint: "Filipino-accented" },
  { id: "arabic-accented",       label: "Arabic",                description: "Arabic-accented English",    promptHint: "Arabic-accented" },
  { id: "hebrew-accented",       label: "Hebrew",                description: "Israeli-accented English",   promptHint: "Hebrew-accented" },
  { id: "turkish-accented",      label: "Turkish",               description: "Turkish-accented English",   promptHint: "Turkish-accented" },
  { id: "persian-accented",      label: "Persian",               description: "Persian-accented English",   promptHint: "Persian-accented" },
  // Africa
  { id: "nigerian-accented",     label: "Nigerian",              description: "Nigerian English",           promptHint: "Nigerian-accented" },
  // General
  { id: "neutral-international", label: "Neutral International", description: "Region-agnostic",            promptHint: "neutral international" },
  { id: "transatlantic",         label: "Transatlantic",         description: "Mid-Atlantic theatrical",    promptHint: "transatlantic" },
] as const

export const VOICE_TIMBRES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "warm",         label: "Warm",         description: "Rich, inviting",             promptHint: "warm" },
  { id: "smooth",       label: "Smooth",       description: "Clean, even",                promptHint: "smooth" },
  { id: "silky",        label: "Silky",        description: "Soft, refined",              promptHint: "silky" },
  { id: "velvety",      label: "Velvety",      description: "Lush, plush",                promptHint: "velvety" },
  { id: "raspy",        label: "Raspy",        description: "Rough, textured",            promptHint: "raspy" },
  { id: "gravelly",     label: "Gravelly",     description: "Deeply textured",            promptHint: "gravelly" },
  { id: "rough",        label: "Rough",        description: "Coarse, weathered",          promptHint: "rough" },
  { id: "husky",        label: "Husky",        description: "Throaty, hoarse",            promptHint: "husky" },
  { id: "breathy",      label: "Breathy",      description: "Airy, intimate",             promptHint: "breathy" },
  { id: "whispered",    label: "Whispered",    description: "Hushed, intimate",           promptHint: "whispered" },
  { id: "nasal",        label: "Nasal",        description: "Resonates in nose",          promptHint: "nasal" },
  { id: "twangy",       label: "Twangy",       description: "Sharp, regional",            promptHint: "twangy" },
  { id: "deep",         label: "Deep",         description: "Low pitch range",            promptHint: "deep" },
  { id: "booming",      label: "Booming",      description: "Resonant, large",            promptHint: "booming" },
  { id: "high-pitched", label: "High-pitched", description: "Upper register",             promptHint: "high-pitched" },
  { id: "squeaky",      label: "Squeaky",      description: "Thin, piercing",             promptHint: "squeaky" },
  { id: "bright",       label: "Bright",       description: "Crisp, forward",             promptHint: "bright" },
  { id: "dark",         label: "Dark",         description: "Heavy, somber",              promptHint: "dark" },
  { id: "youthful",     label: "Youthful",     description: "Light, fresh",               promptHint: "youthful" },
  { id: "authoritative",label: "Authoritative",description: "Commanding",                 promptHint: "authoritative" },
  { id: "sultry",       label: "Sultry",       description: "Sensual, smoky",             promptHint: "sultry" },
  { id: "polished",     label: "Polished",     description: "Practiced, broadcast-ready", promptHint: "polished" },
] as const

const AGE_BY_ID = new Map(VOICE_AGES.map((x) => [x.id, x]))
const GENDER_BY_ID = new Map(VOICE_GENDERS.map((x) => [x.id, x]))
const LANGUAGE_BY_ID = new Map(VOICE_LANGUAGES.map((x) => [x.id, x]))
const ACCENT_BY_ID = new Map(VOICE_ACCENTS.map((x) => [x.id, x]))
const TIMBRE_BY_ID = new Map(VOICE_TIMBRES.map((x) => [x.id, x]))

export function getVoiceAge(id: string | undefined) { return id ? AGE_BY_ID.get(id) : undefined }
export function getVoiceGender(id: string | undefined) { return id ? GENDER_BY_ID.get(id) : undefined }
export function getVoiceLanguage(id: string | undefined) { return id ? LANGUAGE_BY_ID.get(id) : undefined }
export function getVoiceAccent(id: string | undefined) { return id ? ACCENT_BY_ID.get(id) : undefined }
export function getVoiceTimbre(id: string | undefined) { return id ? TIMBRE_BY_ID.get(id) : undefined }

/**
 * Compose a natural-language voice character clause.
 * Examples (depending on which sub-fields are set):
 *   { age, gender, timbre, accent } → "middle-aged male voice with warm timbre and British RP accent"
 *   { timbre }                      → "warm timbre"
 *   { accent }                      → "British RP accent"
 *   { age, gender }                 → "middle-aged male voice"
 *   { language: ["english","spanish"] } → "English / Spanish voice"
 *   { }                             → ""
 *
 * `language` is multi-pick — multiple languages emit "English / Spanish"
 * for codeswitching / multilingual voices.
 */
export function buildVoiceCharacterHints(data: {
  readonly preText?: string
  readonly postText?: string
  readonly age?: string
  readonly gender?: string
  readonly language?: string | ReadonlyArray<string>
  readonly accent?: string
  readonly timbre?: string
}): string {
  const fragments: string[] = []
  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const age = getVoiceAge(data.age)
  const gender = getVoiceGender(data.gender)
  const accent = getVoiceAccent(data.accent)
  const timbre = getVoiceTimbre(data.timbre)

  const langIds = pickIds(data.language)
  const langHints = langIds
    .map((id) => getVoiceLanguage(id)?.promptHint)
    .filter((h): h is string => !!h)
  const langClause = langHints.join(" / ")

  const ageGender = [age?.promptHint, gender?.promptHint].filter(Boolean).join(" ")
  const traits: string[] = []
  if (timbre) traits.push(`${timbre.promptHint} timbre`)
  if (accent) traits.push(`${accent.promptHint} accent`)

  let core = ""
  if (ageGender && traits.length > 0) {
    core = `${ageGender} voice with ${traits.join(" and ")}`
  } else if (ageGender) {
    core = `${ageGender} voice`
  } else if (traits.length > 0) {
    core = traits.join(" and ")
  }

  let main = ""
  if (langClause && core) main = `${langClause}-speaking ${core}`
  else if (langClause) main = `${langClause} voice`
  else main = core

  if (main) fragments.push(main)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)

  return fragments.join(", ")
}

export const VOICE_CHARACTER_DEFAULT_DATA: {
  preText?: string
  postText?: string
  age?: string
  gender?: string
  language?: string | ReadonlyArray<string>
  accent?: string
  timbre?: string
} = {}
