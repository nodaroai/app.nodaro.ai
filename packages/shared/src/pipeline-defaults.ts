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

/**
 * Maximum user-turn count per stage for the chat refine flow. Enforced by
 * the chat POST route (counts existing `role='user'` rows and rejects when
 * the cap is reached). 1D.2b ships **Script chat only** per the LLM Spec
 * v4.0 narrowing — `shot_list` + `post_merge` caps are pre-declared so
 * adding their chat surfaces in 1D.2d only needs route+UI wiring, not a
 * type/constant change.
 */
export const CHAT_TURN_CAPS = {
  script: 20,
  shot_list: 15,
  post_merge: 8,
} as const

/**
 * Pipeline entity error code emitted by Phase 1D.2c-a image critics
 * (Stage 2 Characters + Stage 4 Locations) and any future image-level
 * validators. Constant lets the frontend compare equality (not substring)
 * and the backend writes a single canonical value.
 *
 * Written to `pipeline_entities.metadata.last_error` after the critic retry
 * cap exhausts. Auto-mode's failure-aggregator (`detectImageCriticFailures`
 * + `failPipelineForImageCriticUnresolvable`) reads this exact value.
 */
export const IMAGE_CRITIC_UNRESOLVABLE = "image_critic_unresolvable"

/**
 * Maximum critic-feedback retry budget per entity in Phase 1D.2c-a image
 * critics. Each fail triggers a regeneration with critic suggestions injected
 * into the prompt; after this many retries the entity is marked failed and
 * surfaces in EntityCard with recovery buttons.
 */
export const IMAGE_CRITIC_MAX_RETRIES = 2

/**
 * Score threshold below which the critic's verdict is overridden to "fail"
 * regardless of the verdict field. Defends against an overly lenient critic
 * that says verdict='pass' on a borderline image. The numeric score (0-10)
 * is enforced by the schema and the system prompt anchors the meaning.
 */
export const IMAGE_CRITIC_MIN_ADHERENCE_SCORE = 5

/**
 * Metadata keys written by the image-critic retry loop (Phase 1D.2c-a)
 * onto `pipeline_entities.metadata` when an entity's critic budget is
 * exhausted. The retry-image-generation route clears these to reset the
 * entity to a fresh attempt; EntityCard reads them to render findings +
 * the failed image.
 *
 * Single source of truth so the writer (`_image-critic-loop.ts`) and the
 * clearer (`routes/pipelines.ts:retry-image-generation`) can't drift.
 */
export const IMAGE_CRITIC_METADATA_KEYS = [
  "last_error",
  "last_error_at",
  "critic_findings",
  "last_attempted_image_url",
  "last_attempted_asset_id",
  "image_critic_retry_count",
] as const

export type ImageCriticMetadataKey = (typeof IMAGE_CRITIC_METADATA_KEYS)[number]

/**
 * Removes every {@link IMAGE_CRITIC_METADATA_KEYS} entry from a metadata
 * blob, returning a shallow copy. Used by the retry-image-generation route
 * to wipe critic-only state while preserving everything else (`name`,
 * `voice_match`, `reject_count`, etc.).
 */
export function clearImageCriticMetadata(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!meta) return {}
  const next: Record<string, unknown> = { ...meta }
  for (const key of IMAGE_CRITIC_METADATA_KEYS) {
    delete next[key]
  }
  return next
}

export type ChatEnabledStage = keyof typeof CHAT_TURN_CAPS

/**
 * Ordered list of stages with chat enabled. **In 1D.2b only `script`
 * actually has chat code paths wired** — the others are pre-declared for
 * 1D.2d. Route-level guards filter on `script` until then.
 */
export const CHAT_ENABLED_STAGES: readonly ChatEnabledStage[] = [
  "script",
  "shot_list",
  "post_merge",
]
