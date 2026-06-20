/**
 * Audio FX node — preset id union (single source of truth).
 *
 * Shared so the backend Zod route enum, the frontend config dropdown, and the
 * `AudioFxData` node type can't drift. The per-preset FFmpeg filter chains
 * (IR DUR/SHAPE, delay/EQ knobs) live in the backend provider's PRESET_CHAINS
 * map — this file only fixes the id set + their human labels.
 *
 * Reverb presets are named by ON-SCREEN SCENARIO (where the voice is happening
 * in the scene) rather than abstract size, so a creator picking "Church" or
 * "Car" gets a believable space for that shot.
 */

export const AUDIO_FX_PRESETS = [
  // — reverb / spaces (afir + inline-synth IR), ordered small → large —
  "room",          // ordinary indoor room — bedroom / office dialogue
  "bathroom",      // small, bright, tiled — hard early reflections
  "car",           // tight, very damped cabin
  "hall",          // lobby / corridor / large room
  "concert-hall",  // big, lush, musical tail
  "church",        // cathedral — long, dark, reverberant
  "cave",          // dark, diffuse, long
  "arena",         // stadium / PA — huge, bright tail
  "outdoor",       // open air — almost dry, faint early reflections
  // — character / non-reverb —
  "telephone",     // band-limited phone line
  "megaphone",     // PA / bullhorn — mid-forward + light grit
  "echo",          // discrete echo / slap-back
  "custom",        // manual: reverb wet · delay · EQ
] as const

export type AudioFxPreset = (typeof AUDIO_FX_PRESETS)[number]

export const AUDIO_FX_PRESET_SET: ReadonlySet<string> = new Set(AUDIO_FX_PRESETS)

/** Display labels for the config dropdown. */
export const AUDIO_FX_PRESET_LABELS: Record<AudioFxPreset, string> = {
  room: "Room (indoor)",
  bathroom: "Bathroom",
  car: "Car interior",
  hall: "Hall / Lobby",
  "concert-hall": "Concert Hall",
  church: "Church",
  cave: "Cave",
  arena: "Arena / Stadium",
  outdoor: "Outdoor (open air)",
  telephone: "Telephone",
  megaphone: "Megaphone / PA",
  echo: "Echo / Slap-back",
  custom: "Custom",
}

/** Presets that apply convolution reverb (afir + inline-synth IR). */
export const AUDIO_FX_REVERB_PRESETS: ReadonlySet<AudioFxPreset> = new Set<AudioFxPreset>([
  "room",
  "bathroom",
  "car",
  "hall",
  "concert-hall",
  "church",
  "cave",
  "arena",
  "outdoor",
])
