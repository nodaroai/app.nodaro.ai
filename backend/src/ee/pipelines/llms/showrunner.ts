import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ShowrunnerPlanSchema,
  type ShowrunnerPlan,
  type DetectionResult,
  type PipelineFormat,
  type PipelineOutputResolution,
  type PipelineMode,
  type PipelineActivationMode,
  type StyleDirectives,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_2 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunShowrunnerArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  storyPrompt: string
  detectionResult: DetectionResult
  targetDurationSeconds: number
  format: PipelineFormat
  outputResolution: PipelineOutputResolution
  language: string
  pipelineType: "story_to_video" | "song_to_music_video"
  userTier: string
  activationMode: PipelineActivationMode
  mode: PipelineMode
  styleDirectives?: StyleDirectives
  criticFeedback?: unknown
}

export async function runShowrunner(args: RunShowrunnerArgs): Promise<ShowrunnerPlan> {
  const criticPreamble = args.criticFeedback
    ? `\n\nPRIOR ATTEMPT WAS REJECTED BY THE CRITIC:\n${JSON.stringify(args.criticFeedback, null, 2)}\n\nAddress every blocking issue.\n\n`
    : ""

  const userPrompt = `${criticPreamble}USER STORY PROMPT:
"""
${args.storyPrompt}
"""

DETECTION SEED (suggestions — feel free to merge/split/extend):
\`\`\`json
${JSON.stringify(args.detectionResult, null, 2)}
\`\`\`

REQUIRED CONSTRAINTS:
- target_duration_seconds: ${args.targetDurationSeconds}   // MUST respect ±10%
- format: ${args.format}
- output_resolution: ${args.outputResolution}
- language: ${args.language}

CONTEXT:
- pipeline_type: ${args.pipelineType}
- user_tier: ${args.userTier}
- activation_mode: ${args.activationMode}
- run_mode: ${args.mode}

OPTIONAL STYLE OVERRIDES FROM USER (may be empty):
\`\`\`json
${JSON.stringify(args.styleDirectives ?? {}, null, 2)}
\`\`\`

Produce the ShowrunnerPlan as JSON via the emit tool.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "showrunner",
    task: "script",
    modelId: "claude-opus-4-7",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ShowrunnerPlanSchema,
    maxRetries: 1,
  })
  return result.output
}
