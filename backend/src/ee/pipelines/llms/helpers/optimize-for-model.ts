import type { SupabaseClient } from "@supabase/supabase-js"
import {
  OptimizeForModelResultSchema,
  type OptimizeForModelResult,
  type SceneNodeData,
  VIDEO_MODEL_CAPS,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_19 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunOptimizeForModelArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  scene: SceneNodeData
  targetModel: string
}

export async function runOptimizeForModel(
  args: RunOptimizeForModelArgs,
): Promise<OptimizeForModelResult> {
  const caps = VIDEO_MODEL_CAPS[args.targetModel]
  if (!caps) {
    throw new Error(
      `Unknown video_model '${args.targetModel}' — not in VIDEO_MODEL_CAPS`,
    )
  }

  const userPrompt = `TARGET MODEL: ${args.targetModel}
TARGET PROMPTING STYLE: ${caps.prompting_style}

CURRENT SHOTS:
\`\`\`json
${JSON.stringify(args.scene.shots, null, 2)}
\`\`\`

Rewrite every shot's action + motion_prompt for the new style and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "optimize_for_model",
    modelId: "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: OptimizeForModelResultSchema,
    maxRetries: 1,
  })
  return result.output
}
