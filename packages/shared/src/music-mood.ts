/**
 * Music mood catalog: energy + emotion + vibe sub-fields.
 * Composed by buildMusicMoodHints into "[energy] [emotion] [vibe]".
 */

export interface MusicMoodEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const MUSIC_ENERGIES: ReadonlyArray<MusicMoodEntry> = [
  { id: "low",          label: "Low",          description: "Calm, slow",            promptHint: "low-energy" },
  { id: "mellow",       label: "Mellow",       description: "Relaxed, laid-back",    promptHint: "mellow" },
  { id: "moderate",     label: "Moderate",     description: "Balanced, steady",      promptHint: "moderate-energy" },
  { id: "upbeat",       label: "Upbeat",       description: "Lively, optimistic",    promptHint: "upbeat" },
  { id: "high",         label: "High",         description: "Energetic, driving",    promptHint: "high-energy" },
  { id: "frenetic",     label: "Frenetic",     description: "Intense, rapid",        promptHint: "frenetic" },
] as const

export const MUSIC_EMOTIONS: ReadonlyArray<MusicMoodEntry> = [
  { id: "happy",        label: "Happy",        description: "Joyful, bright",        promptHint: "happy" },
  { id: "melancholic",  label: "Melancholic",  description: "Wistful, bittersweet",  promptHint: "melancholic" },
  { id: "sad",          label: "Sad",          description: "Somber, sorrowful",     promptHint: "sad" },
  { id: "angry",        label: "Angry",        description: "Aggressive, hostile",   promptHint: "angry" },
  { id: "triumphant",   label: "Triumphant",   description: "Heroic, victorious",    promptHint: "triumphant" },
  { id: "tender",       label: "Tender",       description: "Soft, affectionate",    promptHint: "tender" },
  { id: "haunting",     label: "Haunting",     description: "Eerie, lingering",      promptHint: "haunting" },
  { id: "playful",      label: "Playful",      description: "Whimsical, fun",        promptHint: "playful" },
  { id: "anxious",      label: "Anxious",      description: "Tense, apprehensive",   promptHint: "anxious" },
  { id: "hopeful",      label: "Hopeful",      description: "Uplifting, aspirational", promptHint: "hopeful" },
  { id: "nostalgic",    label: "Nostalgic",    description: "Backward-looking, wistful", promptHint: "nostalgic" },
  { id: "ethereal",     label: "Ethereal",     description: "Otherworldly, floating", promptHint: "ethereal" },
] as const

export const MUSIC_VIBES: ReadonlyArray<MusicMoodEntry> = [
  { id: "cinematic",    label: "Cinematic",    description: "Score-like, evocative", promptHint: "cinematic" },
  { id: "intimate",     label: "Intimate",     description: "Personal, close",       promptHint: "intimate" },
  { id: "epic",         label: "Epic",         description: "Grand, sweeping",       promptHint: "epic" },
  { id: "lo-fi",        label: "Lo-fi",        description: "Warm, imperfect",       promptHint: "lo-fi" },
  { id: "polished",     label: "Polished",     description: "Pristine, mainstream",  promptHint: "polished" },
  { id: "raw",          label: "Raw",          description: "Unfiltered, gritty",    promptHint: "raw" },
  { id: "dreamy",       label: "Dreamy",       description: "Hazy, surreal",         promptHint: "dreamy" },
  { id: "dark",         label: "Dark",         description: "Brooding, shadowy",     promptHint: "dark" },
  { id: "uplifting",    label: "Uplifting",    description: "Bright, encouraging",   promptHint: "uplifting" },
  { id: "tense",        label: "Tense",        description: "Suspenseful",           promptHint: "tense" },
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
  readonly energy?: string
  readonly emotion?: string
  readonly vibe?: string
}): string {
  const parts: string[] = []
  const e = getMusicEnergy(data.energy)
  if (e) parts.push(e.promptHint)
  const m = getMusicEmotion(data.emotion)
  if (m) parts.push(m.promptHint)
  const v = getMusicVibe(data.vibe)
  if (v) parts.push(v.promptHint)
  return parts.join(" ")
}

export const MUSIC_MOOD_DEFAULT_DATA: {
  energy?: string; emotion?: string; vibe?: string
} = {}
