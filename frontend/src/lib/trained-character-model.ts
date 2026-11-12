/**
 * Whether this deployment withholds the trained-character model — the editor's
 * twin of the server's rule (backend lib/trained-character-model.ts, decided
 * 2026-11-12): where it does, a Generate Image node's single-node Run does not
 * switch to a character's trained model. It runs the model the node names and
 * sends the character's pictures, as for a character with no trained model.
 * Asked only of a deployment that restricts models, as the server asks it.
 */
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { isModelUnavailable, modelRestrictionActive } from "./surface-availability"

export function trainedCharacterModelWithheld(): boolean {
  return modelRestrictionActive() && isModelUnavailable(FLUX_LORA_CHARACTER_MODEL_ID)
}
