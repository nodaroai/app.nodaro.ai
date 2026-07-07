import type { SupabaseClient } from "@supabase/supabase-js"
import { ScriptCriticVerdictSchema, type ScriptCriticVerdict, type ShowrunnerPlan } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"
import { getPipelinePrompt, PIPELINE_PROMPT_KEYS } from "./prompt-registry.js"

export interface RunScriptCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  plan: ShowrunnerPlan
}

export async function runScriptCritic(args: RunScriptCriticArgs): Promise<ScriptCriticVerdict> {
  const systemPrompt = getPipelinePrompt(PIPELINE_PROMPT_KEYS.scriptCritic)
  const userPrompt = `SHOWRUNNER PLAN:
\`\`\`json
${JSON.stringify(args.plan, null, 2)}
\`\`\`

Validate and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: "script",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt,
    userPrompt,
    schema: ScriptCriticVerdictSchema,
    maxRetries: 1,
  })
  return result.output
}
