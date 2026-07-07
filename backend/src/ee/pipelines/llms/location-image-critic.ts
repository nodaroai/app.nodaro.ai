import type { SupabaseClient } from "@supabase/supabase-js"
import { LocationImageCriticVerdictSchema, type LocationImageCriticVerdict } from "@nodaro/shared"
import {
  runImageCritic,
  type ImageCriticGlobalStyle,
} from "./_image-critic-shared.js"
import { getPipelinePrompt, PIPELINE_PROMPT_KEYS } from "./prompt-registry.js"

export interface RunLocationImageCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  imageUrl: string
  visualDescription: string
  globalStyle: ImageCriticGlobalStyle
}

export async function runLocationImageCritic(
  args: RunLocationImageCriticArgs,
): Promise<{ verdict: LocationImageCriticVerdict; llmCallId: string }> {
  return runImageCritic<LocationImageCriticVerdict>({
    ...args,
    task: "location_image",
    systemPrompt: getPipelinePrompt(PIPELINE_PROMPT_KEYS.locationImageCritic),
    schema: LocationImageCriticVerdictSchema,
  })
}
