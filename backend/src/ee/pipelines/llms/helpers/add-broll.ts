import type { SupabaseClient } from "@supabase/supabase-js"
import {
  AddBRollResultSchema,
  type AddBRollResult,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_13 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunAddBRollArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

export async function runAddBRoll(args: RunAddBRollArgs): Promise<AddBRollResult> {
  const userPrompt = `SCENE:
- description: ${args.scene.description}
- emotional_beat: ${args.scene.emotional_beat}
- duration_seconds: ${args.scene.duration_seconds}
- format: ${args.plan.format}
- global_style: ${JSON.stringify(args.plan.global_style, null, 2)}

EXISTING SHOTS:
\`\`\`json
${JSON.stringify(args.scene.shots, null, 2)}
\`\`\`

Propose 1-4 insert shots and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "add_broll",
    modelId: "claude-sonnet-4-6",
    temperature: 0.5,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: AddBRollResultSchema,
    maxRetries: 1,
  })
  return result.output
}
