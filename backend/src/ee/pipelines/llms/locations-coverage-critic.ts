import type { SupabaseClient } from "@supabase/supabase-js"
import {
  LocationsCoverageCriticVerdictSchema,
  type LocationsCoverageCriticVerdict,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_8 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunLocationsCoverageCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  plan: ShowrunnerPlan
}

export async function runLocationsCoverageCritic(
  args: RunLocationsCoverageCriticArgs,
): Promise<LocationsCoverageCriticVerdict> {
  const userPrompt = `SHOWRUNNER PLAN:
\`\`\`json
${JSON.stringify(args.plan, null, 2)}
\`\`\`

Validate locations coverage and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: "locations_coverage",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: LocationsCoverageCriticVerdictSchema,
    maxRetries: 1,
  })
  return result.output
}
