import type { SupabaseClient } from "@supabase/supabase-js"
import {
  IMAGE_CRITIC_MIN_ADHERENCE_SCORE,
  LocationImageCriticVerdictSchema,
  type LocationImageCriticVerdict,
} from "@nodaro/shared"
import {
  runImageCritic,
  type ImageCriticGlobalStyle,
} from "./_image-critic-shared.js"

const _REDACTED_PROMPT_22 = `[REDACTED — moved to private plugin, S9 extraction]`

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
    systemPrompt: '[REDACTED]',
    schema: LocationImageCriticVerdictSchema,
  })
}
