import { z } from "zod"

/**
 * Image Critic types — shared between backend (Sonnet vision call) and
 * frontend (helper result modal renderers). The schema lives in
 * `@nodaro/shared` so the helper-result schemas in `scene-helper-types.ts`
 * can compose it, and the frontend modal can render a typed
 * {@link ImageCriticVerdict} without a backend round-trip-only type.
 *
 * The runtime + persistence implementation lives in
 * `backend/src/ee/pipelines/llms/image-critic.ts` which re-exports these
 * schemas for callers that import from one place.
 */

/**
 * Issue types the Image Critic can flag. `continuity_break` is the
 * Phase 1C.1 newcomer — fires when a prior-shot last_frame is supplied
 * and the new keyframe doesn't plausibly continue from it.
 */
export const ImageCriticIssueSchema = z.object({
  type: z.enum([
    "continuity_break",
    "identity_mismatch",
    "composition_break",
    "wardrobe_inconsistency",
    "style_drift",
    "prompt_mismatch",
  ]),
  severity: z.enum(["blocking", "warning", "info"]),
  message: z.string(),
  suggested_fix: z.string().optional(),
})
export type ImageCriticIssue = z.infer<typeof ImageCriticIssueSchema>

export const ImageCriticVerdictSchema = z.object({
  ok: z.boolean(),
  issues: z.array(ImageCriticIssueSchema),
  notes: z.string().max(500),
})
export type ImageCriticVerdict = z.infer<typeof ImageCriticVerdictSchema>
