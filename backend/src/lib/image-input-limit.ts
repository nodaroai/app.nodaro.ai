import { FLUX_3_KLEIN_T2I, getModel, isFlux3Klein } from "@nodaro/shared/model-catalog"
import { requestImageLimit } from "@nodaro/shared/models"

/**
 * A workflow image run that would send FLUX 3 Klein more input images than it
 * takes, refused before any job row or reservation exists (decided 2026-11-12:
 * an image past its 10 is refused with a message, never left out). The limit
 * is the routes' own (`requestImageLimit`, the edit sibling's for a
 * text-to-image id), so a workflow run and a single-node run refuse the same
 * request.
 *
 * `sentImages` is every image the job sends the provider: an edit's source and
 * its references, or a Generate Image run's base image and references
 * (`pricedSentImages`). Null when the run fits, and for every other model,
 * whose workflow runs still send their first images up to the provider's limit.
 */
export function imageInputLimitProblem(
  model: string | undefined,
  sentImages: number,
): { code: "validation_error"; message: string } | null {
  if (!isFlux3Klein(model)) return null
  const limit = requestImageLimit(model)
  if (sentImages <= limit) return null
  const label = getModel(FLUX_3_KLEIN_T2I)?.label ?? model
  return {
    code: "validation_error",
    message: `${label} takes at most ${limit} input images, the source or base image included, and this run would send ${sentImages}: remove ${sentImages - limit}.`,
  }
}

/**
 * The reference seats a base image takes on a model that counts it against
 * the limit above (FLUX 3 Klein): the moodboard images the assembler adds
 * fill only the seats left (`reservedImageSeats` on the assembly input), so
 * the platform never adds an image that would make the run refused. 0 for
 * every other model, whose moodboard fill is unchanged.
 */
export function baseImageReservedSeats(model: string | undefined, baseImageUrl: unknown): number {
  return isFlux3Klein(model) && typeof baseImageUrl === "string" && baseImageUrl.length > 0 ? 1 : 0
}
