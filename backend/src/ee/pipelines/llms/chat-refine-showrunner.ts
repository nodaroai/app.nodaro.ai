import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ChatTurnResponseSchema,
  type ChatTurnResponse,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_12 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunChatRefineShowrunnerArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  currentPlan: ShowrunnerPlan
  priorTurns: Array<{ role: "user" | "assistant"; content: string }>
  userMessage: string
}

export async function runChatRefineShowrunner(args: RunChatRefineShowrunnerArgs): Promise<{
  response: ChatTurnResponse
  llmCallId: string
}> {
  const systemPrompt = '[REDACTED]'.replace(
    "{{current_plan_json}}",
    JSON.stringify(args.currentPlan, null, 2),
  )

  // Concatenate prior turns + latest message as a STRING userPrompt.
  // Critical: callLLM's schema-retry-with-error-feedback only works for
  // string userPrompts (call-llm.ts:88-97). Array userPrompts skip retry
  // feedback.
  const turnsText = args.priorTurns
    .map((t) => `[${t.role}]: ${t.content}`)
    .join("\n")
  const userPrompt = turnsText
    ? `${turnsText}\n[user]: ${args.userMessage}`
    : `[user]: ${args.userMessage}`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "specialist",
    task: "chat_refine_showrunner",
    modelId: "claude-sonnet-4-6",
    temperature: 0.5,
    systemPrompt,
    userPrompt,
    schema: ChatTurnResponseSchema,
    maxRetries: 2,
  })

  return { response: result.output, llmCallId: result.llmCallId }
}
