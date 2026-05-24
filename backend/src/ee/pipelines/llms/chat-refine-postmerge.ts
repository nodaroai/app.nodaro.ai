import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ChatTurnResponseSchema,
  type ChatTurnResponse,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"
import type { EditorCutDecision } from "./editor.js"

const _REDACTED_PROMPT_25 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunChatRefinePostMergeArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  // Post-merge artifact (the user-visible state):
  finalOutputUrl: string
  /**
   * Editor LLM's per-shot decisions, serialized into the user prompt (capped
   * at {@link CUT_DECISIONS_PROMPT_LIMIT}). Typed against the canonical
   * `EditorCutDecisionSchema` (`./editor.js`) so the call-site can't drift
   * from the schema the Editor specialist emits + persists onto
   * `pipeline_stages.output.cut_decisions`.
   */
  cutDecisions: EditorCutDecision[]
  finalDurationSeconds: number
  beatGridUsed: number[] | null
  // Conversation context:
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>
  userMessage: string
}

/**
 * Cap on how many `cut_decisions` entries we serialize into the user prompt.
 * Becomes load-bearing once the post-merge stage handler persists real cut
 * data — a 60-shot pipeline would otherwise inflate every chat turn's input
 * tokens (the Editor LLM emits one decision per shot, ~150 tokens each).
 */
const CUT_DECISIONS_PROMPT_LIMIT = 20

export async function runChatRefinePostMerge(
  args: RunChatRefinePostMergeArgs,
): Promise<{ output: ChatTurnResponse; llmCallId: string }> {
  const beatLine =
    args.beatGridUsed === null
      ? "null (no music)"
      : `${args.beatGridUsed.length} beats`
  const cutDecisionsSerialized =
    args.cutDecisions.length <= CUT_DECISIONS_PROMPT_LIMIT
      ? JSON.stringify(args.cutDecisions, null, 2)
      : `${JSON.stringify(args.cutDecisions.slice(0, CUT_DECISIONS_PROMPT_LIMIT), null, 2)}\n... (${args.cutDecisions.length - CUT_DECISIONS_PROMPT_LIMIT} more cuts omitted)`
  const userPrompt = `POST-MERGE ARTIFACT:
final_output_url: ${args.finalOutputUrl}
final_duration_seconds: ${args.finalDurationSeconds}
beat_grid_used: ${beatLine}
cut_decisions (${args.cutDecisions.length} cuts): ${cutDecisionsSerialized}

CHAT HISTORY:
${args.chatHistory.map((t) => `${t.role}: ${t.content}`).join("\n")}

USER MESSAGE (latest):
${args.userMessage}

Diagnose. Reply via the emit tool.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "specialist",
    task: "chat_refine_postmerge",
    modelId: "claude-sonnet-4-6",
    temperature: 0.5,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ChatTurnResponseSchema,
    maxRetries: 2,
  })

  return { output: result.output, llmCallId: result.llmCallId }
}
