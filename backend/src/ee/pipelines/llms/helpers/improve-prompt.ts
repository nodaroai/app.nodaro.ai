import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ImprovePromptResultSchema,
  type ImprovePromptInput,
  type ImprovePromptResult,
  type SceneNodeData,
  type ShowrunnerPlan,
  VIDEO_MODEL_CAPS,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"

const _REDACTED_PROMPT_18 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunImprovePromptArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
  input: ImprovePromptInput
}

export async function runImprovePrompt(args: RunImprovePromptArgs): Promise<ImprovePromptResult> {
  const caps = VIDEO_MODEL_CAPS[args.scene.video_model]
  const promptingStyle = caps?.prompting_style ?? "natural_language"
  const targetIds =
    args.input.shot_ids[0] === "all"
      ? args.scene.shots.map((s) => s.shot_id)
      : args.input.shot_ids
  const shotsSubset = args.scene.shots.filter((s) => targetIds.includes(s.shot_id))

  const userPrompt = `SCENE:
- description: ${args.scene.description}
- emotional_beat: ${args.scene.emotional_beat}
- continuity_from_prev: ${args.scene.continuity_from_prev}

GLOBAL STYLE:
${JSON.stringify(args.plan.global_style, null, 2)}

VIDEO MODEL CAPS:
- model: ${args.scene.video_model}
- prompting_style: ${promptingStyle}

TARGETS:
- shot_ids: ${JSON.stringify(targetIds)}
- field_targets: ${JSON.stringify(args.input.field_targets)}

ORIGINAL SHOTS:
\`\`\`json
${JSON.stringify(shotsSubset, null, 2)}
\`\`\`

Rewrite and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "helper",
    task: "improve_prompt",
    modelId: "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ImprovePromptResultSchema,
    maxRetries: 1,
  })
  return result.output
}
