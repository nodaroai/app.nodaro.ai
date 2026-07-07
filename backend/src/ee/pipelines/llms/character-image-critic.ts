import type { SupabaseClient } from "@supabase/supabase-js"
import { CharacterImageCriticVerdictSchema, type CharacterImageCriticVerdict } from "@nodaro/shared"
import {
  runImageCritic,
  type ImageCriticGlobalStyle,
} from "./_image-critic-shared.js"
import { getPipelinePrompt, PIPELINE_PROMPT_KEYS } from "./prompt-registry.js"

export interface RunCharacterImageCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  imageUrl: string
  visualDescription: string
  globalStyle: ImageCriticGlobalStyle
}

export async function runCharacterImageCritic(
  args: RunCharacterImageCriticArgs,
): Promise<{ verdict: CharacterImageCriticVerdict; llmCallId: string }> {
  return runImageCritic<CharacterImageCriticVerdict>({
    ...args,
    task: "character_image",
    systemPrompt: getPipelinePrompt(PIPELINE_PROMPT_KEYS.characterImageCritic),
    schema: CharacterImageCriticVerdictSchema,
  })
}
