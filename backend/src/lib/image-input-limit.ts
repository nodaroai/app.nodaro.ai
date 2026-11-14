import { getModel } from "@nodaro/shared/model-catalog"
import { refusesImagesOverLimit, requestImageLimit, T2I_TO_I2I_VARIANT } from "@nodaro/shared/models"

/**
 * A run that would send a model which refuses images over its limit
 * (`refusesImagesOverLimit`: FLUX 3 Klein) more input images than it takes,
 * refused before any job row or reservation exists (decided 2026-11-12: an
 * image past its 10 is refused with a message, never left out). The limit is
 * the routes' own (`requestImageLimit`, the edit sibling's for a text-to-image
 * id), so a workflow run and a single-node run refuse the same request.
 *
 * `sentImages` is every image the job sends the provider: an edit's source and
 * its references, or a Generate Image run's base image and references
 * (`pricedSentImages`). The prompt assembler does not trim such a model's
 * references, so this is the count the run would really send. Null when the
 * run fits, and for every other model, whose workflow runs still send their
 * first images up to the provider's limit.
 */
export function imageInputLimitProblem(
  model: string | undefined,
  sentImages: number,
): { code: "validation_error"; message: string } | null {
  if (!refusesImagesOverLimit(model)) return null
  const limit = requestImageLimit(model)
  if (sentImages <= limit) return null
  return {
    code: "validation_error",
    message: `${modelLabel(model)} takes at most ${limit} input images, the source or base image included, and this run would send ${sentImages}: remove ${sentImages - limit}.`,
  }
}

/**
 * The name a person picked the model by: an edit id reads as the text-to-image
 * model that moves onto it ("FLUX 3 Klein", not its "(I2I)" entry).
 */
function modelLabel(model: string | undefined): string {
  const picked = Object.keys(T2I_TO_I2I_VARIANT).find((t2i) => T2I_TO_I2I_VARIANT[t2i] === model) ?? model
  return (picked !== undefined ? getModel(picked)?.label : undefined) ?? model ?? "This model"
}

/**
 * The reference seats a base image takes on a model that counts it against
 * the limit above (`refusesImagesOverLimit`): the moodboard images the
 * assembler adds fill only the seats left (`reservedImageSeats` on the
 * assembly input), so the platform never adds an image that would make the run
 * refused. 0 for every other model, whose moodboard fill is unchanged.
 */
export function baseImageReservedSeats(model: string | undefined, baseImageUrl: unknown): number {
  return refusesImagesOverLimit(model) && typeof baseImageUrl === "string" && baseImageUrl.length > 0 ? 1 : 0
}
