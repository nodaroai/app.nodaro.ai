import type { SupabaseClient } from "@supabase/supabase-js"
import type Anthropic from "@anthropic-ai/sdk"
import type { z } from "zod"
import { IMAGE_CRITIC_MIN_ADHERENCE_SCORE } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

/**
 * Shared shape for the global_style block injected into the critic's
 * user-prompt. Both character and location critics read the same four fields
 * from `ShowrunnerPlan.global_style`.
 */
export interface ImageCriticGlobalStyle {
  visual_style: string
  color_palette: string
  lighting: string
  camera_language: string
}

/**
 * Shared implementation for character and location image critics. Each
 * wrapper module passes its own systemPrompt + task + schema. The behavior
 * (Sonnet 4.6 vision, URL-source image, temp 0.2, maxRetries 1) is uniform
 * across image-level critics in Phase 1D.2c-a.
 */
export interface RunImageCriticArgs<TVerdict> {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  imageUrl: string
  visualDescription: string
  globalStyle: ImageCriticGlobalStyle
  task: "character_image" | "location_image"
  systemPrompt: string
  schema: z.ZodType<TVerdict, z.ZodTypeDef, unknown>
}

export async function runImageCritic<TVerdict>(
  args: RunImageCriticArgs<TVerdict>,
): Promise<{ verdict: TVerdict; llmCallId: string }> {
  // Anthropic fetches the URL server-side — no R2 download / base64 encode
  // on our side. Mirrors the keyframe-critic pattern in image-critic.ts.
  const userPrompt: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "image",
      source: { type: "url", url: args.imageUrl },
    },
    {
      type: "text",
      text:
        `VISUAL_DESCRIPTION:\n${args.visualDescription}\n\n` +
        `GLOBAL_STYLE:\n${JSON.stringify(args.globalStyle, null, 2)}\n\n` +
        `Validate the image and reply via the emit tool.`,
    },
  ]

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "critic",
    task: args.task,
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: args.systemPrompt,
    userPrompt,
    schema: args.schema,
    maxRetries: 1,
  })
  return { verdict: result.output, llmCallId: result.llmCallId }
}

/**
 * Shared auto-fail predicate for the image-critic retry loop. Treats either
 * a `verdict: "fail"` OR a `prompt_adherence_score < IMAGE_CRITIC_MIN_ADHERENCE_SCORE`
 * as a blocking failure (defense in depth — the LLM can still tag `verdict: "pass"`
 * with a low score and that should still trigger a retry).
 */
export function isBlockingImageCriticFail(verdict: {
  verdict: "pass" | "fail"
  prompt_adherence_score: number
}): boolean {
  return (
    verdict.verdict === "fail" ||
    verdict.prompt_adherence_score < IMAGE_CRITIC_MIN_ADHERENCE_SCORE
  )
}
