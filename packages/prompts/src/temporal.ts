/**
 * Canonical catalog of temporal modifiers.
 *
 * Temporal is the speed / freeze / direction / shutter dimension of a video —
 * how time flows through the shot. Distinct from the post-process Speed Ramp
 * FFmpeg node (which operates on an existing rendered video); these are
 * prompt-time guidance hints for the generator model so it produces footage
 * that already embeds the temporal intent. Independent of lighting, color,
 * lens, camera motion, etc.
 *
 * Video-only: stills can't have motion or a speed, so image-gen consumers
 * don't read this field.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export type TemporalCategory = "speed" | "freeze" | "direction" | "shutter"

export interface Temporal {
  readonly id: string
  readonly label: string
  readonly category: TemporalCategory
  readonly description: string
  readonly promptHint: string
}

export const TEMPORALS: ReadonlyArray<Temporal> = [
  // Speed (6)
  { id: "real-time",      label: "Real-time",         category: "speed",     description: "Normal playback speed",                   promptHint: "real-time playback, normal speed" },
  { id: "slow-motion",    label: "Slow Motion",       category: "speed",     description: "Moderately slowed footage",               promptHint: "slow motion, footage slowed down with smooth deliberate movement" },
  { id: "super-slow-mo",  label: "Super Slow-mo",     category: "speed",     description: "Extremely slow footage",                  promptHint: "super slow motion, extreme high-speed slow-mo capturing motion at a fraction of real time" },
  { id: "time-lapse",     label: "Time-lapse",        category: "speed",     description: "Compressed time, fast passage",           promptHint: "time-lapse, highly compressed time showing hours or days passing in seconds" },
  { id: "hyper-lapse",    label: "Hyper-lapse",       category: "speed",     description: "Moving time-lapse",                       promptHint: "hyper-lapse, time-lapse combined with forward camera motion, accelerated movement through space" },
  { id: "speed-ramp",     label: "Speed Ramp",        category: "speed",     description: "Dynamic speed change mid-shot",           promptHint: "speed ramp, dynamic speed change within the shot from slow motion to real-time or faster" },

  // Freeze (4)
  { id: "full-freeze",    label: "Full Freeze-frame", category: "freeze",    description: "All motion frozen",                       promptHint: "full freeze-frame, all motion in the scene completely frozen like a photograph" },
  { id: "bullet-time",    label: "Bullet Time",       category: "freeze",    description: "Subject frozen, camera orbits",           promptHint: "bullet time effect, subject completely frozen mid-motion while camera orbits around them, Matrix-style" },
  { id: "frozen-subject", label: "Frozen Subject",    category: "freeze",    description: "Subject frozen, world moves",             promptHint: "frozen subject with moving world, subject remains completely still while the environment continues in motion" },
  { id: "moving-subject", label: "Moving Subject",    category: "freeze",    description: "Subject moves, world frozen",             promptHint: "moving subject with frozen world, subject continues in motion while everything else in the scene is completely frozen" },

  // Direction (3)
  { id: "forward",        label: "Forward",           category: "direction", description: "Normal forward playback",                 promptHint: "forward playback, time moving forward in the natural direction" },
  { id: "reverse",        label: "Reverse / Rewind",  category: "direction", description: "Time plays backwards",                    promptHint: "reverse playback, time and motion running backwards" },
  { id: "loop-boomerang", label: "Loop / Boomerang",  category: "direction", description: "Forward then reverse",                    promptHint: "boomerang loop, playing forward then reversing back, creating a looping motion" },

  // Shutter (5)
  { id: "long-exposure",  label: "Long Exposure",     category: "shutter",   description: "Motion trails and streaks",               promptHint: "long exposure effect, motion trails and light streaks from slow shutter speed" },
  { id: "crisp-shutter",  label: "Crisp Shutter",     category: "shutter",   description: "Sharp motion, no blur",                   promptHint: "crisp shutter, sharp motion captured with fast shutter speed and no motion blur" },
  { id: "motion-blur",    label: "Motion Blur",       category: "shutter",   description: "Pronounced directional blur",             promptHint: "pronounced motion blur, moving subjects blur directionally from slower-than-normal shutter speed" },
  { id: "stutter-strobe", label: "Stutter / Strobe",  category: "shutter",   description: "Strobe-effect jerky motion",              promptHint: "stutter or strobe effect, jerky discontinuous motion with visible frame steps" },
  { id: "stop-motion",    label: "Stop-motion",       category: "shutter",   description: "Stepped frame-by-frame motion",           promptHint: "stop-motion animation style, stepped frame-by-frame motion with characteristic discrete movement" },
] as const

export const TEMPORAL_CATEGORY_ORDER: ReadonlyArray<TemporalCategory> = [
  "speed",
  "freeze",
  "direction",
  "shutter",
]

export const TEMPORAL_CATEGORY_LABELS: Record<TemporalCategory, string> = {
  speed: "Speed",
  freeze: "Freeze",
  direction: "Direction",
  shutter: "Shutter",
}

const temporalById = new Map<string, Temporal>(TEMPORALS.map((t) => [t.id, t]))

export function getTemporal(id: string | undefined | null): Temporal | undefined {
  if (!id) return undefined
  return temporalById.get(id)
}

export function getTemporalLabel(id: string | undefined | null, fallback?: string): string {
  const t = getTemporal(id)
  if (t) return t.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getTemporalPromptHint(id: string | undefined | null): string {
  return getTemporal(id)?.promptHint ?? ""
}

export const TEMPORAL_IDS: ReadonlyArray<string> = TEMPORALS.map((t) => t.id)

/**
 * Maps each TemporalCategory to the consumer data field name that holds the
 * selected entry id for that category. Multi-category temporal: a consumer
 * (video-only) can independently set a value in each of the 4 dimensions.
 *
 * Field names use 'temporal' prefix throughout to avoid collisions: 'direction'
 * collides with Lighting's 'direction' category; 'speed', 'shutter', and
 * 'freeze' are generic vocabulary.
 */
export const TEMPORAL_FIELD_BY_CATEGORY: Record<
  TemporalCategory,
  "temporalSpeed" | "temporalFreeze" | "temporalDirection" | "temporalShutter"
> = {
  speed: "temporalSpeed",
  freeze: "temporalFreeze",
  direction: "temporalDirection",
  shutter: "temporalShutter",
}

/**
 * Shape of the per-category temporal fields on TemporalData and the 5 video
 * consumer data types. All fields optional — user may set zero, one, or all
 * categories.
 */
export interface TemporalValue {
  temporalSpeed?: string
  temporalFreeze?: string
  temporalDirection?: string
  temporalShutter?: string
}

const TEMPORAL_FIELDS_IN_ORDER: ReadonlyArray<readonly [keyof TemporalValue, TemporalCategory]> =
  TEMPORAL_CATEGORY_ORDER.map((cat) => [TEMPORAL_FIELD_BY_CATEGORY[cat], cat] as const)

/**
 * Aggregate all enabled per-category temporal prompt hints from a consumer's
 * data, in canonical category order (speed, freeze, direction, shutter).
 *
 * Accepts a loosely typed record (the helper is shared between strongly typed
 * frontend node data and the backend's `Record<string, unknown>` workflow
 * data). Non-string values are ignored.
 *
 * @param data the consumer data record (must include optional temporalSpeed /
 *   temporalFreeze / temporalDirection / temporalShutter fields)
 */
export function buildTemporalHints(
  data: Record<string, unknown> & {
    temporalSpeed?: unknown
    temporalFreeze?: unknown
    temporalDirection?: unknown
    temporalShutter?: unknown
  },
): string[] {
  const hints: string[] = []
  for (const [field] of TEMPORAL_FIELDS_IN_ORDER) {
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getTemporalPromptHint(id)
    if (hint) hints.push(hint)
  }
  return hints
}
