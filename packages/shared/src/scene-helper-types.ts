import { z } from "zod"
import { ImageCriticVerdictSchema } from "./image-critic-types.js"
import { ShotSpecSchema } from "./scene-node-types.js"

/**
 * All 10 helpers — 7 text/planning helpers shipped in Phase 1B.3 +
 * 3 vision-keyframe helpers activated in Phase 1C.1.
 * Names match the §6.11 spec sub-section labels (URL-safe form).
 */
export const SCENE_HELPER_NAMES = [
  // Text/planning-only — shipped in 1B.3
  "audit_prompt",
  "improve_prompt",
  "generate_motion",
  "optimize_for_model",
  "add_broll",
  "bridge_to_next_scene",
  "anchor_scene_style",
  // Vision-keyframe — activated in Phase 1C.1
  "audit_images",
  "fix_continuity",
  "validate_match_cut",
] as const

export const SceneHelperNameSchema = z.enum(SCENE_HELPER_NAMES)
export type SceneHelperName = z.infer<typeof SceneHelperNameSchema>

/**
 * UI-gating set used by `scene-helper-buttons.tsx` to render active vs disabled
 * buttons. Phase 1C.1 promoted the 3 vision-keyframe helpers from disabled →
 * active; the constant name is preserved for compat (it remains "the set of
 * helpers currently shipped"), and {@link ACTIVE_SCENE_HELPERS} is a clearer
 * alias for new code.
 */
export const HELPERS_SHIPPED_IN_1B3: ReadonlySet<SceneHelperName> = new Set([
  "audit_prompt",
  "improve_prompt",
  "generate_motion",
  "optimize_for_model",
  "add_broll",
  "bridge_to_next_scene",
  "anchor_scene_style",
  // Phase 1C.1 — activated
  "audit_images",
  "fix_continuity",
  "validate_match_cut",
])

/** Cleaner-named alias for {@link HELPERS_SHIPPED_IN_1B3}. */
export const ACTIVE_SCENE_HELPERS = HELPERS_SHIPPED_IN_1B3

// ─── 6.11.2 Audit Prompt — Haiku, text-only ────────────────────────────────────

export const AuditPromptIssueSchema = z.object({
  shot_id: z.string(),
  severity: z.enum(["blocking", "warning", "info"]),
  issue_type: z.enum([
    "contradiction",
    "missing_beat",
    "off_format",
    "camera_motion_mismatch",
  ]),
  message: z.string(),
  suggested_fix: z.string(),
})

export const AuditPromptResultSchema = z.object({
  scene_id: z.string(),
  ok: z.boolean(),
  issues_per_shot: z.array(AuditPromptIssueSchema),
  scene_level_notes: z.string().max(400),
})
export type AuditPromptResult = z.infer<typeof AuditPromptResultSchema>

// ─── 6.11.3 Improve Prompt — Sonnet, target enum ────────────────────────────────

export const ImprovePromptInputSchema = z.object({
  shot_ids: z.array(z.string()).min(1),
  field_targets: z.array(z.enum(["action", "motion_prompt", "dialogue"])).min(1),
})
export type ImprovePromptInput = z.infer<typeof ImprovePromptInputSchema>

export const ImprovePromptResultSchema = z.object({
  scene_id: z.string(),
  shots: z.array(
    z.object({
      shot_id: z.string(),
      action: z.string().max(300).optional(),
      motion_prompt: z.string().max(200).optional(),
      dialogue_line: z.string().max(200).optional(),
      reasoning: z.string().max(300),
    }),
  ),
})
export type ImprovePromptResult = z.infer<typeof ImprovePromptResultSchema>

// ─── 6.11.5 Generate Motion — Haiku, fills motion_prompt ───────────────────────

export const GenerateMotionInputSchema = z.object({
  shot_ids: z.array(z.string()).min(1),
})

export const GenerateMotionResultSchema = z.object({
  scene_id: z.string(),
  shots: z.array(
    z.object({
      shot_id: z.string(),
      motion_prompt: z.string().max(200),
    }),
  ),
})
export type GenerateMotionResult = z.infer<typeof GenerateMotionResultSchema>

// ─── 6.11.6 Optimize for Model — Sonnet, rewrites for new prompting_style ─────

export const OptimizeForModelInputSchema = z.object({
  target_model: z.string(),
})

export const OptimizeForModelResultSchema = z.object({
  scene_id: z.string(),
  target_model: z.string(),
  shots: z.array(
    z.object({
      shot_id: z.string(),
      action: z.string().max(300),
      motion_prompt: z.string().max(200),
    }),
  ),
  rationale: z.string().max(300),
})
export type OptimizeForModelResult = z.infer<typeof OptimizeForModelResultSchema>

// ─── 6.11.7 Add B-Roll — Sonnet, proposes new shots ────────────────────────────

export const AddBRollResultSchema = z.object({
  scene_id: z.string(),
  candidates: z
    .array(
      z.object({
        proposed_insert_after_shot_id: z.string(),
        insert_kind: z.enum(["reaction_shot", "cutaway", "establishing", "transition"]),
        shot: ShotSpecSchema,
        rationale: z.string().max(200),
      }),
    )
    .min(1)
    .max(4),
  scene_duration_delta: z.number(),
})
export type AddBRollResult = z.infer<typeof AddBRollResultSchema>

// ─── 6.11.10 Bridge to Next Scene — Sonnet, generates bridge_image_prompt ──────

export const BridgeToNextSceneInputSchema = z.object({
  target_shot_id: z.string(),
})

export const BridgeToNextSceneResultSchema = z.object({
  scene_id: z.string(),
  target_shot_id: z.string(),
  bridge_image_prompt: z.string().max(500),
  reasoning: z.string().max(300),
})
export type BridgeToNextSceneResult = z.infer<typeof BridgeToNextSceneResultSchema>

// ─── 6.11.11 Anchor Scene Style — Sonnet plans + image_model generates ─────────

export const AnchorSceneStyleResultSchema = z.object({
  scene_id: z.string(),
  anchor_prompt: z.string().max(800),
  asset_id: z.string().uuid(),
  asset_url: z.string().url(),
  credits_spent: z.number(),
})
export type AnchorSceneStyleResult = z.infer<typeof AnchorSceneStyleResultSchema>

// ─── 6.11.12 Audit Images — Sonnet vision, per-shot keyframe critic loop ──────
//
// Runs `runImageCritic` over every shot's keyframe_url in the scene (no body
// inputs). Aggregates verdicts into a per-shot issue list. `ok` rolls up to
// scene-level: false when any shot has a blocking issue.

export const AuditImagesShotEntrySchema = z.object({
  shot_id: z.string(),
  ok: z.boolean(),
  /** Verdict body — empty when the shot has no `keyframe_url` yet (skipped). */
  verdict: ImageCriticVerdictSchema.nullable(),
  /** True when the shot had no keyframe to audit. */
  skipped: z.boolean(),
})
export type AuditImagesShotEntry = z.infer<typeof AuditImagesShotEntrySchema>

export const AuditImagesResultSchema = z.object({
  scene_id: z.string(),
  ok: z.boolean(),
  shot_issues: z.array(AuditImagesShotEntrySchema),
  /** Roll-up summary suitable for in-app display ("3 of 5 shots have issues"). */
  summary: z.string().max(400),
})
export type AuditImagesResult = z.infer<typeof AuditImagesResultSchema>

// ─── 6.11.13 Fix Continuity — Sonnet vision + i2i regen ──────────────────────
//
// Body: { target_shot_id }. Runs Image Critic against the target shot's
// keyframe with its PRIOR shot's `last_frame_url`. If a `continuity_break`
// blocking issue is found, regenerates the keyframe via
// `pipelineGenerateImage` using the prior last_frame as a strong reference,
// and persists the new keyframe_url back to the scene's shots[target].

export const FixContinuityInputSchema = z.object({
  target_shot_id: z.string(),
})
export type FixContinuityInput = z.infer<typeof FixContinuityInputSchema>

export const FixContinuityResultSchema = z.object({
  scene_id: z.string(),
  target_shot_id: z.string(),
  action: z.enum(["regenerated", "no_action_needed"]),
  critic_verdict: ImageCriticVerdictSchema,
  /** Populated only when `action === "regenerated"`. */
  new_keyframe_url: z.string().url().optional(),
  new_keyframe_asset_id: z.string().uuid().optional(),
})
export type FixContinuityResult = z.infer<typeof FixContinuityResultSchema>

// ─── 6.11.14 Validate Match Cut — Sonnet vision ──────────────────────────────
//
// Body: { target_shot_id }. Loads the target shot's keyframe + the NEXT shot's
// keyframe and asks the Image Critic to evaluate the match-cut quality.
// Returns a `match_strength` summary + the critic's full verdict. Returns 400
// `not_a_match_cut` from the route layer when `shot_intent.is_match_cut`
// is false on the target shot (pre-flight check before credit reservation).

export const ValidateMatchCutInputSchema = z.object({
  target_shot_id: z.string(),
})
export type ValidateMatchCutInput = z.infer<typeof ValidateMatchCutInputSchema>

export const ValidateMatchCutResultSchema = z.object({
  scene_id: z.string(),
  /** Tuple [shot_id_a, shot_id_b] — the target shot + the next shot. */
  shot_pair: z.tuple([z.string(), z.string()]),
  match_strength: z.enum(["strong", "moderate", "weak", "break"]),
  critic_verdict: ImageCriticVerdictSchema,
  /** Optional follow-up actions the user could take (free-form, ≤300 chars). */
  suggested_adjustments: z.string().max(300),
})
export type ValidateMatchCutResult = z.infer<typeof ValidateMatchCutResultSchema>
