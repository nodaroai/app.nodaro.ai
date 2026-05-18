import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { SceneNodeData } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_9 = `[REDACTED — moved to private plugin, S9 extraction]`

export const ShotListCriticIssueSchema = z.object({
  severity: z.enum(["blocking", "warning"]),
  shot_id: z.string().nullable(),
  issue_type: z.enum([
    "duration",
    "key_consistency",
    "shot_count",
    "per_shot_duration",
    "dialogue_feasibility",
    "camera_motion_realism",
    "internal_continuity",
  ]),
  description: z.string(),
  suggested_fix: z.string(),
})

export const ShotListCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(ShotListCriticIssueSchema),
  duration_analysis: z.object({
    target_seconds: z.number(),
    actual_sum_seconds: z.number(),
    deviation_percent: z.number(),
    within_tolerance: z.boolean(),
  }),
})
export type ShotListCriticVerdict = z.infer<typeof ShotListCriticVerdictSchema>

export interface RunShotListCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  sceneNodeData: SceneNodeData
}

export async function runShotListCritic(args: RunShotListCriticArgs): Promise<ShotListCriticVerdict> {
  const userPrompt = `SCENE NODE DATA:
\`\`\`json
${JSON.stringify(args.sceneNodeData, null, 2)}
\`\`\`

Validate and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "critic",
    task: "shot_list",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ShotListCriticVerdictSchema,
    maxRetries: 1,
  })
  return result.output
}
