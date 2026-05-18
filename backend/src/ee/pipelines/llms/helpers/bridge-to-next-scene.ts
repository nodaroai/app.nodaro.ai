import type { SupabaseClient } from "@supabase/supabase-js"
import {
  BridgeToNextSceneResultSchema,
  type BridgeToNextSceneResult,
  type SceneNodeData,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_16 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunBridgeToNextSceneArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  scene: SceneNodeData
  targetShotId: string
}

export async function runBridgeToNextScene(
  args: RunBridgeToNextSceneArgs,
): Promise<BridgeToNextSceneResult> {
  const targetIdx = args.scene.shots.findIndex((s) => s.shot_id === args.targetShotId)
  if (targetIdx < 0) {
    throw new Error(`target_shot_id '${args.targetShotId}' not found in scene`)
  }
  const target = args.scene.shots[targetIdx]!
  const prior = targetIdx > 0 ? args.scene.shots[targetIdx - 1] : null
  if (!prior) {
    throw new Error(
      `target_shot_id '${args.targetShotId}' is the first shot — no prior to bridge from`,
    )
  }

  const userPrompt = `PRIOR SHOT (shot_id=${prior.shot_id}):
- end_state: ${prior.end_state}
- camera: ${JSON.stringify(prior.camera)}

TARGET SHOT (shot_id=${target.shot_id}):
- start_state: ${target.start_state}
- camera: ${JSON.stringify(target.camera)}
- action: ${target.action}

Write the bridge_image_prompt and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "bridge_to_next_scene",
    modelId: "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: BridgeToNextSceneResultSchema,
    maxRetries: 1,
  })
  return result.output
}
