export const PIPELINE_TYPES = ["story_to_video", "song_to_music_video"] as const
export type PipelineType = (typeof PIPELINE_TYPES)[number]

export const PIPELINE_FORMATS = [
  "trailer",
  "short_film",
  "music_video",
  "reel",
  "commercial",
] as const
export type PipelineFormat = (typeof PIPELINE_FORMATS)[number]

export const PIPELINE_MODES = ["manual", "auto", "guided"] as const
export type PipelineMode = (typeof PIPELINE_MODES)[number]

export const PIPELINE_ACTIVATION_MODES = ["interactive", "programmatic"] as const
export type PipelineActivationMode = (typeof PIPELINE_ACTIVATION_MODES)[number]

export const PIPELINE_OUTPUT_RESOLUTIONS = ["720p", "1080p", "4K"] as const
export type PipelineOutputResolution = (typeof PIPELINE_OUTPUT_RESOLUTIONS)[number]

export const PER_FORMAT_DURATION_BOUNDS: Record<
  PipelineFormat,
  { min: number; max: number }
> = {
  reel: { min: 7, max: 90 },
  commercial: { min: 10, max: 90 },
  trailer: { min: 30, max: 180 },
  short_film: { min: 30, max: 600 },
  music_video: { min: 30, max: 600 },
}

export const GLOBAL_MAX_DURATION_SECONDS = 600

export function validateDurationForFormat(
  format: PipelineFormat,
  seconds: number,
): { ok: true } | { ok: false; reason: string } {
  if (seconds > GLOBAL_MAX_DURATION_SECONDS) {
    return { ok: false, reason: `target_duration_seconds must be <= ${GLOBAL_MAX_DURATION_SECONDS}` }
  }
  const bounds = PER_FORMAT_DURATION_BOUNDS[format]
  if (seconds < bounds.min || seconds > bounds.max) {
    return {
      ok: false,
      reason: `${format} requires duration in [${bounds.min}, ${bounds.max}] seconds`,
    }
  }
  return { ok: true }
}

export function validateModeActivation(
  mode: PipelineMode,
  activation: PipelineActivationMode,
): { ok: true } | { ok: false; reason: string } {
  if (activation === "programmatic" && mode === "guided") {
    return {
      ok: false,
      reason: "Programmatic activation cannot use guided mode (no user for chat turns)",
    }
  }
  return { ok: true }
}

// Tier → max parallel pipelines (Architecture §5.4)
export const TIER_PIPELINE_PARALLELISM: Record<string, number> = {
  free: 0,
  basic: 1,
  standard: 2,
  pro: 3,
  business: 5,
}

// Tier → default hard cost cap when max_cost_credits omitted (Architecture §6.6.3)
export const TIER_MAX_PIPELINE_COST_CREDITS: Record<string, number> = {
  free: 0,
  basic: 300,
  standard: 800,
  pro: 2000,
  business: 5000,
}

// Per-stage soft timeout (matches workflow-orchestration)
export const PIPELINE_STAGE_TIMEOUT_MS = 30 * 60 * 1000
export const PIPELINE_HARD_TIMEOUT_MS = 90 * 60 * 1000

/**
 * Per-stage hard retry caps applied to image-gen for that stage.
 * Pipeline-level credit cap (max_cost_credits) is the ultimate guard, but
 * these prevent a single stage from sucking all the budget.
 */
export const ENTITY_TOOL_RETRY_CAP = 3 // tool-level failure retries per entity

/**
 * Default variant counts when ShowrunnerPlan doesn't suggest specifics.
 */
export const DEFAULT_CHARACTER_ANGLE_COUNT = 3 // main + 2 variants for non-protagonist
export const DEFAULT_CHARACTER_EXPRESSION_COUNT = 2 // baseline expression variants

/**
 * Max location variants generated even if Showrunner suggests more — cost guard.
 */
export const MAX_LOCATION_VARIANTS = 4
