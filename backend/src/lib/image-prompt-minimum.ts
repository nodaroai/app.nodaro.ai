import { getModel } from "@nodaro/shared/model-catalog"
import { getMinImagePromptChars } from "@nodaro/shared/models"

/**
 * A prompt shorter than the model refuses — ONE rule, shared by the image
 * routes (a 400 before anything is inserted or reserved) and the workflow
 * payload builder (a throw before any jobs row exists).
 *
 * Some providers state a minimum prompt length and refuse anything shorter at
 * task creation (Seedream 5.5: 5 characters,
 * `MIN_IMAGE_PROMPT_CHARS_BY_PROVIDER`). Unlike an over-long prompt, which the
 * provider lane trims, a short one cannot be fixed without writing words for
 * the person, so the run is refused with a message that says what to do,
 * instead of failing at the provider after its credits were reserved.
 *
 * `model` is the model the run is SENT to (after any text-to-image to
 * image-to-image swap, or the entity and Scene lanes' own model, which the
 * provider may move onto its edit sibling: both have the same minimum) and
 * `prompt` the prompt it sends (after composition), counted after trimming.
 * Null when the prompt is long enough, or for a model with no minimum.
 */
export function imagePromptTooShort(
  model: string | undefined,
  prompt: string | undefined,
): { code: "validation_error"; message: string } | null {
  const min = getMinImagePromptChars(model)
  // Counted after trimming: blank space is not a description, and a prompt the
  // provider would accept only because of its padding is refused here too.
  if (min === 0 || (prompt ?? "").trim().length >= min) return null
  const label = (model && getModel(model)?.label) || model
  return {
    code: "validation_error",
    message: `${label} needs a prompt of at least ${min} characters: describe the picture you want.`,
  }
}
