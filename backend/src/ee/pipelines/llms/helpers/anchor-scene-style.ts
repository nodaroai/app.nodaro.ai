import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type AnchorSceneStyleResult,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "../call-llm.js"
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"

const AnchorPromptSchema = z.object({
  anchor_prompt: z.string().min(20).max(800),
})

const _REDACTED_PROMPT_14 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunAnchorSceneStyleArgs {
  supabase: SupabaseClient
  pipelineId: string
  pipelineEntityId: string // sceneId — also used as pipelineEntityId for asset link
  stageId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

export async function runAnchorSceneStyle(
  args: RunAnchorSceneStyleArgs,
): Promise<AnchorSceneStyleResult> {
  // 1. Plan the prompt (Sonnet).
  const castRefs = args.scene.cast_keys
    .map((key) => args.plan.cast.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ name: c.name, visual_description: c.visual_description }))
  const locRef = args.plan.locations.find((l) => l.key === args.scene.location_key)

  const userPrompt = `SCENE:
- description: ${args.scene.description}
- emotional_beat: ${args.scene.emotional_beat}

CAST IN SCENE:
${JSON.stringify(castRefs, null, 2)}

LOCATION:
${JSON.stringify(
    locRef ?? {
      key: args.scene.location_key,
      name: args.scene.location_key,
      visual_description: "(unknown)",
    },
    null,
    2,
  )}

GLOBAL STYLE:
${JSON.stringify(args.plan.global_style, null, 2)}

Write the anchor_prompt and respond as JSON.`

  const planResult = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.pipelineEntityId,
    userId: args.userId,
    role: "helper",
    task: "anchor_scene_style",
    modelId: "claude-sonnet-4-6",
    temperature: 0.5,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: AnchorPromptSchema,
    maxRetries: 1,
  })
  const anchorPrompt = planResult.output.anchor_prompt

  // 2. Generate the image via existing infrastructure (1B.1).
  const imageResult = await pipelineGenerateImage({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    pipelineEntityId: args.pipelineEntityId,
    userId: args.userId,
    prompt: anchorPrompt,
    modelIdentifier: args.scene.image_model || "nano-banana",
  })

  return {
    scene_id: args.pipelineEntityId,
    anchor_prompt: anchorPrompt,
    asset_id: imageResult.assetId ?? "",
    asset_url: imageResult.assetUrl,
    credits_spent:
      imageResult.creditsSpent +
      (planResult.costUsd > 0 ? Math.ceil(planResult.costUsd / 0.02) : 0),
  }
}
