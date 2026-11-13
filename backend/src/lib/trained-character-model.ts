/**
 * Whether this deployment withholds the trained-character model
 * (`flux-lora-character`) — decided 2026-11-12: where it does, a Generate Image
 * run does not switch to a character's trained model; it runs the model it
 * names and uses the character through its reference pictures, as for a
 * character with no trained model. On both lanes: the workflow build
 * (`payload-builder.ts`) and `/v1/generate-image`'s `_internalLora` hint.
 *
 * Asked only of a deployment that RESTRICTS models (`modelRestrictionConfigured`):
 * without a restriction every run is what it was before the model was
 * nameable, a run priced on its switched-off row included (refused by the
 * credit check, as always).
 */
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { isModelDenied, modelRestrictionConfigured } from "./surface-deny.js"

export function trainedCharacterModelWithheld(): boolean {
  return modelRestrictionConfigured() && isModelDenied(FLUX_LORA_CHARACTER_MODEL_ID)
}
