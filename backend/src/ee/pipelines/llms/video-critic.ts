import type { SupabaseClient } from "@supabase/supabase-js"
import type Anthropic from "@anthropic-ai/sdk"
import {
  VideoCriticVerdictSchema,
  type VideoCriticVerdict,
  VIDEO_CRITIC_MIN_ADHERENCE_SCORE,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_23 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunVideoCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  shotPrompt: string
  shotIndex: number
  sceneIndex: number
  priorLastFrameUrl: string | null // null for first shot
  continuityFromPrev: "match_last_frame" | "hard_cut" | "match_cut_to_next" | null
  frameUrls: string[] // ordered: first → last (count depends on config: 2, 3, or 5)
}

export async function runVideoCritic(
  args: RunVideoCriticArgs,
): Promise<{ verdict: VideoCriticVerdict; llmCallId: string }> {
  const introText = `SHOT PROMPT: ${args.shotPrompt}\n\nSCENE: ${args.sceneIndex}, SHOT: ${args.shotIndex}\n\nCONTINUITY_FROM_PREV: ${args.continuityFromPrev ?? "(first shot — no continuity check)"}\n\n${args.priorLastFrameUrl ? "Prior shot's last frame follows, then this shot's frames in chronological order." : "This is the first shot. Only this shot's frames follow."}`

  const blocks: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: introText },
  ]
  if (args.priorLastFrameUrl) {
    blocks.push({ type: "text", text: "--- Prior shot's LAST frame ---" })
    blocks.push({
      type: "image",
      source: { type: "url", url: args.priorLastFrameUrl },
    })
  }
  args.frameUrls.forEach((url, i) => {
    const label =
      i === 0 ? "First" : i === args.frameUrls.length - 1 ? "Last" : `Frame ${i + 1}`
    blocks.push({ type: "text", text: `--- This shot's ${label} frame ---` })
    blocks.push({ type: "image", source: { type: "url", url } })
  })
  blocks.push({
    type: "text",
    text: "Validate prompt adherence, continuity (when prior frame present), and visual quality. Reply via the emit tool.",
  })

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: "video_critic",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt: blocks,
    schema: VideoCriticVerdictSchema,
    maxRetries: 1,
  })

  return { verdict: result.output, llmCallId: result.llmCallId }
}
