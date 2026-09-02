/**
 * Music mood catalog: energy + emotion + vibe sub-fields.
 * Composed by buildMusicMoodHints into "[energy] [emotion] [vibe]".
 */

import { pickIds } from "@nodaro/shared"

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"

export interface MusicMoodEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  /**
   * Compact professional term injected in compact hint mode (see `term.ts`).
   *
   * Authored only where the lowercased label is NOT the phrase a music
   * supervisor would write — the bare-degree energies ("Low"/"Moderate"/
   * "High" mean nothing without "energy" attached) and the noun-shaped
   * "Awe". Everywhere else the label already IS the trade descriptor and
   * `resolveTerm` derives it.
   */
  readonly term?: string
}

export const MUSIC_ENERGIES: ReadonlyArray<MusicMoodEntry> = [
  { id: "low",          label: "Low",          description: "Calm, slow",                 promptHint: "low-energy", term: "low-energy" },
  { id: "mellow",       label: "Mellow",       description: "Relaxed, laid-back",         promptHint: "mellow" },
  { id: "gentle",       label: "Gentle",       description: "Soft, tender",               promptHint: "gentle" },
  { id: "moderate",     label: "Moderate",     description: "Balanced, steady",           promptHint: "moderate-energy", term: "moderate-energy" },
  { id: "building",     label: "Building",     description: "Slowly intensifying",        promptHint: "building energy", term: "building energy" },
  { id: "upbeat",       label: "Upbeat",       description: "Lively, optimistic",         promptHint: "upbeat" },
  { id: "driving",      label: "Driving",      description: "Forward-pushing momentum",   promptHint: "driving" },
  { id: "high",         label: "High",         description: "Energetic, intense",         promptHint: "high-energy", term: "high-energy" },
  { id: "explosive",    label: "Explosive",    description: "Bursting, wild",             promptHint: "explosive" },
  { id: "frenetic",     label: "Frenetic",     description: "Intense, rapid",             promptHint: "frenetic" },
  { id: "pulsing",      label: "Pulsing",      description: "Rhythmic, beat-driven",      promptHint: "pulsing" },
  { id: "throbbing",    label: "Throbbing",    description: "Heavy, hypnotic",            promptHint: "throbbing" },
  { id: "simmering",    label: "Simmering",    description: "Tense, restrained",          promptHint: "simmering" },
  { id: "ferocious",    label: "Ferocious",    description: "Aggressive, relentless",     promptHint: "ferocious" },
] as const

export const MUSIC_EMOTIONS: ReadonlyArray<MusicMoodEntry> = [
  { id: "happy",        label: "Happy",        description: "Joyful, bright",             promptHint: "happy" },
  { id: "joyful",       label: "Joyful",       description: "Exuberant, celebratory",     promptHint: "joyful" },
  { id: "euphoric",     label: "Euphoric",     description: "Ecstatic, transcendent",     promptHint: "euphoric" },
  { id: "melancholic",  label: "Melancholic",  description: "Wistful, bittersweet",       promptHint: "melancholic" },
  { id: "sad",          label: "Sad",          description: "Somber, sorrowful",          promptHint: "sad" },
  { id: "longing",      label: "Longing",      description: "Yearning, aching",           promptHint: "longing" },
  { id: "lonely",       label: "Lonely",       description: "Isolated, distant",          promptHint: "lonely" },
  { id: "angry",        label: "Angry",        description: "Aggressive, hostile",        promptHint: "angry" },
  { id: "defiant",      label: "Defiant",      description: "Rebellious, resistant",      promptHint: "defiant" },
  { id: "triumphant",   label: "Triumphant",   description: "Heroic, victorious",         promptHint: "triumphant" },
  { id: "victorious",   label: "Victorious",   description: "Conquering, anthemic",       promptHint: "victorious" },
  { id: "tender",       label: "Tender",       description: "Soft, affectionate",         promptHint: "tender" },
  { id: "romantic",     label: "Romantic",     description: "Loving, sensual",            promptHint: "romantic" },
  { id: "haunting",     label: "Haunting",     description: "Eerie, lingering",           promptHint: "haunting" },
  { id: "mysterious",   label: "Mysterious",   description: "Enigmatic, secretive",       promptHint: "mysterious" },
  { id: "menacing",     label: "Menacing",     description: "Threatening, foreboding",    promptHint: "menacing" },
  { id: "playful",      label: "Playful",      description: "Whimsical, fun",             promptHint: "playful" },
  { id: "mischievous",  label: "Mischievous",  description: "Sly, troublemaker",          promptHint: "mischievous" },
  { id: "anxious",      label: "Anxious",      description: "Tense, apprehensive",        promptHint: "anxious" },
  { id: "fearful",      label: "Fearful",      description: "Afraid, panicked",           promptHint: "fearful" },
  { id: "hopeful",      label: "Hopeful",      description: "Uplifting, aspirational",    promptHint: "hopeful" },
  { id: "inspirational",label: "Inspirational",description: "Motivational, soaring",      promptHint: "inspirational" },
  { id: "nostalgic",    label: "Nostalgic",    description: "Backward-looking, wistful",  promptHint: "nostalgic" },
  { id: "bittersweet",  label: "Bittersweet",  description: "Sweet sorrow, mixed",        promptHint: "bittersweet" },
  { id: "peaceful",     label: "Peaceful",     description: "Serene, restful",            promptHint: "peaceful" },
  { id: "contemplative",label: "Contemplative",description: "Reflective, thoughtful",     promptHint: "contemplative" },
  { id: "ethereal",     label: "Ethereal",     description: "Otherworldly, floating",     promptHint: "ethereal" },
  { id: "awe",          label: "Awe",          description: "Wonder, vastness",           promptHint: "awe-inspiring", term: "awe-inspiring" },
] as const

export const MUSIC_VIBES: ReadonlyArray<MusicMoodEntry> = [
  { id: "cinematic",    label: "Cinematic",    description: "Score-like, evocative",      promptHint: "cinematic" },
  { id: "intimate",     label: "Intimate",     description: "Personal, close",            promptHint: "intimate" },
  { id: "epic",         label: "Epic",         description: "Grand, sweeping",            promptHint: "epic" },
  { id: "anthemic",     label: "Anthemic",     description: "Crowd-singing big",          promptHint: "anthemic" },
  { id: "lo-fi",        label: "Lo-fi",        description: "Warm, imperfect",            promptHint: "lo-fi" },
  { id: "polished",     label: "Polished",     description: "Pristine, mainstream",       promptHint: "polished" },
  { id: "raw",          label: "Raw",          description: "Unfiltered, gritty",         promptHint: "raw" },
  { id: "dreamy",       label: "Dreamy",       description: "Hazy, surreal",              promptHint: "dreamy" },
  { id: "hypnotic",     label: "Hypnotic",     description: "Looped, trance-like",        promptHint: "hypnotic" },
  { id: "dark",         label: "Dark",         description: "Brooding, shadowy",          promptHint: "dark" },
  { id: "gritty",       label: "Gritty",       description: "Coarse, urban",              promptHint: "gritty" },
  { id: "uplifting",    label: "Uplifting",    description: "Bright, encouraging",        promptHint: "uplifting" },
  { id: "tense",        label: "Tense",        description: "Suspenseful",                promptHint: "tense" },
  { id: "spacey",       label: "Spacey",       description: "Cosmic, vast",               promptHint: "spacey" },
  { id: "psychedelic",  label: "Psychedelic",  description: "Mind-bending, swirling",     promptHint: "psychedelic" },
  { id: "noir",         label: "Noir",         description: "Smoky, hard-boiled",         promptHint: "noir" },
  { id: "vintage",      label: "Vintage",      description: "Retro, period-aged",         promptHint: "vintage" },
  { id: "futuristic",   label: "Futuristic",   description: "Sci-fi, forward-looking",    promptHint: "futuristic" },
  { id: "suspenseful",  label: "Suspenseful",  description: "Dread, edge-of-seat",          promptHint: "suspenseful" },
  { id: "espionage",    label: "Espionage",    description: "Spy-thriller, covert ops",      promptHint: "espionage" },
  { id: "cold",         label: "Cold",         description: "Icy, detached, stark",          promptHint: "cold" },
  { id: "clandestine",  label: "Clandestine",  description: "Secret, shadowy, covert",       promptHint: "clandestine" },
] as const

const ENERGY_BY_ID = new Map(MUSIC_ENERGIES.map((x) => [x.id, x]))
const EMOTION_BY_ID = new Map(MUSIC_EMOTIONS.map((x) => [x.id, x]))
const VIBE_BY_ID = new Map(MUSIC_VIBES.map((x) => [x.id, x]))

export function getMusicEnergy(id: string | undefined): MusicMoodEntry | undefined {
  return id ? overlayEntry("music-mood", id, ENERGY_BY_ID.get(id)) : undefined
}
export function getMusicEmotion(id: string | undefined): MusicMoodEntry | undefined {
  return id ? overlayEntry("music-mood", id, EMOTION_BY_ID.get(id)) : undefined
}
export function getMusicVibe(id: string | undefined): MusicMoodEntry | undefined {
  return id ? overlayEntry("music-mood", id, VIBE_BY_ID.get(id)) : undefined
}

/**
 * The COMPACT counterparts of the `promptHint` lookups: the short professional
 * term a consumer injects instead of the entry's full fragment ("low-energy",
 * "building energy", "awe-inspiring"). Same lookup as the getters above, same
 * empty-string-on-miss behavior, so hint mode and term mode can never disagree
 * about WHICH entry they are describing.
 */
export function getMusicEnergyTerm(id: string | undefined | null): string {
  return resolveTerm(id ? getMusicEnergy(id) : undefined)
}
export function getMusicEmotionTerm(id: string | undefined | null): string {
  return resolveTerm(id ? getMusicEmotion(id) : undefined)
}
export function getMusicVibeTerm(id: string | undefined | null): string {
  return resolveTerm(id ? getMusicVibe(id) : undefined)
}

export interface MusicMoodData {
  readonly preText?: string
  readonly postText?: string
  readonly energy?: string
  readonly emotion?: string | ReadonlyArray<string>
  readonly vibe?: string | ReadonlyArray<string>
}

/** Resolve one multi-pick field's ids into non-empty fragments, in pick order. */
function musicMoodFragments(
  value: string | ReadonlyArray<string> | undefined,
  lookup: (id: string) => MusicMoodEntry | undefined,
  fragmentFor: (entry: MusicMoodEntry) => string,
): string[] {
  return pickIds(value)
    .map((id) => {
      const entry = lookup(id)
      return entry ? fragmentFor(entry) : ""
    })
    .filter((f) => f.length > 0)
}

/**
 * The one walk over the energy / emotion / vibe fields, parameterized by how a
 * single selected entry turns into a fragment. `buildMusicMoodHints` (verbose)
 * and `buildMusicMoodTerms` (compact) both delegate here, so the two can never
 * disagree about WHICH ids contribute or in what order — only about how each
 * one is phrased. Free-text pre/post is user wording and passes through both.
 */
function composeMusicMood(
  data: MusicMoodData,
  fragmentFor: (entry: MusicMoodEntry) => string,
): string {
  const fragments: string[] = []
  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const parts: string[] = []
  const energy = getMusicEnergy(data.energy)
  if (energy) {
    const energyFragment = fragmentFor(energy)
    if (energyFragment) parts.push(energyFragment)
  }

  const emotionFragments = musicMoodFragments(data.emotion, getMusicEmotion, fragmentFor)
  if (emotionFragments.length > 0) parts.push(emotionFragments.join(", "))

  const vibeFragments = musicMoodFragments(data.vibe, getMusicVibe, fragmentFor)
  if (vibeFragments.length > 0) parts.push(vibeFragments.join(", "))

  if (parts.length > 0) fragments.push(parts.join(" "))

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)

  return fragments.join(", ")
}

export function buildMusicMoodHints(data: MusicMoodData, mode: PickerHintMode = "full"): string {
  if (mode === "compact") return buildMusicMoodTerms(data)
  return composeMusicMood(data, (entry) => entry.promptHint)
}

/**
 * The COMPACT counterpart of `buildMusicMoodHints`: the same field walk in the
 * same canonical order, emitting each selection's short professional term
 * instead of its full prompt fragment.
 */
export function buildMusicMoodTerms(data: MusicMoodData): string {
  return composeMusicMood(data, resolveTerm)
}

export const MUSIC_MOOD_DEFAULT_DATA: {
  preText?: string; postText?: string; energy?: string; emotion?: string | ReadonlyArray<string>; vibe?: string | ReadonlyArray<string>
} = {}
