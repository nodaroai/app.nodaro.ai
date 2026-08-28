/**
 * Voice-character catalog: age + gender + language + accent + timbre. Feeds
 * Voice Design's voiceDescription field via the Sound aggregator.
 *
 * `language` is multi-pick (up to 3) for codeswitching / multilingual
 * voice work. Distinct from `accent` — accent is HOW it sounds, language
 * is WHAT'S being spoken.
 */

import { pickIds } from "@nodaro/shared"
import { resolveTerm, type PickerHintMode } from "./term.js"

export interface VoiceCharacterEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  /** Optional authored compact term (see `term.ts` for the convention). */
  readonly term?: string
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
  { id: "general-american",      label: "General American",      description: "Neutral US accent",          promptHint: "general American", term: "general american accent" },
  { id: "southern-us",           label: "Southern US",           description: "US Southern drawl",          promptHint: "Southern US", term: "southern american accent" },
  { id: "new-york",              label: "New York",              description: "NY metro accent",            promptHint: "New York", term: "new york accent" },
  { id: "boston",                label: "Boston",                description: "Boston / Mass accent",       promptHint: "Boston", term: "boston accent" },
  { id: "midwestern-us",         label: "Midwestern",            description: "US heartland",               promptHint: "Midwestern American", term: "midwestern american accent" },
  { id: "chicago",               label: "Chicago",               description: "Upper-Midwest urban",        promptHint: "Chicago", term: "chicago accent" },
  { id: "appalachian",           label: "Appalachian",           description: "Mountain South",             promptHint: "Appalachian", term: "appalachian accent" },
  { id: "canadian",              label: "Canadian",              description: "Canada English",             promptHint: "Canadian", term: "canadian accent" },
  // British Isles
  { id: "british-rp",            label: "British RP",            description: "Received Pronunciation",     promptHint: "British RP", term: "received pronunciation accent" },
  { id: "cockney",               label: "Cockney",               description: "London working-class",       promptHint: "Cockney", term: "cockney accent" },
  { id: "estuary-english",       label: "Estuary",               description: "South-East England",         promptHint: "Estuary English", term: "estuary english accent" },
  { id: "northern-english",      label: "Northern English",      description: "Manchester / Yorkshire",     promptHint: "Northern English", term: "northern english accent" },
  { id: "scouse",                label: "Scouse",                description: "Liverpool",                  promptHint: "Scouse", term: "scouse accent" },
  { id: "geordie",                label: "Geordie",               description: "Newcastle",                  promptHint: "Geordie", term: "geordie accent" },
  { id: "scottish",              label: "Scottish",              description: "Scotland",                   promptHint: "Scottish", term: "scottish accent" },
  { id: "irish",                 label: "Irish",                 description: "Ireland",                    promptHint: "Irish", term: "irish accent" },
  { id: "welsh",                 label: "Welsh",                 description: "Wales",                      promptHint: "Welsh", term: "welsh accent" },
  // English-speaking world
  { id: "australian",            label: "Australian",            description: "Australia",                  promptHint: "Australian", term: "australian accent" },
  { id: "new-zealand",           label: "New Zealand",           description: "NZ Kiwi",                    promptHint: "New Zealand", term: "new zealand accent" },
  { id: "south-african",         label: "South African",         description: "South Africa",               promptHint: "South African", term: "south african accent" },
  { id: "indian-english",        label: "Indian English",        description: "South Asian English",        promptHint: "Indian English", term: "indian english accent" },
  { id: "caribbean",             label: "Caribbean",             description: "Caribbean English",          promptHint: "Caribbean", term: "caribbean accent" },
  { id: "jamaican",              label: "Jamaican",              description: "Jamaican Patois",            promptHint: "Jamaican", term: "jamaican accent" },
  // Continental European-accented English
  { id: "french-accented",       label: "French",                description: "French-accented English",    promptHint: "French-accented", term: "french accent" },
  { id: "italian-accented",      label: "Italian",               description: "Italian-accented English",   promptHint: "Italian-accented", term: "italian accent" },
  { id: "german-accented",       label: "German",                description: "German-accented English",    promptHint: "German-accented", term: "german accent" },
  { id: "dutch-accented",        label: "Dutch",                 description: "Dutch-accented English",     promptHint: "Dutch-accented", term: "dutch accent" },
  { id: "russian-accented",      label: "Russian",               description: "Russian-accented English",   promptHint: "Russian-accented", term: "russian accent" },
  { id: "polish-accented",       label: "Polish",                description: "Polish-accented English",    promptHint: "Polish-accented", term: "polish accent" },
  { id: "spanish-accented",      label: "Spanish",               description: "Spanish-accented English",   promptHint: "Spanish-accented", term: "spanish accent" },
  { id: "portuguese-accented",   label: "Portuguese",            description: "Portuguese / Brazilian",     promptHint: "Portuguese-accented", term: "portuguese accent" },
  { id: "scandinavian-accented", label: "Scandinavian",          description: "Nordic-accented English",    promptHint: "Scandinavian-accented", term: "scandinavian accent" },
  // Latin America
  { id: "mexican-accented",      label: "Mexican",               description: "Mexican-accented English",   promptHint: "Mexican-accented", term: "mexican accent" },
  { id: "argentinian-accented",  label: "Argentinian",           description: "Río de la Plata",            promptHint: "Argentinian-accented", term: "argentinian accent" },
  // Asia / Middle East
  { id: "japanese-accented",     label: "Japanese",              description: "Japanese-accented English",  promptHint: "Japanese-accented", term: "japanese accent" },
  { id: "korean-accented",       label: "Korean",                description: "Korean-accented English",    promptHint: "Korean-accented", term: "korean accent" },
  { id: "chinese-accented",      label: "Chinese",               description: "Mandarin-accented",          promptHint: "Chinese-accented", term: "chinese accent" },
  { id: "filipino-accented",     label: "Filipino",              description: "Filipino-accented English",  promptHint: "Filipino-accented", term: "filipino accent" },
  { id: "arabic-accented",       label: "Arabic",                description: "Arabic-accented English",    promptHint: "Arabic-accented", term: "arabic accent" },
  { id: "hebrew-accented",       label: "Hebrew",                description: "Israeli-accented English",   promptHint: "Hebrew-accented", term: "hebrew accent" },
  { id: "turkish-accented",      label: "Turkish",               description: "Turkish-accented English",   promptHint: "Turkish-accented", term: "turkish accent" },
  { id: "persian-accented",      label: "Persian",               description: "Persian-accented English",   promptHint: "Persian-accented", term: "persian accent" },
  // Africa
  { id: "nigerian-accented",     label: "Nigerian",              description: "Nigerian English",           promptHint: "Nigerian-accented", term: "nigerian accent" },
  // General
  { id: "neutral-international", label: "Neutral International", description: "Region-agnostic",            promptHint: "neutral international", term: "neutral international accent" },
  { id: "transatlantic",         label: "Transatlantic",         description: "Mid-Atlantic theatrical",    promptHint: "transatlantic", term: "transatlantic accent" },
] as const

export const VOICE_TIMBRES: ReadonlyArray<VoiceCharacterEntry> = [
  { id: "warm",         label: "Warm",         description: "Rich, inviting",             promptHint: "warm", term: "warm timbre" },
  { id: "smooth",       label: "Smooth",       description: "Clean, even",                promptHint: "smooth", term: "smooth timbre" },
  { id: "silky",        label: "Silky",        description: "Soft, refined",              promptHint: "silky", term: "silky timbre" },
  { id: "velvety",      label: "Velvety",      description: "Lush, plush",                promptHint: "velvety", term: "velvety timbre" },
  { id: "raspy",        label: "Raspy",        description: "Rough, textured",            promptHint: "raspy", term: "raspy timbre" },
  { id: "gravelly",     label: "Gravelly",     description: "Deeply textured",            promptHint: "gravelly", term: "gravelly timbre" },
  { id: "rough",        label: "Rough",        description: "Coarse, weathered",          promptHint: "rough", term: "rough timbre" },
  { id: "husky",        label: "Husky",        description: "Throaty, hoarse",            promptHint: "husky", term: "husky timbre" },
  { id: "breathy",      label: "Breathy",      description: "Airy, intimate",             promptHint: "breathy", term: "breathy timbre" },
  { id: "whispered",    label: "Whispered",    description: "Hushed, intimate",           promptHint: "whispered", term: "whispered timbre" },
  { id: "nasal",        label: "Nasal",        description: "Resonates in nose",          promptHint: "nasal", term: "nasal timbre" },
  { id: "twangy",       label: "Twangy",       description: "Sharp, regional",            promptHint: "twangy", term: "twangy timbre" },
  { id: "deep",         label: "Deep",         description: "Low pitch range",            promptHint: "deep", term: "deep timbre" },
  { id: "booming",      label: "Booming",      description: "Resonant, large",            promptHint: "booming", term: "booming timbre" },
  { id: "high-pitched", label: "High-pitched", description: "Upper register",             promptHint: "high-pitched", term: "high-pitched timbre" },
  { id: "squeaky",      label: "Squeaky",      description: "Thin, piercing",             promptHint: "squeaky", term: "squeaky timbre" },
  { id: "bright",       label: "Bright",       description: "Crisp, forward",             promptHint: "bright", term: "bright timbre" },
  { id: "dark",         label: "Dark",         description: "Heavy, somber",              promptHint: "dark", term: "dark timbre" },
  { id: "youthful",     label: "Youthful",     description: "Light, fresh",               promptHint: "youthful", term: "youthful timbre" },
  { id: "authoritative",label: "Authoritative",description: "Commanding",                 promptHint: "authoritative", term: "authoritative timbre" },
  { id: "sultry",       label: "Sultry",       description: "Sensual, smoky",             promptHint: "sultry", term: "sultry timbre" },
  { id: "polished",     label: "Polished",     description: "Practiced, broadcast-ready", promptHint: "polished", term: "polished timbre" },
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
 * The COMPACT counterparts of the five sub-field lookups: the short
 * professional term a consumer injects instead of the entry's hint fragment.
 * Same lookup, same empty-string-on-miss behavior.
 *
 * Accent and timbre terms CARRY their dimension noun — "boston accent",
 * "french accent", "warm timbre" — where the `promptHint` fragments are bare
 * ("Boston", "French-accented", "warm") and only read as an accent or a
 * timbre once `buildVoiceCharacterHints` appends the noun. The term has to
 * stand on its own because a thin client injects one by itself (a picker
 * chip), with no composer to append anything: a bare "french" there is
 * indistinguishable from the LANGUAGE French sitting in the neighbouring
 * dimension.
 *
 * Age, gender and language terms deliberately stay BARE — "male", "mature",
 * "english". Do NOT "fix" them by authoring the noun into the data:
 * `composeVoiceCharacter` appends " voice" to the age+gender group itself, so
 * a "male voice" term would emit "...male voice voice".
 */
export function getVoiceAgeTerm(id: string | undefined | null): string {
  return resolveTerm(getVoiceAge(id ?? undefined))
}
export function getVoiceGenderTerm(id: string | undefined | null): string {
  return resolveTerm(getVoiceGender(id ?? undefined))
}
export function getVoiceLanguageTerm(id: string | undefined | null): string {
  return resolveTerm(getVoiceLanguage(id ?? undefined))
}
export function getVoiceAccentTerm(id: string | undefined | null): string {
  return resolveTerm(getVoiceAccent(id ?? undefined))
}
export function getVoiceTimbreTerm(id: string | undefined | null): string {
  return resolveTerm(getVoiceTimbre(id ?? undefined))
}

/** The consumer fields a voice-character clause is composed from. */
type VoiceCharacterFieldSource = {
  readonly preText?: string
  readonly postText?: string
  readonly age?: string
  readonly gender?: string
  readonly language?: string | ReadonlyArray<string>
  readonly accent?: string
  readonly timbre?: string
}

/**
 * How one composition mode turns catalog entries into fragments.
 *
 * `of` picks the fragment (the long `promptHint`, or the compact `term`), and
 * `trait` attaches the dimension noun: the bare hint fragments always need it
 * ("warm" → "warm timbre"), while the compact mode appends it only when the
 * fragment does not already end in it ("warm timbre" is passed through as
 * authored, a term-less "bavarian" still becomes "bavarian accent").
 */
interface VoiceCharacterMode {
  readonly of: (entry: VoiceCharacterEntry | undefined) => string
  readonly trait: (fragment: string, noun: "timbre" | "accent") => string
}

/**
 * The shared composition both modes walk, so the verbose and compact clauses
 * can never drift in shape — same field order, same "voice with X and Y"
 * skeleton, same language / preText / postText handling.
 */
function composeVoiceCharacter(data: VoiceCharacterFieldSource, mode: VoiceCharacterMode): string {
  const fragments: string[] = []
  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const age = mode.of(getVoiceAge(data.age))
  const gender = mode.of(getVoiceGender(data.gender))
  const accent = mode.of(getVoiceAccent(data.accent))
  const timbre = mode.of(getVoiceTimbre(data.timbre))

  const langIds = pickIds(data.language)
  const langFragments = langIds
    .map((id) => mode.of(getVoiceLanguage(id)))
    .filter((h) => !!h)
  const langClause = langFragments.join(" / ")

  const ageGender = [age, gender].filter(Boolean).join(" ")
  const traits: string[] = []
  if (timbre) traits.push(mode.trait(timbre, "timbre"))
  if (accent) traits.push(mode.trait(accent, "accent"))

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
export function buildVoiceCharacterHints(data: VoiceCharacterFieldSource, mode: PickerHintMode = "full"): string {
  if (mode === "compact") return buildVoiceCharacterTerms(data)
  return composeVoiceCharacter(data, {
    of: (entry) => entry?.promptHint ?? "",
    trait: (fragment, noun) => `${fragment} ${noun}`,
  })
}

/**
 * Attach the dimension noun unless the fragment already ends with it.
 *
 * Every accent and timbre entry authors a noun-bearing term today ("warm
 * timbre", "boston accent"), and this keeps that from being an ASSUMPTION the
 * compact clause silently depends on: an entry added later with no `term`
 * derives a bare "bavarian" from its label, and the noun is attached here
 * rather than shipping a lone modifier no model can read as an accent.
 */
function withDimensionNoun(fragment: string, noun: "timbre" | "accent"): string {
  return fragment === noun || fragment.endsWith(` ${noun}`) ? fragment : `${fragment} ${noun}`
}

/**
 * The COMPACT counterpart of `buildVoiceCharacterHints`: the same clause
 * skeleton, built from each selection's short professional term instead of its
 * hint fragment. The dimension noun is attached idempotently — an authored
 * term already carries it ("warm timbre", "received pronunciation accent") and
 * passes through untouched.
 * Examples:
 *   { age, gender, timbre, accent } → "middle-aged male voice with warm timbre and received pronunciation accent"
 *   { timbre }                      → "warm timbre"
 *   { language: ["english","spanish"] } → "english / spanish voice"
 *   { }                             → ""
 */
export function buildVoiceCharacterTerms(data: VoiceCharacterFieldSource): string {
  return composeVoiceCharacter(data, {
    of: (entry) => resolveTerm(entry),
    trait: withDimensionNoun,
  })
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
