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

export const PIPELINE_OUTPUT_RESOLUTIONS = ["480p", "720p", "1080p", "4K"] as const
export type PipelineOutputResolution = (typeof PIPELINE_OUTPUT_RESOLUTIONS)[number]

export const PER_FORMAT_DURATION_BOUNDS: Record<
  PipelineFormat,
  { min: number; max: number }
> = {
  reel: { min: 7, max: 90 },
  commercial: { min: 10, max: 90 },
  trailer: { min: 30, max: 180 },
  short_film: { min: 12, max: 600 },
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
// Hard ceiling for a SINGLE orchestrator drive (pipeline-worker aborts the
// in-flight drive when this fires). One drive runs a whole stage's work; the
// heaviest is animate_audio_edit, which fans out every scene × every shot
// (KIE video gen + per-shot critic + audio + merge). For a multi-scene film
// that legitimately exceeds 90 min — the old value aborted such drives
// mid-fan-out, and before the scene-level resume short-circuit landed each
// retry restarted from scratch and tripped the resume cap (prod pipeline
// 64b76ed9). 4 h gives a heavy drive room to finish in one pass while staying
// well under the reconcile cron's 6 h abandon threshold. Worker concurrency is
// 5, so even a pathological long drive leaves 4 slots free.
export const PIPELINE_HARD_TIMEOUT_MS = 4 * 60 * 60 * 1000

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

/**
 * Phase 1D.2c-b-ii — Video Critic frame extraction modes.
 * Each pipeline picks one via PipelineInput.video_critic_frame_count.
 * Default 'first_last' uses the input keyframe + extractLastFrame output
 * (both already produced by Stage 6 + extractLastFrame call), so no new
 * frame extractions are needed in the default case.
 */
export const VIDEO_CRITIC_FRAME_MODES = ["first_last", "first_middle_last", "five_evenly"] as const
export type VideoCriticFrameMode = (typeof VIDEO_CRITIC_FRAME_MODES)[number]

/** Cap=1 retry per shot — cost-aware [figures removed]. */
export const VIDEO_CRITIC_MAX_RETRIES = 1

/** Auto-fail threshold for both prompt_adherence_score and continuity_score. */
export const VIDEO_CRITIC_MIN_ADHERENCE_SCORE = 5

/**
 * Phase 1D.2c-b-ii — Video Critic ShotSpec sibling field names that get
 * persisted by the per-shot retry loop (`runVideoCriticLoopForShot` in
 * `scene-internal-pipeline.ts`) and stripped by the retry-video-generation
 * recovery route + the frontend Regenerate button.
 *
 * Single source of truth so the writer + clearer can't drift. Mirror of
 * {@link IMAGE_CRITIC_METADATA_KEYS} for the entity-level image critic.
 */
export const VIDEO_CRITIC_METADATA_KEYS = [
  "video_critic_findings",
  "video_critic_score",
  "video_critic_continuity_score",
  "video_critic_identified_action",
  "video_critic_retry_count",
  "video_critic_last_attempted_url",
  "video_critic_failed",
  "video_critic_verdict",
] as const

export type VideoCriticMetadataKey = (typeof VIDEO_CRITIC_METADATA_KEYS)[number]

/**
 * Returns a shallow copy of `shot` with all `video_critic_*` keys stripped.
 * Used by the retry-video-generation route + frontend Regenerate handler to
 * reset a shot to a fresh critic attempt while preserving everything else
 * (camera, action, motion_prompt, …).
 */
export function clearVideoCriticMetadata<T extends Record<string, unknown>>(
  shot: T,
): Omit<T, VideoCriticMetadataKey> {
  const cleaned = { ...shot } as Record<string, unknown>
  for (const key of VIDEO_CRITIC_METADATA_KEYS) {
    delete cleaned[key]
  }
  return cleaned as Omit<T, VideoCriticMetadataKey>
}

/**
 * Phase 1D.2 — single source of truth for chat-stage configuration.
 *
 * `wired: true` = the route has a specialist implemented + the LLM emits
 *                 valid `ChatTurnResponse` for this stage's artifact.
 * `wired: false` = stage is in the v0.5 spec but not yet implemented
 *                  (the chat POST returns HTTP 501 `chat_not_wired_for_stage`).
 *
 * Per spec §5.12 v0.5: `script` + `shot_list` + `post_merge`.
 *
 * - `script`: wired in 1D.2b (chat-refine-showrunner)
 * - `post_merge`: wired in 1D.2c (chat-refine-postmerge; suggest_branch only)
 * - `shot_list`: pre-declared, ships in 1D.2d (blocked by v4.0 per-scene
 *   architecture)
 *
 * Prefer reading `CHAT_STAGES[stage].wired` directly in new code; the
 * sibling `CHAT_ENABLED_STAGES` / `CHAT_WIRED_STAGES` exports below are
 * derived and remain for backward compatibility with existing call sites.
 */
export const CHAT_STAGES = {
  script: { wired: true },
  shot_list: { wired: false },
  post_merge: { wired: true },
} as const

export type ChatEnabledStage = keyof typeof CHAT_STAGES

/**
 * Ordered list of stages with chat enabled. Derived from {@link CHAT_STAGES}.
 * **In 1D.2c, `script` AND `post_merge` have chat code paths wired** —
 * post-merge ships with a dedicated `chat-refine-postmerge` specialist
 * (suggest_branch only — see {@link STAGE_PATCH_SCHEMA}, `post_merge` stays
 * `null` since the merged video isn't user-editable in place). `shot_list`
 * is pre-declared for 1D.2d. The route's chat dispatch checks
 * {@link CHAT_WIRED_STAGES} to decide which specialist to invoke (or 501
 * for unwired stages).
 */
export const CHAT_ENABLED_STAGES: readonly ChatEnabledStage[] = Object.keys(
  CHAT_STAGES,
) as ChatEnabledStage[]

/**
 * Per-stage boolean map of whether chat code paths are actually wired
 * end-to-end. Derived from {@link CHAT_STAGES}. The chat POST route reads
 * this to decide whether to invoke a specialist (true) or return 501
 * `chat_not_wired_for_stage` (false).
 */
export const CHAT_WIRED_STAGES: Record<ChatEnabledStage, boolean> = {
  script: CHAT_STAGES.script.wired,
  shot_list: CHAT_STAGES.shot_list.wired,
  post_merge: CHAT_STAGES.post_merge.wired,
}
