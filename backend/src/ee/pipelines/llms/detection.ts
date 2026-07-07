import type { SupabaseClient } from "@supabase/supabase-js"
import { DetectionResultSchema, type DetectionResult, type PipelineFormat } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"
import { getPipelinePrompt, PIPELINE_PROMPT_KEYS } from "./prompt-registry.js"

export interface RunDetectionArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  storyPrompt: string
  format: PipelineFormat
  targetDurationSeconds: number
  language: string
}

export async function runDetection(args: RunDetectionArgs): Promise<DetectionResult> {
  const systemPrompt = getPipelinePrompt(PIPELINE_PROMPT_KEYS.detection)
  const userPrompt = `STORY PROMPT:
"""
${args.storyPrompt}
"""

FORMAT: ${args.format}
TARGET DURATION: ${args.targetDurationSeconds}s
LANGUAGE: ${args.language}

Extract entities.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "detection",
    task: "detection",
    modelId: "claude-haiku-4-5",
    temperature: 0.1,
    systemPrompt,
    userPrompt,
    schema: DetectionResultSchema,
    maxRetries: 1,
  })
  return result.output
}
