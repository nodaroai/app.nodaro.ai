import { z } from "zod"
import { ShotSpecSchema } from "./scene-node-types.js"

/**
 * The 7 helpers shipping in Phase 1B.3 + 3 deferred-to-1C placeholders.
 * Names match the §6.11 spec sub-section labels (URL-safe form).
 */
export const SCENE_HELPER_NAMES = [
  // Text/planning-only — ship in 1B.3
  "audit_prompt",
  "improve_prompt",
  "generate_motion",
  "optimize_for_model",
  "add_broll",
  "bridge_to_next_scene",
  "anchor_scene_style",
  // Vision-keyframe — deferred to Phase 1C (UI buttons disabled)
  "audit_images",
  "fix_continuity",
  "validate_match_cut",
] as const

export const SceneHelperNameSchema = z.enum(SCENE_HELPER_NAMES)
export type SceneHelperName = z.infer<typeof SceneHelperNameSchema>

export const HELPERS_SHIPPED_IN_1B3: ReadonlySet<SceneHelperName> = new Set([
  "audit_prompt",
  "improve_prompt",
  "generate_motion",
  "optimize_for_model",
  "add_broll",
  "bridge_to_next_scene",
  "anchor_scene_style",
])

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
