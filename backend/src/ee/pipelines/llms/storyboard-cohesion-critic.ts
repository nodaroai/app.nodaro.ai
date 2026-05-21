import type { SupabaseClient } from "@supabase/supabase-js"
import type Anthropic from "@anthropic-ai/sdk"
import {
  StoryboardCohesionCriticVerdictSchema,
  type StoryboardCohesionCriticVerdict,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_24 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunStoryboardCohesionCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  scenes: Array<{
    scene_index: number
    description: string
    keyframe_url: string
    location_key: string
    cast_keys: string[]
  }>
  globalStyle: {
    visual_style: string
    color_palette: string
    lighting: string
    camera_language: string
  }
}

export async function runStoryboardCohesionCritic(
  args: RunStoryboardCohesionCriticArgs,
): Promise<{ verdict: StoryboardCohesionCriticVerdict; llmCallId: string }> {
  const introText = `SCENE SEQUENCE (in narrative order):\n\n${args.scenes
    .map(
      (s) =>
        `Scene ${s.scene_index}: ${s.description}\n  location: ${s.location_key} | cast: ${s.cast_keys.join(", ") || "(none)"}`,
    )
    .join("\n\n")}\n\nGLOBAL STYLE:\n${JSON.stringify(args.globalStyle, null, 2)}\n\nThe keyframes follow — review them as a sequence.`

  const imageBlocks: Anthropic.Messages.ContentBlockParam[] = args.scenes.flatMap((s) => [
    { type: "text" as const, text: `--- Scene ${s.scene_index} keyframe ---` },
    {
      type: "image" as const,
      source: { type: "url" as const, url: s.keyframe_url },
    },
  ])

  const userPrompt: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: introText },
    ...imageBlocks,
    { type: "text", text: "Validate cross-scene cohesion + narrative coherence. Reply via the emit tool." },
  ]

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: "storyboard_cohesion",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: StoryboardCohesionCriticVerdictSchema,
    maxRetries: 1,
  })

  return { verdict: result.output, llmCallId: result.llmCallId }
}
