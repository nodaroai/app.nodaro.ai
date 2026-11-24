import { KLING_IMAGE_4_MAX_PICTURES, getModel, isKlingImage4 } from "@nodaro/shared/model-catalog"
import { DEFAULT_REQUEST_IMAGE_LIMIT, MAX_REQUEST_IMAGE_LIMIT, refusesImagesOverLimitOn, requestImageLimit, T2I_TO_I2I_VARIANT, type ImageRunKind } from "@nodaro/shared/models"

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
  // Kling Image 4.0 counts input ITEMS (decided 2026-11-23): its callers pass
  // the items, a named subject counted once whatever its views.
  if (isKlingImage4(model)) {
    return {
      code: "validation_error",
      message: `${modelLabel(model)} takes at most ${limit} input items (reference images and named subjects; a character sent with 2 to 4 of its images is one), the source or base image included, and this run would send ${sentImages}: remove ${sentImages - limit}.`,
    }
  }
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

/**
 * The most `connectedReferences` (and `referenceOrder` ids) one image request
 * may carry when it runs on `models`, every model it names or defaults to
 * (decided 2026-11-15):
 *
 * - when every one refuses a request over its image limit
 *   (`refusesImagesOverLimitOn`), the largest limit any model has
 *   (`MAX_REQUEST_IMAGE_LIMIT`). The count that decides is then the model's:
 *   the images the run would send after assembly and de-duplication, against
 *   its own limit (`imageInputLimitProblem`), so a list the model can take runs
 *   and one it cannot is told how many to remove;
 * - otherwise `DEFAULT_REQUEST_IMAGE_LIMIT`, the bound these lists always had:
 *   such a model's references past its reference limit are left out by the
 *   prompt assembler, so a longer list is refused as before rather than run
 *   with some left out.
 */
export function structuredReferenceListLimit(models: readonly (string | undefined)[]): number {
  // Kling Image 4.0 alone: its pictures may reach 10 named subjects of 4 views
  // (`KLING_IMAGE_4_MAX_PICTURES`); its own check counts items. No other
  // model's bound moves.
  if (models.length > 0 && models.every((model) => isKlingImage4(model))) return KLING_IMAGE_4_MAX_PICTURES
  return models.length > 0 && models.every((model) => refusesImagesOverLimitOn(model, "request"))
    ? MAX_REQUEST_IMAGE_LIMIT
    : DEFAULT_REQUEST_IMAGE_LIMIT
}
