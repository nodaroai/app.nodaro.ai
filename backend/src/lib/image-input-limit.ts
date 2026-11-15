import { getModel } from "@nodaro/shared/model-catalog"
import { refusesImagesOverLimitOn, requestImageLimit, T2I_TO_I2I_VARIANT, type ImageRunKind } from "@nodaro/shared/models"

/**
 * A run that would send a model more input images than it takes, refused
 * before any job row or reservation exists, with a message saying how many to
 * remove. Which runs are refused is the model's data, by how the run was asked
 * for (`refusesImagesOverLimitOn`, decided 2026-11-14):
 *
 * - `"request"` — one call to a route (the API, MCP, the editor's Run of one
 *   node): refused on every model with a request image limit of its own
 *   (Seedream 5.5, GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image, FLUX 3
 *   Klein);
 * - `"workflow"` — a node of a workflow run: refused only on a model whose
 *   catalog entry carries `refusesImagesOverLimit` (FLUX 3 Klein, decided
 *   2026-11-12: an image past its 10 is refused, never left out). Every other
 *   model's workflow run still sends its first images up to the limit, so a
 *   saved graph keeps running.
 *
 * The limit is the routes' own (`requestImageLimit`, the edit sibling's for a
 * text-to-image id), so every surface refuses the same count.
 *
 * `sentImages` is every image the job sends the provider: an edit's source and
 * its references, or a Generate Image run's base image and references
 * (`pricedSentImages`). The prompt assembler does not trim the references of a
 * run that is refused here (`runKind` on its input), so this is the count the
 * run would really send. Null when the run fits, and when this kind of run is
 * not refused on the model.
 */
export function imageInputLimitProblem(
  model: string | undefined,
  sentImages: number,
  run: ImageRunKind,
): { code: "validation_error"; message: string } | null {
  if (!refusesImagesOverLimitOn(model, run)) return null
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
 * The reference seats a base image takes on a run refused over the limit
 * above (`refusesImagesOverLimitOn` for this kind of run): the moodboard
 * images the assembler adds fill only the seats left (`reservedImageSeats` on
 * the assembly input), so the platform never adds an image that would make
 * the run refused. 0 for every other run, whose moodboard fill is unchanged.
 */
export function baseImageReservedSeats(model: string | undefined, baseImageUrl: unknown, run: ImageRunKind): number {
  return refusesImagesOverLimitOn(model, run) && typeof baseImageUrl === "string" && baseImageUrl.length > 0 ? 1 : 0
}
