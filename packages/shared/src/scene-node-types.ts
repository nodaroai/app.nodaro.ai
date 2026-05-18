import { z } from "zod"

// SceneInputMode lives in model-constants.ts — re-export so all SceneNodeData
// consumers import from one place.
import { SceneInputModeSchema } from "./model-constants.js"

/**
 * ShotSpec — one shot inside a SceneNodeData.
 * Mirrors Architecture §6.9.1 + v4.1 Method-2/3/5/7/8/10 field additions.
 */
export const ShotSpecSchema = z.object({
  shot_id: z.string().regex(/^shot_\d{2,3}$/, "shot_id must be shot_NN or shot_NNN"),
  camera: z.object({
    shot_type: z.enum([
      "wide", "medium", "close_up", "extreme_close_up", "pov", "over_shoulder",
    ]),
    angle: z.enum(["eye_level", "low", "high", "dutch", "birds_eye"]),
    motion: z.enum(["static", "pan", "tilt", "dolly", "tracking", "handheld"]),
  }),
  shot_intensity_kind: z.enum([
    "establishing_shot", "action_shot", "dialogue_shot",
    "reaction_shot", "climactic_shot", "transition_shot",
  ]),

  action: z.string().max(300),
  dialogue_line: z.string().max(200).nullable(),
  duration_seconds: z.number().min(0.3).max(8),

  motion_prompt: z.string().max(200),

  // Internal continuity within this scene
  start_state: z.string().max(200),
  end_state: z.string().max(200),
  continuity_with_previous: z.string().max(200).nullable(),

  // Provider-neutral intent — engine maps to provider-specific directives at call time
  shot_intent: z.object({
    needs_multishot_reference: z.boolean().default(false),
    is_loopable: z.boolean().default(false),
    needs_music_suppression: z.boolean().default(true),
    is_match_cut: z.boolean().default(false), // v4.1 Method 7
  }),

  visual_keyframe_prompt: z.string().min(1).max(1000),

  // v4.1 Method 2 — pre-planned paired keyframes (required when shot_input_mode='first_last_frame')
  end_keyframe_prompt: z.string().max(1000).optional(),

  // v4.1 Method 3 — video continuation (this shot extends extends_shot_id's clip)
  extends_shot_id: z.string().optional(),

  // v4.1 Method 5 — i2i bridge applied to prior last_frame before this shot animates
  bridge_image_prompt: z.string().max(500).optional(),

  // v4.1 Method 8 — sparse keyframes for interpolation models
  interpolation_keyframes: z
    .array(
      z.object({
        time_seconds: z.number().min(0),
        prompt: z.string().min(1).max(1000),
      }),
    )
    .max(16)
    .optional(),

  // v4.1 Method 10 — parametric 3D camera path
  camera_path_directive: z
    .object({
      type: z.enum([
        "orbit", "dolly_in", "dolly_out", "crane_up", "crane_down",
        "arc_left", "arc_right", "reveal",
      ]),
      start_angle: z.number().optional(),
      end_angle: z.number().optional(),
      intensity: z.number().min(0).max(1).optional(),
      pivot: z.enum(["subject", "origin"]).optional(),
    })
    .optional(),
})
export type ShotSpec = z.infer<typeof ShotSpecSchema>

/**
 * AssetRef — minimal asset reference shape for execution-state fields.
 * Phase 1B.2 doesn't populate these (Stage 6+ work) but the schema must accept them
 * for parse round-trips.
 */
export const AssetRefSchema = z.object({
  asset_id: z.string().uuid(),
  url: z.string().url(),
})
export type AssetRef = z.infer<typeof AssetRefSchema>

/**
 * SceneNodeData — what the Scene Director emits, what the SceneNode renders,
 * what the engine persists on `pipeline_entities.metadata` (for entity_type='scene').
 * Mirrors Architecture §6.9.1.
 */
export const SceneNodeDataSchema = z.object({
  // Plan fields (Scene Director fills; user editable)
  scene_index: z.number().int().min(1),
  description: z.string().max(500),
  emotional_beat: z.string(),
  duration_seconds: z.number().positive(),

  // Input mode — gates which video_model values are valid
  shot_input_mode: SceneInputModeSchema,

  // Echoed inputs (Scene Director copies from SceneSpec)
  cast_keys: z.array(z.string()),
  location_key: z.string(),
  object_keys: z.array(z.string()),
  continuity_from_prev: z.enum(["hard_cut", "match_last_frame", "dissolve"]),

  // Model picks
  image_model: z.string(),
  video_model: z.string(),

  // Shot list
  shots: z.array(ShotSpecSchema).min(1).max(8),

  // v4.1 Method 6 — pre-generated master keyframe (set in 1C; Phase 1B.2 always null)
  scene_anchor_keyframe: AssetRefSchema.nullable().default(null),

  // Optional per-scene style override
  style_directives: z
    .object({
      visualStyle: z.string().optional(),
      colorPalette: z.string().optional(),
      lighting: z.string().optional(),
      cameraLanguage: z.string().optional(),
      avoid: z.string().optional(),
    })
    .partial()
    .optional(),

  // Execution state (engine writes; null on planning — Phase 1C populates)
  generated_keyframes: z.array(AssetRefSchema).default([]),
  generated_clips: z.array(AssetRefSchema).default([]),
  composite_video: AssetRefSchema.nullable().default(null),
  last_frame: AssetRefSchema.nullable().default(null),
  scene_audio_track: AssetRefSchema.nullable().default(null),
})
export type SceneNodeData = z.infer<typeof SceneNodeDataSchema>

/**
 * SceneMetadataSchema — what gets persisted on `pipeline_entities.metadata`
 * for entity_type='scene'. The discriminated union in pipeline-types.ts already has
 * Character/Object/Location entries from 1A; this Phase 1B.2 task extends it.
 */
export const SceneMetadataSchema = z.object({
  entity_type: z.literal("scene"),
  scene_id: z.string(),
  shot_ids: z.array(z.string()),
  emotional_beat: z.string(),
  // Canonical pointer to the canvas SceneNode (workflows.nodes[i].id)
  scene_node_id: z.string(),
  // Opt-in Explode tracking (Phase 2 — null in 1B.2)
  exploded_to_workflow_id: z.string().uuid().nullable().default(null),
  // Phase 1B.2 stashes the full SceneNodeData here so the orchestrator + panel UI
  // don't have to re-resolve it from canvas state.
  // Optional because Stage 5 inserts the entity row BEFORE the Scene Director runs
  // (status='pending' / 'generating') — the field lands after the Scene Director succeeds.
  scene_node_data: SceneNodeDataSchema.optional(),
})
export type SceneMetadata = z.infer<typeof SceneMetadataSchema>
