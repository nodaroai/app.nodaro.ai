import { z } from "zod"

// SceneInputMode lives in model-constants.ts — re-export so all SceneNodeData
// consumers import from one place.
import { SceneInputModeSchema } from "./model-constants.js"

/**
 * TransitionType — the set of allowed shot-to-shot transitions emitted by the
 * Editor LLM stage. Single source of truth shared across:
 *   - ShotSpec.cut_decision.transition_to_next (this file)
 *   - backend/src/ee/pipelines/llms/editor.ts (LLM result schema)
 *   - backend/src/ee/pipelines/services/pipeline-final-merge.ts
 *   - backend/src/ee/pipelines/freecut-export.ts
 */
export const TransitionTypeSchema = z.enum([
  "hard_cut",
  "dissolve",
  "match_cut",
  "overlap",
])
export type TransitionType = z.infer<typeof TransitionTypeSchema>

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
        timestamp_sec: z.number().nonnegative(),
        prompt: z.string().min(10).max(1000),
      }),
    )
    .max(16)
    .optional(),

  // Phase 1C.3 Method 8 — generated R2 URLs of the sub-keyframes, one per
  // `interpolation_keyframes[N].prompt`. Stage 6 writes these BEFORE Stage 7
  // runs so the animate step can pass them to the interpolation provider.
  // Length MUST equal `interpolation_keyframes.length` when populated.
  interpolation_keyframe_urls: z.array(z.string().url()).max(16).optional(),

  // v4.1 Method 10 — parametric 3D camera path
  camera_path_directive: z
    .object({
      path_kind: z.enum(["orbit", "dolly", "crane", "arc", "reveal"]),
      parameters: z.record(z.unknown()).optional(),
    })
    .optional(),

  // ─── Execution state (engine writes; null on planning) ─────────────────────
  // Phase 1C.1: per-shot execution state lands directly on the shot record so
  // the SceneNode internal pipeline + continuity chain can read/write them in
  // one place. All optional — planning-time ShotSpec carries none of these.

  // Stage 6 (scene_images) writes these after keyframe generation.
  keyframe_asset_id: z.string().uuid().optional(),
  keyframe_url: z.string().url().optional(),

  // Stage 7 (animate_audio_edit) step 3 (animate) writes these after the
  // image-to-video / text-to-video call succeeds.
  video_asset_id: z.string().uuid().optional(),
  video_url: z.string().url().optional(),

  // Stage 7 step 3 (extract_frame chain — sequential mode only) writes these
  // after each shot's last frame is extracted at duration - 0.1s. Used by the
  // next shot's continuity chain (Method 1).
  last_frame_asset_id: z.string().uuid().optional(),
  last_frame_url: z.string().url().optional(),

  // Stage 7 step 4 (speech) writes these per shot with dialogue_line.
  audio_asset_id: z.string().uuid().optional(),
  audio_url: z.string().url().optional(),

  // Stage 7 step 5 (lip-sync) writes these when lipsync_enabled and the shot
  // has dialogue. The lipsynced clip replaces the shot's video_url in the
  // step-6 combine call.
  lipsynced_asset_id: z.string().uuid().optional(),
  lipsynced_url: z.string().url().optional(),

  // Phase 1C.3 — bridged frame (Method 5). Defensive placeholder; never set
  // in 1C.1 (continuity.applyContinuityToStartFrame already reads this).
  bridged_frame_url: z.string().url().optional(),

  // ─── Phase 1C.2 — dialogue + editor cut metadata ───────────────────────────
  // All optional; planning-time ShotSpec carries none of these. Populated by
  // the Editor LLM (Stage 7) and the silent-cut-preview sub-gate handler.

  // True when `dialogue_line` is non-null AND the speech generator produced
  // an audio track. The Editor LLM uses this to gate cut-in / cut-out into
  // the dialogue_no_cut_zone (Method 5.13.1 — never trim a syllable).
  has_dialogue: z.boolean().default(false),

  // Measured length of the per-shot speech audio (Stage 7 step 4 writes this).
  // Separate from `duration_seconds` (the planning intent) — the actual
  // recording can run longer/shorter than the spec.
  actual_audio_duration_sec: z.number().optional(),

  // Inclusive [start, end] window (seconds, relative to the shot's video clip)
  // during which the Editor LLM MUST NOT cut. Computed from
  // `actual_audio_duration_sec` + small padding by the Editor LLM stage.
  // null when has_dialogue=false (no zone to protect).
  dialogue_no_cut_zone: z
    .object({ start: z.number(), end: z.number() })
    .nullable()
    .optional(),

  // Editor LLM output (Phase 1C.2). Populated by the Editor LLM stage; the
  // silent-cut-preview sub-gate may patch it via user-applied overrides.
  // Mirrors the editor_decisions audit row shape (migration 135).
  cut_decision: z
    .object({
      in_offset_sec: z.number().min(0).max(2).default(0),
      out_offset_sec: z.number().min(0).max(2).default(0),
      transition_to_next: TransitionTypeSchema,
      transition_duration_sec: z.number().min(0).max(2).optional(),
      beat_snap_seconds: z.number().nullable().optional(),
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

  // Phase 1C.1 Stage 7 result — composite video assembled from the per-shot
  // clips inside this scene. Optional flat fields kept alongside
  // `composite_video` (AssetRefSchema) so consumers can read either shape.
  composite_video_asset_id: z.string().uuid().optional(),
  composite_video_url: z.string().url().optional(),
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
