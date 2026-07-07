import type { SupabaseClient } from "@supabase/supabase-js"
import { CastCoverageCriticVerdictSchema, type CastCoverageCriticVerdict, type ShowrunnerPlan } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"
import { getPipelinePrompt, PIPELINE_PROMPT_KEYS } from "./prompt-registry.js"

export interface RunCastCoverageCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  plan: ShowrunnerPlan
}

export async function runCastCoverageCritic(
  args: RunCastCoverageCriticArgs,
): Promise<CastCoverageCriticVerdict> {
  const systemPrompt = getPipelinePrompt(PIPELINE_PROMPT_KEYS.castCoverageCritic)
  const userPrompt = `SHOWRUNNER PLAN:
\`\`\`json
${JSON.stringify(args.plan, null, 2)}
\`\`\`

Validate cast coverage and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: "cast_coverage",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt,
    userPrompt,
    schema: CastCoverageCriticVerdictSchema,
    maxRetries: 1,
  })
  return result.output
}
