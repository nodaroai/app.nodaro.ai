import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import {
  ImageCriticVerdictSchema,
  type SceneNodeData,
  type ShowrunnerPlan,
  type ValidateMatchCutResult,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"
import { persistImageCriticVerdict, type ImageCriticInvocation } from "../image-critic.js"

/**
 * §6.11.14 Validate Match Cut — Phase 1C.1 vision-keyframe helper.
 *
 * Loads the target shot's keyframe + the NEXT shot's keyframe and asks
 * the Image Critic (Sonnet vision) to evaluate the match-cut quality.
 * Returns the standard verdict + a `match_strength` rollup and a suggestion
 * string the panel can surface to the user.
 *
 * Hard requirements (validated in `runValidateMatchCut`):
 *  - Target shot exists in scene.
 *  - Target shot's `shot_intent.is_match_cut === true` (the route layer
 *    short-circuits to a 400 `not_a_match_cut` BEFORE credit reservation;
 *    this helper enforces it defensively too).
 *  - Target shot is NOT the last shot (there must be a next shot to match).
 *  - Both shots have `keyframe_url` set.
 *
 * The verdict row is persisted with `invoked_via='helper:validate_match_cut'`.
 */
export class NotAMatchCutError extends Error {
  constructor(shotId: string) {
    super(`Shot '${shotId}' has shot_intent.is_match_cut=false; this helper only runs on match-cut shots.`)
    this.name = "NotAMatchCutError"
  }
}

const MATCH_CUT_VERDICT_SCHEMA = z.object({
  match_strength: z.enum(["strong", "moderate", "weak", "break"]),
  verdict: ImageCriticVerdictSchema,
  suggested_adjustments: z.string().max(300),
})

const _REDACTED_PROMPT_20 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunValidateMatchCutArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
  targetShotId: string
}

export async function runValidateMatchCut(
  args: RunValidateMatchCutArgs,
): Promise<ValidateMatchCutResult> {
  const targetIdx = args.scene.shots.findIndex(
    (s) => s.shot_id === args.targetShotId,
  )
  if (targetIdx < 0) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' not found in scene`,
    )
  }
  const target = args.scene.shots[targetIdx]!
  if (!target.shot_intent.is_match_cut) {
    throw new NotAMatchCutError(args.targetShotId)
  }
  if (targetIdx === args.scene.shots.length - 1) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' is the last shot — no next shot to match against`,
    )
  }
  const next = args.scene.shots[targetIdx + 1]!

  if (!target.keyframe_url) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' has no keyframe_url`,
    )
  }
  if (!next.keyframe_url) {
    throw new Error(
      `next shot '${next.shot_id}' has no keyframe_url`,
    )
  }

  const userPrompt = buildUserPrompt({
    sceneDescription: args.scene.description,
    emotionalBeat: args.scene.emotional_beat,
    shotAId: target.shot_id,
    shotAKeyframeUrl: target.keyframe_url,
    shotAEndState: target.end_state,
    shotBId: next.shot_id,
    shotBKeyframeUrl: next.keyframe_url,
    shotBStartState: next.start_state,
  })

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "validate_match_cut",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: MATCH_CUT_VERDICT_SCHEMA,
    maxRetries: 1,
  })

  // Persist verdict in image_critic_verdicts so the audit-trail timeline
  // surfaces match-cut verdicts alongside Stage 7b-pre / audit_images /
  // fix_continuity entries. Non-fatal on insert failure (matches the pattern
  // in `runImageCritic`).
  const invokedVia: ImageCriticInvocation = "helper:validate_match_cut"
  await persistImageCriticVerdict({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    pipelineEntityId: args.sceneId,
    assetId: target.keyframe_asset_id ?? undefined,
    shotId: target.shot_id,
    invokedVia,
    verdict: result.output.verdict,
    llmCallId: result.llmCallId === "unrecorded" ? null : result.llmCallId,
  })

  return {
    scene_id: args.sceneId,
    shot_pair: [target.shot_id, next.shot_id],
    match_strength: result.output.match_strength,
    critic_verdict: result.output.verdict,
    suggested_adjustments: result.output.suggested_adjustments,
  }
}

interface BuildUserPromptArgs {
  sceneDescription: string
  emotionalBeat: string
  shotAId: string
  shotAKeyframeUrl: string
  shotAEndState: string
  shotBId: string
  shotBKeyframeUrl: string
  shotBStartState: string
}

/** Exported for unit tests — assemble the vision content blocks for the Sonnet call. */
export function buildUserPrompt(
  args: BuildUserPromptArgs,
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = []

  blocks.push({
    type: "text",
    text:
      `<scene_context>\n` +
      `description: ${args.sceneDescription}\n` +
      `emotional_beat: ${args.emotionalBeat}\n` +
      `</scene_context>\n\n` +
      `KEYFRAME A (shot_id=${args.shotAId}, end_state: ${args.shotAEndState}) — the OUT of shot A:`,
  })
  blocks.push({
    type: "image",
    source: { type: "url", url: args.shotAKeyframeUrl },
  })
  blocks.push({
    type: "text",
    text: `KEYFRAME B (shot_id=${args.shotBId}, start_state: ${args.shotBStartState}) — the IN of shot B:`,
  })
  blocks.push({
    type: "image",
    source: { type: "url", url: args.shotBKeyframeUrl },
  })
  blocks.push({
    type: "text",
    text:
      "\nEvaluate the match-cut quality between A → B. " +
      "Emit your verdict via the emit tool.",
  })

  return blocks
}
