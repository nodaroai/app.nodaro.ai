/**
 * The platform's prices for the parts of an Edit with AI run, as the run is
 * charged them: reading the request (the planner, an AI Writer call on its
 * model), listening to the video (the transcription engine the run uses) and
 * the music (Suno on the version the route defaults to, since the run names
 * none). Read from the server's price list, never written down here.
 */
import { DEFAULT_SUNO_MODEL } from "@nodaro/shared/models"
import { sunoCreditType } from "@nodaro/shared/credits"
import { useLlmPrice } from "@/hooks/use-llm-price"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"
import type { EditPrices } from "@/ee/lib/freecut-ai/panel-model"
import { PLANNER_MODEL } from "@/ee/lib/freecut-ai/planner-prompt"
import { LISTEN_PROVIDER } from "@/ee/lib/freecut-ai/run-ai-edit"

const MUSIC_CREDIT_ID = sunoCreditType(DEFAULT_SUNO_MODEL, "suno-generate")

export function useEditPrices(): EditPrices & { readonly readEstimate: boolean } {
  const read = useLlmPrice("ai-writer", PLANNER_MODEL)
  const listen = useModelCreditCost(LISTEN_PROVIDER).data
  const music = useModelCreditCost(MUSIC_CREDIT_ID).data
  return {
    read: read.credits,
    readEstimate: read.estimate,
    listen: typeof listen === "number" ? listen : undefined,
    music: typeof music === "number" ? music : undefined,
  }
}
