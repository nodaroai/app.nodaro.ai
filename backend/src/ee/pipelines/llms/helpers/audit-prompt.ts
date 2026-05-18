import type { SupabaseClient } from "@supabase/supabase-js"
import {
  AuditPromptResultSchema,
  type AuditPromptResult,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_15 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunAuditPromptArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string // pipeline_entities.id
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

export async function runAuditPrompt(args: RunAuditPromptArgs): Promise<AuditPromptResult> {
  const userPrompt = `SCENE:
- description: ${args.scene.description}
- emotional_beat: ${args.scene.emotional_beat}
- format: ${args.plan.format}
- global_style: ${JSON.stringify(args.plan.global_style, null, 2)}

SHOTS:
\`\`\`json
${JSON.stringify(args.scene.shots, null, 2)}
\`\`\`

Audit the shots and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "audit_prompt",
    modelId: "claude-haiku-4-5",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: AuditPromptResultSchema,
    maxRetries: 1,
  })
  return result.output
}
