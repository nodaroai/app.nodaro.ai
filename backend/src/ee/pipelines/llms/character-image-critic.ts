import type { SupabaseClient } from "@supabase/supabase-js"
import {
  CharacterImageCriticVerdictSchema,
  IMAGE_CRITIC_MIN_ADHERENCE_SCORE,
  type CharacterImageCriticVerdict,
} from "@nodaro/shared"
import {
  runImageCritic,
  type ImageCriticGlobalStyle,
} from "./_image-critic-shared.js"

const _REDACTED_PROMPT_21 = `[REDACTED — moved to private plugin, S9 extraction]`

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
    systemPrompt: '[REDACTED]',
    schema: CharacterImageCriticVerdictSchema,
  })
}
