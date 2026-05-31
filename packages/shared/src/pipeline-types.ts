import { z } from "zod"
import {
  PIPELINE_FORMATS,
  PIPELINE_MODES,
  PIPELINE_OUTPUT_RESOLUTIONS,
  PIPELINE_TYPES,
  VIDEO_CRITIC_FRAME_MODES,
} from "./pipeline-defaults.js"
import { SceneMetadataSchema } from "./scene-node-types.js"

// ─── Input schema (POST /v1/pipelines body) ───────────────────────────────────

export const StyleDirectivesSchema = z.object({
  visualStyle: z.string().max(200).optional(),
  colorPalette: z.string().max(200).optional(),
  lighting: z.string().max(200).optional(),
  cameraLanguage: z.string().max(200).optional(),
  avoid: z.string().max(400).optional(),
})
export type StyleDirectives = z.infer<typeof StyleDirectivesSchema>

// User-configurable per-stage model overrides. Keys follow `<stage>_<kind>` so
// the resolver can fall back to the global `<kind>_model` field below when a
// stage key is absent. When neither stage nor global is set, downstream code
// keeps its current "LLM picks" or "hardcoded default" behavior.
export const PIPELINE_MODEL_STAGES = [
  "characters_image",
  "locations_image",
  "objects_image",
  "scene_keyframes_image",
  "shots_video",
  "script_llm",
] as const
export type PipelineModelStage = (typeof PIPELINE_MODEL_STAGES)[number]
const PipelineModelStageEnum = z.enum(PIPELINE_MODEL_STAGES)

// User-pinnable model identifiers. Curated allowlists — both the Zod schema
// AND the frontend dropdowns derive from these. Three reasons the allowlist
// matters even with the `model_pricing` hard-fail guard downstream:
//   1. Closes the unknown-ID oracle (an unknown id returns a 503 from the
//      route, an known-but-internal id would silently 500 mid-pipeline).
//   2. Keeps internal-only synthetic ids (e.g. `flux-lora-character`) out of
//      the user-pinnable surface — those should ONLY be set by the
//      orchestrator at runtime.
//   3. Prevents prompt injection via raw interpolation of the override string
//      into the Scene Director's LLM prompt — if it isn't in the enum it
//      can't reach the prompt.
// Tier-restriction enforcement (free tier blocked from veo3 etc.) lives at
// the route level via `canAffordCredits` — see `routes/pipelines.ts`.
export const PIPELINE_PINNABLE_IMAGE_MODELS = [
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
  "flux",
  "gpt-image",
  "gpt-image-2",
] as const
export type PipelinePinnableImageModel = (typeof PIPELINE_PINNABLE_IMAGE_MODELS)[number]

export const PIPELINE_PINNABLE_VIDEO_MODELS = [
  "kling-turbo",
  "kling",
  "kling-3.0",
  "seedance",
  "seedance-2",
  "seedance-2-fast",
  "veo3",
  "veo3.1",
  "veo3_lite",
  "minimax",
  "hailuo-standard",
  "wan-turbo",
  "bytedance-lite",
  "bytedance-pro",
] as const
export type PipelinePinnableVideoModel = (typeof PIPELINE_PINNABLE_VIDEO_MODELS)[number]

// Script LLM — Anthropic-only. The pipeline's `callLLM` is hardwired to the
// Anthropic SDK; picking a non-Anthropic model would 400 mid-stage and burn
// the upfront credit reservation. Adding GPT/Gemini support requires routing
// through `lib/llm-client.ts` first; until then, keep this list tight.
export const PIPELINE_PINNABLE_SCRIPT_LLMS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const
export type PipelinePinnableScriptLlm = (typeof PIPELINE_PINNABLE_SCRIPT_LLMS)[number]

const ImageModelEnum = z.enum(PIPELINE_PINNABLE_IMAGE_MODELS)
const VideoModelEnum = z.enum(PIPELINE_PINNABLE_VIDEO_MODELS)
const ScriptLlmEnum = z.enum(PIPELINE_PINNABLE_SCRIPT_LLMS)

// Per-stage override map. Each stage key maps to a model id valid for its
// kind. Defined as a discriminated shape (instead of `Record<stage, string>`)
// so the type system rejects `stage_models.shots_video = "nano-banana"`.
const StageModelsSchema = z
  .object({
    characters_image: ImageModelEnum.optional(),
    locations_image: ImageModelEnum.optional(),
    objects_image: ImageModelEnum.optional(),
    scene_keyframes_image: ImageModelEnum.optional(),
    shots_video: VideoModelEnum.optional(),
    script_llm: ScriptLlmEnum.optional(),
  })
  .optional()

export const PipelineConfigSchema = z.object({
  music_enabled: z.boolean().default(true),
  narration_enabled: z.boolean().default(true),
  lipsync_enabled: z.boolean().default(true),
  freecut_export_enabled: z.boolean().default(false),
  // Phase 1C.2.1 §H — when freecut_export_enabled, choose the serialization
  // format. JSON is the original Nodaro-flat-timeline-v1 shape; FCPXML emits
  // an FCPXML 1.10 timeline that Final Cut Pro / DaVinci Resolve / Premiere
  // can ingest directly. Both reuse the same in-memory timeline reduction.
  freecut_export_format: z.enum(["json", "fcpxml"]).default("json"),
  shot_generation_mode: z.enum(["parallel", "sequential"]).default("parallel"),
  silent_cut_review: z.boolean().default(true),
  // Global model overrides — apply to every stage of the matching kind unless
  // a more-specific entry in `stage_models` overrides it. Constrained to the
  // pinnable allowlists above; the route handler still re-validates against
  // tier restrictions before pipeline creation.
  image_model: ImageModelEnum.optional(),
  video_model: VideoModelEnum.optional(),
  music_model: z.string().optional(),
  script_llm: ScriptLlmEnum.optional(),
  // Per-stage overrides. Each key is constrained to its kind's allowlist.
  // Empty/missing key = fall back to the global field.
  stage_models: StageModelsSchema,
})
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>

/**
 * Resolve which model a given stage should use, following the precedence:
 *   1. `config.stage_models[stage]` — user's per-stage override
 *   2. `config.<kind>_model` (or `config.script_llm`) — user's global pick
 *   3. `undefined` — caller falls back to its own default (LLM picks, or hardcode)
 *
 * Returns `undefined` (not `null`) so callers can use `??` chains cleanly.
 */
export function resolvePipelineModel(
  config: PipelineConfig | Partial<PipelineConfig> | null | undefined,
  stage: PipelineModelStage,
): string | undefined {
  if (!config) return undefined
  const override = config.stage_models?.[stage]
  if (override) return override
  if (stage === "script_llm") return config.script_llm
  if (stage.endsWith("_video")) return config.video_model
  if (stage.endsWith("_image")) return config.image_model
  return undefined
}

export const PipelineInputSchema = z.object({
  pipeline_type: z.enum(PIPELINE_TYPES).default("story_to_video"),
  workflow_id: z.string().uuid().optional(),
  root_node_id: z.string().min(1),
  story_prompt: z.string().min(1).max(4000),
  target_duration_seconds: z.number().int().min(5).max(600),
  format: z.enum(PIPELINE_FORMATS),
  output_resolution: z.enum(PIPELINE_OUTPUT_RESOLUTIONS).default("720p"),
  language: z.string().min(2).max(10).default("en"),
  mode: z.enum(PIPELINE_MODES).default("manual"),
  // Legacy back-compat — when both `mode` and `auto_mode` present, `mode` wins.
  auto_mode: z.boolean().optional(),
  style_directives: StyleDirectivesSchema.optional(),
  config: PipelineConfigSchema.partial().optional(),
  max_cost_credits: z.number().int().positive().optional(),
  video_critic_frame_count: z.enum(VIDEO_CRITIC_FRAME_MODES).default("first_last"),
})
export type PipelineInput = z.infer<typeof PipelineInputSchema>

// ─── Detection LLM output (LLM spec §1) ───────────────────────────────────────

export const DetectionResultSchema = z.object({
  characters: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      name: z.string(),
      visual_description: z.string(),
      role_hint: z.enum(["protagonist", "antagonist", "supporting", "cameo"]),
      has_dialogue_hint: z.boolean(),
    }),
  ),
  objects: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      name: z.string(),
      visual_description: z.string(),
      narrative_significance: z.string(),
    }),
  ),
  locations: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      name: z.string(),
      visual_description: z.string(),
      parent_location_key: z.string().nullable(),
      variant_kind: z
        .enum(["main", "time_of_day", "weather", "aftermath"])
        .nullable(),
    }),
  ),
  audio_intent: z.object({
    has_narrator: z.boolean(),
    narrator_profile_hint: z.string().nullable(),
    dialogue_speaker_keys: z.array(z.string()),
    music: z.object({
      mood_hint: z.string(),
      bpm_hint: z.number(),
      genre_hints: z.array(z.string()),
    }),
    sfx_hints: z.array(z.string()),
  }),
})
export type DetectionResult = z.infer<typeof DetectionResultSchema>

// ─── Showrunner output (LLM spec §2) ──────────────────────────────────────────

export const EMOTIONAL_BEAT = z.enum([
  "setup",
  "inciting",
  "rising",
  "tension",
  "climax",
  "release",
  "denouement",
  "reveal",
  "shock",
  "release_humor",
  "reflection",
])

export const SceneSpecSchema = z.object({
  scene_index: z.number().int().min(1),
  description: z.string().max(500),
  emotional_beat: EMOTIONAL_BEAT,
  duration_seconds: z.number().positive(),
  cast_keys: z.array(z.string()),
  location_key: z.string(),
  object_keys: z.array(z.string()),
  dialogue: z
    .array(
      z.object({
        cast_key: z.string(),
        line: z.string().max(200),
      }),
    )
    .default([]),
  narration: z.string().nullable(),
  continuity_from_prev: z.enum(["hard_cut", "match_last_frame", "dissolve"]),
  shot_count_hint: z.number().int().min(1).max(8),
})

export const ShowrunnerPlanSchema = z.object({
  title: z.string(),
  logline: z.string().max(200),
  target_duration_seconds: z.number().positive(),
  format: z.enum(PIPELINE_FORMATS),
  output_resolution: z.enum(PIPELINE_OUTPUT_RESOLUTIONS),
  language: z.string(),
  genre: z.enum([
    "action",
    "drama",
    "thriller",
    "comedy",
    "horror",
    "sci-fi",
    "documentary",
  ]),
  tone: z
    .array(
      z.enum([
        "gritty",
        "hopeful",
        "tense",
        "melancholic",
        "playful",
        "epic",
        "intimate",
        "surreal",
        "nostalgic",
        "urgent",
        "dreamy",
        "cold",
        "warm",
        "menacing",
        "whimsical",
        "somber",
        "triumphant",
        "eerie",
      ]),
    )
    .max(5),
  cast: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        role: z.enum(["protagonist", "antagonist", "supporting", "cameo"]),
        visual_description: z.string(),
        voice_profile: z.string(),
        has_dialogue: z.boolean(),
        angle_count_hint: z.number().int().min(1).max(8),
        expression_set_hint: z
          .array(
            z.enum([
              "neutral",
              "smiling",
              "laughing",
              "angry",
              "scared",
              "determined",
              "sad",
              "surprised",
              "thoughtful",
              "crying",
            ]),
          )
          .max(6)
          .default([]),
      }),
    )
    .max(8),
  locations: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        visual_description: z.string(),
        variants_needed: z.array(z.string()).default([]),
      }),
    )
    .max(8),
  objects: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        visual_description: z.string(),
        narrative_significance: z.string(),
      }),
    )
    .max(10),
  scenes: z.array(SceneSpecSchema).min(3).max(20),
  beats: z.array(
    z.object({
      type: z.enum(["hook", "rising", "climax", "resolution"]),
      scene_indices: z.array(z.number().int()),
    }),
  ),
  has_narrator: z.boolean(),
  narrator_profile: z.string().nullable(),
  /**
   * Phase 1C.2.1 §G — optional narration_script for omniscient narrator-style
   * formats (trailers, documentaries, retro storytelling). When present, Stage
   * 7 sub-step 7c synthesizes a single narration audio track that spans the
   * full pipeline duration and gets mixed over the music in the final merge
   * (music ducks to 60% volume per spec §G5). Leave undefined for dialogue-
   * driven scenes that don't benefit from narration.
   */
  narration_script: z
    .object({
      text: z.string().min(20).max(4000),
      voice_id: z.string().optional(),
    })
    .optional(),
  music_plan: z.object({
    mood: z.string(),
    bpm_target: z.number(),
    genre_hints: z.array(z.string()),
  }),
  global_style: z.object({
    visual_style: z.string(),
    color_palette: z.string(),
    lighting: z.string(),
    camera_language: z.string(),
  }),
  total_duration_seconds: z.number(),
  estimated_scene_count: z.number(),
  warnings: z.array(z.string()),
})
export type ShowrunnerPlan = z.infer<typeof ShowrunnerPlanSchema>

// ─── Critic output (LLM spec §4) ──────────────────────────────────────────────

export const CriticIssueSchema = z.object({
  severity: z.enum(["blocking", "warning"]),
  scene_index: z.number().int().nullable(),
  issue_type: z.string(),
  description: z.string(),
  suggested_fix: z.string(),
})

export const ScriptCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(
    CriticIssueSchema.extend({
      issue_type: z.enum([
        "duration",
        "consistency",
        "shot_count_hint",
        "generatability",
        "dialogue",
        "continuity",
        "arc",
      ]),
    }),
  ),
  duration_analysis: z.object({
    target_seconds: z.number(),
    actual_sum_seconds: z.number(),
    deviation_percent: z.number(),
    within_tolerance: z.boolean(),
  }),
  improvement_suggestions: z.array(z.string()).optional(),
})
export type ScriptCriticVerdict = z.infer<typeof ScriptCriticVerdictSchema>

export const CastCoverageCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(
    CriticIssueSchema.extend({
      issue_type: z.enum([
        "orphan_cast",
        "unresolved_ref",
        "dialogue_load_skew",
        "role_completeness",
        "key_uniqueness",
      ]),
    }),
  ),
  dialogue_distribution: z.array(
    z.object({
      cast_key: z.string(),
      line_count: z.number(),
      share_pct: z.number(),
    }),
  ),
})
export type CastCoverageCriticVerdict = z.infer<typeof CastCoverageCriticVerdictSchema>

export const LocationsCoverageCriticIssueSchema = CriticIssueSchema.extend({
  issue_type: z.enum([
    "orphan_location",
    "unresolved_scene_location_ref",
    "duplicate_key",
    "name_too_similar",
    "description_too_short",
    "redundant_location",
  ]),
  // `nullish()` (= `.nullable().optional()`) instead of `.optional()` —
  // Sonnet routinely emits `"location_key": null` for issue_types like
  // `redundant_location` that flag a structural problem without pointing
  // at a specific key. `.optional()` only accepted `undefined`, so those
  // emits failed Zod validation, exhausted the critic retry budget, and
  // killed the whole Stage 1 with `locations_coverage validation failed
  // after 2 attempts: issues.N.location_key: Expected string, received
  // null`. Same fix already in place on `scene_index` below.
  location_key: z.string().nullish(),
  scene_index: z.number().int().nullish(),
})

export const LocationsCoverageCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(LocationsCoverageCriticIssueSchema),
})
export type LocationsCoverageCriticVerdict = z.infer<typeof LocationsCoverageCriticVerdictSchema>

// Phase 1D.2c-a — image-level vision critics

export const CharacterImageCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  prompt_adherence_score: z.number().int().min(0).max(10),
  identified_subject: z.string().min(1).max(500),
  issues: z.array(
    z.object({
      severity: z.enum(["blocking", "warning"]),
      category: z.enum([
        "wrong_subject",
        "wrong_attributes",
        "visual_artifacts",
        "style_mismatch",
        "other",
      ]),
      description: z.string().min(1).max(500),
      suggested_fix: z.string().min(1).max(300),
    }),
  ),
  approved_summary: z.string().min(1).max(500).optional(),
})
export type CharacterImageCriticVerdict = z.infer<typeof CharacterImageCriticVerdictSchema>

export const LocationImageCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  prompt_adherence_score: z.number().int().min(0).max(10),
  identified_subject: z.string().min(1).max(500),
  issues: z.array(
    z.object({
      severity: z.enum(["blocking", "warning"]),
      category: z.enum([
        "wrong_location_type",
        "wrong_time_of_day",
        "wrong_attributes",
        "visual_artifacts",
        "style_mismatch",
        "other",
      ]),
      description: z.string().min(1).max(500),
      suggested_fix: z.string().min(1).max(300),
    }),
  ),
  approved_summary: z.string().min(1).max(500).optional(),
})
export type LocationImageCriticVerdict = z.infer<typeof LocationImageCriticVerdictSchema>

// Phase 1D.2c-b-i — Storyboard Cohesion Critic (Stage 6, warn-only)

export const StoryboardCohesionCriticVerdictSchema = z.object({
  overall_assessment: z.enum(["coherent", "minor_issues", "incoherent"]),
  coherence_score: z.number().int().min(0).max(10),
  summary: z.string().min(1).max(500),
  findings: z.array(
    z.object({
      severity: z.enum(["info", "warning", "blocking"]),
      category: z.enum([
        "character_inconsistency",
        "location_inconsistency",
        "lighting_mismatch",
        "style_drift",
        "missing_establishing_shot",
        "plot_jump",
        "other",
      ]),
      affected_scenes: z.array(z.number().int().min(1)).max(20),
      description: z.string().min(1).max(500),
      suggested_action: z.string().min(1).max(300),
    }),
  ).max(30),
})
export type StoryboardCohesionCriticVerdict = z.infer<typeof StoryboardCohesionCriticVerdictSchema>

// Phase 1D.2c-b-ii — Video Critic (Stage 7)

export const VideoCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  prompt_adherence_score: z.number().int().min(0).max(10),
  continuity_score: z.number().int().min(0).max(10).nullable(),
  identified_action: z.string().min(1).max(500),
  issues: z.array(
    z.object({
      severity: z.enum(["blocking", "warning"]),
      category: z.enum([
        "wrong_action",
        "prompt_mismatch",
        "continuity_break",
        "visual_artifacts",
        "motion_glitch",
        "style_mismatch",
        "other",
      ]),
      description: z.string().min(1).max(500),
      suggested_fix: z.string().min(1).max(300),
    }),
  ).max(20),
  approved_summary: z.string().min(1).max(500).optional(),
})
export type VideoCriticVerdict = z.infer<typeof VideoCriticVerdictSchema>

/**
 * Phase 1D.2c-b-ii — Video Critic ShotSpec sibling fields persisted by
 * Stage 7 (scene-internal-pipeline) directly on each ShotSpec record (NOT
 * under a nested `metadata` key). Persisting them as siblings lets the shot
 * recovery routes update them via a JSON-Patch-style path; the shared Zod
 * `ShotSpec` schema doesn't enumerate these because ShotSpec is an open
 * object on the persistence path, so this interface is the single source of
 * truth for backend + frontend consumers that need to read/write them.
 *
 * Persisted location:
 *   `pipeline_entities.metadata.scene_node_data.shots[N].video_critic_*`
 *
 * Cleared by `clearVideoCriticMetadata` (see pipeline-defaults.ts) in the
 * retry-video-generation recovery route + the frontend Regenerate handler.
 */
export interface VideoCriticShotFields {
  video_critic_findings?: VideoCriticVerdict["issues"]
  video_critic_score?: number
  video_critic_continuity_score?: number | null
  video_critic_identified_action?: string
  video_critic_retry_count?: number
  video_critic_last_attempted_url?: string
  video_critic_failed?: boolean
  video_critic_verdict?: "pass" | "fail"
}

// ─── Entity metadata (DB pipeline_entities.metadata) ──────────────────────────

export const CharacterMetadataSchema = z.object({
  entity_type: z.literal("character"),
  name: z.string(),
  visual_description: z.string(),
  role: z.enum(["protagonist", "antagonist", "supporting", "cameo"]),
  estimated_screen_time_shots: z.number(),
  has_dialogue: z.boolean(),
  voice_profile: z.string().optional(),
  angle_count: z.number().int().min(1).max(8),
})

export const ObjectMetadataSchema = z.object({
  entity_type: z.literal("object"),
  name: z.string(),
  visual_description: z.string(),
  narrative_significance: z.string(),
  scenes_present: z.array(z.string()),
})

export const LocationMetadataSchema = z.object({
  entity_type: z.literal("location"),
  name: z.string(),
  visual_description: z.string(),
  variants_needed: z.array(z.string()),
})

export const EntityMetadataSchema = z.discriminatedUnion("entity_type", [
  CharacterMetadataSchema,
  ObjectMetadataSchema,
  LocationMetadataSchema,
  SceneMetadataSchema, // new in Phase 1B.2
])
export type EntityMetadata = z.infer<typeof EntityMetadataSchema>
