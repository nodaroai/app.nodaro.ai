/**
 * Music mood catalog: energy + emotion + vibe sub-fields.
 * Composed by buildMusicMoodHints into "[energy] [emotion] [vibe]".
 */

import { pickIds } from "./multi-pick.js"

export interface MusicMoodEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const MUSIC_ENERGIES: ReadonlyArray<MusicMoodEntry> = [
  { id: "low",          label: "Low",          description: "Calm, slow",                 promptHint: "low-energy" },
  { id: "mellow",       label: "Mellow",       description: "Relaxed, laid-back",         promptHint: "mellow" },
  { id: "gentle",       label: "Gentle",       description: "Soft, tender",               promptHint: "gentle" },
  { id: "moderate",     label: "Moderate",     description: "Balanced, steady",           promptHint: "moderate-energy" },
  { id: "building",     label: "Building",     description: "Slowly intensifying",        promptHint: "building energy" },
  { id: "upbeat",       label: "Upbeat",       description: "Lively, optimistic",         promptHint: "upbeat" },
  { id: "driving",      label: "Driving",      description: "Forward-pushing momentum",   promptHint: "driving" },
  { id: "high",         label: "High",         description: "Energetic, intense",         promptHint: "high-energy" },
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
  { id: "awe",          label: "Awe",          description: "Wonder, vastness",           promptHint: "awe-inspiring" },
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
  return id ? ENERGY_BY_ID.get(id) : undefined
}
export function getMusicEmotion(id: string | undefined): MusicMoodEntry | undefined {
  return id ? EMOTION_BY_ID.get(id) : undefined
}
export function getMusicVibe(id: string | undefined): MusicMoodEntry | undefined {
  return id ? VIBE_BY_ID.get(id) : undefined
}

export function buildMusicMoodHints(data: {
  readonly preText?: string
  readonly postText?: string
  readonly energy?: string
  readonly emotion?: string | ReadonlyArray<string>
  readonly vibe?: string | ReadonlyArray<string>
}): string {
  const fragments: string[] = []
  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) fragments.push(pre)

  const parts: string[] = []
  const e = getMusicEnergy(data.energy)
  if (e) parts.push(e.promptHint)

  const emotionHints = pickIds(data.emotion)
    .map((id) => getMusicEmotion(id)?.promptHint)
    .filter((h): h is string => !!h)
  if (emotionHints.length > 0) parts.push(emotionHints.join(", "))

  const vibeHints = pickIds(data.vibe)
    .map((id) => getMusicVibe(id)?.promptHint)
    .filter((h): h is string => !!h)
  if (vibeHints.length > 0) parts.push(vibeHints.join(", "))

  if (parts.length > 0) fragments.push(parts.join(" "))

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) fragments.push(post)

  return fragments.join(", ")
}

export const MUSIC_MOOD_DEFAULT_DATA: {
  preText?: string; postText?: string; energy?: string; emotion?: string | ReadonlyArray<string>; vibe?: string | ReadonlyArray<string>
} = {}
