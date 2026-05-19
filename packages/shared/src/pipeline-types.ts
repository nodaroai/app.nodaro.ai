import { z } from "zod"
import {
  PIPELINE_FORMATS,
  PIPELINE_MODES,
  PIPELINE_OUTPUT_RESOLUTIONS,
  PIPELINE_TYPES,
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
  image_model: z.string().optional(),
  video_model: z.string().optional(),
  music_model: z.string().optional(),
})
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>

export const PipelineInputSchema = z.object({
  pipeline_type: z.enum(PIPELINE_TYPES).default("story_to_video"),
  workflow_id: z.string().uuid().optional(),
  root_node_id: z.string().min(1),
  story_prompt: z.string().min(1).max(4000),
  target_duration_seconds: z.number().int().min(5).max(600),
  format: z.enum(PIPELINE_FORMATS),
  output_resolution: z.enum(PIPELINE_OUTPUT_RESOLUTIONS).default("1080p"),
  language: z.string().min(2).max(10).default("en"),
  mode: z.enum(PIPELINE_MODES).default("manual"),
  // Legacy back-compat — when both `mode` and `auto_mode` present, `mode` wins.
  auto_mode: z.boolean().optional(),
  style_directives: StyleDirectivesSchema.optional(),
  config: PipelineConfigSchema.partial().optional(),
  max_cost_credits: z.number().int().positive().optional(),
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
      delivery_style: z
        .enum(["calm", "epic", "intimate", "documentary"])
        .optional(),
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
