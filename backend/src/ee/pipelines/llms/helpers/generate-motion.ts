import type { SupabaseClient } from "@supabase/supabase-js"
import {
  GenerateMotionResultSchema,
  type GenerateMotionResult,
  type SceneNodeData,
  type ShowrunnerPlan,
  VIDEO_MODEL_CAPS,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_17 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunGenerateMotionArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
  shotIds: readonly string[] // ["all"] OR specific
}

export async function runGenerateMotion(
  args: RunGenerateMotionArgs,
): Promise<GenerateMotionResult> {
  const caps = VIDEO_MODEL_CAPS[args.scene.video_model]
  const promptingStyle = caps?.prompting_style ?? "natural_language"
  const targetIds =
    args.shotIds[0] === "all" ? args.scene.shots.map((s) => s.shot_id) : args.shotIds
  const shotsSubset = args.scene.shots
    .filter((s) => targetIds.includes(s.shot_id))
    .map((s) => ({
      shot_id: s.shot_id,
      camera_motion: s.camera.motion,
      action: s.action,
      duration_seconds: s.duration_seconds,
      visual_keyframe_prompt: s.visual_keyframe_prompt,
      is_loopable: s.shot_intent.is_loopable,
    }))

  const userPrompt = `PROMPTING STYLE: ${promptingStyle}

SHOTS TO GENERATE MOTION FOR:
\`\`\`json
${JSON.stringify(shotsSubset, null, 2)}
\`\`\`

Generate motion_prompt for each shot and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "generate_motion",
    modelId: "claude-haiku-4-5",
    temperature: 0.5,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: GenerateMotionResultSchema,
    maxRetries: 1,
  })
  return result.output
}
