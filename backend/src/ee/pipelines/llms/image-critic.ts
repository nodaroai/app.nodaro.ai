import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ImageCriticIssueSchema,
  ImageCriticVerdictSchema,
  type ImageCriticIssue,
  type ImageCriticVerdict,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

// Re-export the shared schemas so existing callers keep `import {…} from
// "../image-critic.js"` working without churn (frontend modal + 3 new Phase
// 1C.1 helpers consume the schemas from @nodaro/shared directly).
export {
  ImageCriticIssueSchema,
  ImageCriticVerdictSchema,
  type ImageCriticIssue,
  type ImageCriticVerdict,
}

const _REDACTED_PROMPT_10 = `[REDACTED — moved to private plugin, S9 extraction]`

export type ImageCriticInvocation =
  | "stage_7b_pre"
  | "helper:audit_images"
  | "helper:fix_continuity"
  | "helper:validate_match_cut"

export interface RunImageCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Pipeline entity (typically the SceneNode entity) owning the keyframe. */
  pipelineEntityId: string
  /** Asset id of the keyframe being evaluated (persisted on the verdict row). */
  assetId?: string
  /** Shot id (persisted on the verdict row for per-shot drill-downs). */
  shotId?: string
  userId: string
  /** R2 URL of the just-generated keyframe (always required). */
  keyframeUrl: string
  /** R2 URL of the prior shot's last_frame. Provide for sequential-mode
   *  Stage 7b-pre AND for the Fix Continuity helper. Omit for shot 1 +
   *  the standalone Audit Images helper. */
  priorLastFrameUrl?: string | null
  /** Reference images the generator was given. Drives identity_mismatch
   *  + wardrobe_inconsistency checks. */
  referenceUrls?: ReadonlyArray<string>
  /** Free-form scene context — description + emotional_beat + the shot's
   *  start_state + continuity_with_previous + visual_keyframe_prompt. */
  sceneDescription: string
  emotionalBeat: string
  shotStartState: string
  continuityWithPrevious: string | null
  visualKeyframePrompt: string
  /** Audit-trail tag — which Stage 7b-pre call or which user-triggered
   *  helper produced this verdict. */
  invokedVia: ImageCriticInvocation
}

/**
 * Persists an Image-Critic verdict row to `image_critic_verdicts`.
 *
 * Extracted so the validate_match_cut helper (which wraps the verdict in a
 * richer `match_strength` envelope and can't call `runImageCritic` directly)
 * shares the exact same persistence shape as `runImageCritic`. Non-fatal on
 * insert failure — the audit-trail row is best-effort.
 */
export async function persistImageCriticVerdict(args: {
  supabase: SupabaseClient
  pipelineId: string
  pipelineEntityId: string
  assetId?: string
  shotId?: string
  invokedVia: ImageCriticInvocation
  verdict: ImageCriticVerdict
  llmCallId: string | null
}): Promise<{ id: string } | null> {
  const { data: row, error } = await args.supabase
    .from("image_critic_verdicts")
    .insert({
      pipeline_id: args.pipelineId,
      pipeline_entity_id: args.pipelineEntityId,
      asset_id: args.assetId ?? null,
      shot_id: args.shotId ?? null,
      invoked_via: args.invokedVia,
      verdict_ok: args.verdict.ok,
      issues: args.verdict.issues,
      llm_call_id: args.llmCallId,
    })
    .select("id")
    .single()
  if (error) {
    // eslint-disable-next-line no-console -- audit-row write failure must surface in logs
    console.error("[persistImageCriticVerdict] Failed to persist verdict:", error.message)
    return null
  }
  return row?.id ? { id: row.id as string } : null
}

/**
 * Runs the Image Critic Sonnet vision call + persists the verdict to
 * `image_critic_verdicts`. Reused by:
 *   - Stage 7b-pre continuity_break gate (sequential mode only).
 *   - The 3 user-triggered helpers (audit_images / fix_continuity /
 *     validate_match_cut).
 *
 * Callers should branch on `verdict.ok` + `verdict.issues[].severity`:
 *   ok && no blocking → safe to advance
 *   any blocking      → stage 7b-pre fails the scene; helper surfaces
 *                       suggested_fix in the UI.
 */
export async function runImageCritic(
  args: RunImageCriticArgs,
): Promise<ImageCriticVerdict> {
  const userPrompt = buildUserPrompt(args)

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: null, // Image Critic isn't a stage-level call — it's per-shot
    sceneId: args.pipelineEntityId,
    userId: args.userId,
    role: "critic",
    task: "image_critic",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ImageCriticVerdictSchema,
    maxRetries: 1,
  })

  await persistImageCriticVerdict({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    pipelineEntityId: args.pipelineEntityId,
    assetId: args.assetId,
    shotId: args.shotId,
    invokedVia: args.invokedVia,
    verdict: result.output,
    llmCallId: result.llmCallId === "unrecorded" ? null : result.llmCallId,
  })

  return result.output
}

/**
 * Builds the user message as an alternating sequence of text + image content
 * blocks for the Sonnet vision call. Order:
 *
 *   1. Scene context (text)
 *   2. Keyframe (image) — always
 *   3. "PRIOR_LAST_FRAME for continuity check" header + image (optional)
 *   4. "REFERENCE_IMAGES used for generation" header + N images (optional)
 *   5. Final instruction ("Emit your verdict")
 */
export function buildUserPrompt(
  args: Pick<
    RunImageCriticArgs,
    | "keyframeUrl"
    | "priorLastFrameUrl"
    | "referenceUrls"
    | "sceneDescription"
    | "emotionalBeat"
    | "shotStartState"
    | "continuityWithPrevious"
    | "visualKeyframePrompt"
  >,
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = []

  // 1. Scene context — wrapped in <scene_context> for prompt-injection safety
  //    (mirror the pattern in showrunner.ts).
  blocks.push({
    type: "text",
    text:
      `<scene_context>\n` +
      `description: ${args.sceneDescription}\n` +
      `emotional_beat: ${args.emotionalBeat}\n` +
      `shot_start_state: ${args.shotStartState}\n` +
      `continuity_with_previous: ${args.continuityWithPrevious ?? "(none — this is the first shot or parallel mode)"}\n` +
      `visual_keyframe_prompt: ${args.visualKeyframePrompt}\n` +
      `</scene_context>\n\n` +
      `KEYFRAME (the image to evaluate):`,
  })

  // 2. Keyframe image
  blocks.push({
    type: "image",
    source: { type: "url", url: args.keyframeUrl },
  })

  // 3. Prior last_frame (optional)
  if (args.priorLastFrameUrl) {
    blocks.push({
      type: "text",
      text:
        "\nPRIOR_LAST_FRAME — the last frame of the previous shot's animated clip. " +
        "Check that the keyframe above plausibly continues from this image.",
    })
    blocks.push({
      type: "image",
      source: { type: "url", url: args.priorLastFrameUrl },
    })
  }

  // 4. Reference images (optional)
  if (args.referenceUrls && args.referenceUrls.length > 0) {
    blocks.push({
      type: "text",
      text:
        `\nREFERENCE_IMAGES — ${args.referenceUrls.length} image(s) the generator was given. ` +
        "Check the keyframe for identity / wardrobe / location consistency with these.",
    })
    for (const url of args.referenceUrls) {
      blocks.push({ type: "image", source: { type: "url", url } })
    }
  }

  // 5. Closing instruction
  blocks.push({
    type: "text",
    text:
      "\nEvaluate the keyframe and emit your verdict via the emit tool. " +
      "Severity: blocking only when the keyframe MUST be regenerated.",
  })

  return blocks
}
