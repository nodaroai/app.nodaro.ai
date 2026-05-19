import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type FixContinuityResult,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { runImageCritic } from "../image-critic.js"
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"

/**
 * §6.11.13 Fix Continuity — Phase 1C.1 vision-keyframe helper.
 *
 * Runs the Image Critic against the target shot's keyframe with the PRIOR
 * shot's `last_frame_url`. If a `continuity_break` blocking issue is found,
 * regenerates the keyframe using the prior last_frame as a strong reference +
 * the shot's `visual_keyframe_prompt`, persists the new keyframe back to
 * `scene.shots[target].keyframe_url` (caller writes
 * `pipeline_entities.metadata.scene_node_data`).
 *
 * Hard requirements:
 *  - Target shot must exist in the scene.
 *  - Target shot must NOT be the first shot (no prior to bridge from).
 *  - Target shot must have a `keyframe_url` set.
 *  - Prior shot must have a `last_frame_url` set (Stage 7-step-3 has run for
 *    that shot in sequential mode).
 *
 * Returns the action taken (`regenerated` | `no_action_needed`) + the
 * critic's verdict. When regenerated, the new keyframe URL is included.
 */
export interface RunFixContinuityArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
  targetShotId: string
}

export async function runFixContinuity(
  args: RunFixContinuityArgs,
): Promise<FixContinuityResult> {
  const targetIdx = args.scene.shots.findIndex(
    (s) => s.shot_id === args.targetShotId,
  )
  if (targetIdx < 0) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' not found in scene`,
    )
  }
  if (targetIdx === 0) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' is the first shot — no prior to bridge from`,
    )
  }
  const target = args.scene.shots[targetIdx]!
  const prior = args.scene.shots[targetIdx - 1]!

  if (!target.keyframe_url) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' has no keyframe_url to audit`,
    )
  }
  if (!prior.last_frame_url) {
    throw new Error(
      `prior shot '${prior.shot_id}' has no last_frame_url — sequential Stage 7 hasn't extracted it yet`,
    )
  }

  // 1. Critic pass — does the keyframe break continuity with the prior last_frame?
  const verdict = await runImageCritic({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    pipelineEntityId: args.sceneId,
    assetId: target.keyframe_asset_id,
    shotId: target.shot_id,
    userId: args.userId,
    keyframeUrl: target.keyframe_url,
    priorLastFrameUrl: prior.last_frame_url,
    sceneDescription: args.scene.description,
    emotionalBeat: args.scene.emotional_beat,
    shotStartState: target.start_state,
    continuityWithPrevious: target.continuity_with_previous,
    visualKeyframePrompt: target.visual_keyframe_prompt,
    invokedVia: "helper:fix_continuity",
  })

  const hasBlockingContinuityBreak = verdict.issues.some(
    (i) => i.type === "continuity_break" && i.severity === "blocking",
  )
  if (!hasBlockingContinuityBreak) {
    return {
      scene_id: args.sceneId,
      target_shot_id: args.targetShotId,
      action: "no_action_needed",
      critic_verdict: verdict,
    }
  }

  // 2. Regenerate the keyframe using the prior last_frame as a strong
  //    reference. The image_model from the scene drives the model choice.
  const regen = await pipelineGenerateImage({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    pipelineEntityId: args.sceneId,
    userId: args.userId,
    prompt: target.visual_keyframe_prompt,
    modelIdentifier: args.scene.image_model || "nano-banana",
    referenceImageUrls: [prior.last_frame_url],
  })

  return {
    scene_id: args.sceneId,
    target_shot_id: args.targetShotId,
    action: "regenerated",
    critic_verdict: verdict,
    new_keyframe_url: regen.assetUrl,
    new_keyframe_asset_id: regen.assetId ?? undefined,
  }
}
