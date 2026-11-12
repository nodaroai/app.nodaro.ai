/**
 * Nodaro Image Upscale, a house model (docs/design/house-models.md): its size,
 * its price and its lane row.
 *
 * Priced by the OUTPUT's size (`@nodaro/render-rules`
 * nodaro-image-upscale-pricing.ts): the input is measured before anything is
 * reserved, and the output is the input × the factor on each side.
 *
 * The input is measured once, by the step that stores it
 * (`copyOutsideInput`, lib/nodaro-image-upscale-lane.ts): an outside file is
 * copied to our storage under the row's `maxBytes` and its pixel size read
 * from the local copy ({@link inspectLocalImageSize}); a file already on our
 * storage is read from its header (`probeImageDisplaySize`). An image whose
 * size cannot be read is held at the bare id (the top tier's price), and the
 * delivered output settles the charge to its tier
 * ({@link nodaroImageUpscaleSettledBase}, the row's `settledBase`), never above
 * the hold. A run whose size was read reserved its exact tier and commits it.
 * Both lanes stamp the id they reserved (`nodaroImageUpscaleCreditId`) on the
 * worker's payload and the job's `input_data`, which is how the settle tells a
 * hold from a tier.
 *
 * A leaf of the lane: nothing here imports the seam's runner, so the lane
 * table (house-model-lanes.ts) can read the row without a cycle.
 */
import { open } from "node:fs/promises"
import {
  NODARO_IMAGE_UPSCALE_CREDIT_IDS,
  NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID,
  nodaroImageUpscaleTierCreditId,
} from "@nodaro/render-rules"
import { NODARO_IMAGE_UPSCALE_MODEL_ID } from "@nodaro/shared/credits"
import { hasCredits } from "./config.js"
import { baseCreditCostFor } from "./credit-base-cost.js"
import { probeImageDisplaySize } from "./image-source-size.js"
import { IMAGE_HEADER_MAX_READ_BYTES, imageDimensionsOf, type ImageDimensions } from "./image-dimensions.js"
import type { HouseModelDelivered, HouseModelLane } from "./house-model-lanes.js"

/** The code a refusal of an output past the limits carries (the Topaz refusal's, too). */
export const NODARO_IMAGE_UPSCALE_TOO_LARGE_CODE = "image_too_large"

/** The largest input file, in bytes: the lane row's one limit (`input.maxBytes`). */
export const NODARO_IMAGE_UPSCALE_MAX_INPUT_BYTES = 20_000_000

/** Is this queued job a Nodaro Image Upscale? */
export function isNodaroImageUpscaleJob(jobName: string, payload: Readonly<Record<string, unknown>>): boolean {
  return jobName === "edit-image" && payload.provider === NODARO_IMAGE_UPSCALE_MODEL_ID
}

/** The id a stamped Nodaro Image Upscale payload reserves: its tier, else the hold. Undefined for every other job. */
export function nodaroImageUpscaleReserveId(jobName: string, payload: Readonly<Record<string, unknown>>): string | undefined {
  if (!isNodaroImageUpscaleJob(jobName, payload)) return undefined
  const stamped = payload.nodaroImageUpscaleCreditId
  return typeof stamped === "string" && NODARO_IMAGE_UPSCALE_CREDIT_IDS.includes(stamped) ? stamped : NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID
}

/**
 * The pixel size of a downloaded copy, read from its first bytes — the copy
 * helper's `inspect`. A bounded read of the read-only local file (no tool to
 * stop); `signal` is honoured before and after it. Throws when the size cannot
 * be read, which refuses the input with nothing stored.
 */
export async function inspectLocalImageSize(localPath: string, signal: AbortSignal): Promise<ImageDimensions> {
  signal.throwIfAborted()
  const file = await open(localPath, "r")
  let head: Buffer
  try {
    const buffer = Buffer.alloc(IMAGE_HEADER_MAX_READ_BYTES)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    head = buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
  signal.throwIfAborted()
  const size = await imageDimensionsOf(head)
  if (!size) throw new Error("the image's size could not be read")
  return size
}

/**
 * The BASE (pre-markup) credits a HELD Nodaro Image Upscale run's delivered
 * output costs: its tier's row, from the output's own size (the size the run
 * reported, else its header). Handed to `finalizeJobWithMedia` as
 * `meteredBaseCredits`, which marks it up once and never commits above the
 * reservation. `job` is the worker's payload or the job's `input_data` (its
 * `provider` and the stamped reserve id).
 *
 * Undefined — the reservation is committed as it stands — for a run that
 * reserved a tier (its size was read: the tier is exact), where credits are
 * off, or when the output's size cannot be read. Never 0.
 */
export async function nodaroImageUpscaleSettledBase(
  job: Readonly<Record<string, unknown>>,
  delivered: HouseModelDelivered,
): Promise<number | undefined> {
  if (job.provider !== NODARO_IMAGE_UPSCALE_MODEL_ID || !hasCredits()) return undefined
  if (nodaroImageUpscaleReserveId("edit-image", job) !== NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID) return undefined
  const size = delivered.width && delivered.height ? { width: delivered.width, height: delivered.height } : await probeImageDisplaySize(delivered.url)
  const tier = size ? nodaroImageUpscaleTierCreditId(size.width * size.height) : undefined
  if (!tier) return undefined
  try {
    const base = await baseCreditCostFor(tier)
    return base > 0 ? base : undefined
  } catch (err) {
    // A price that cannot be read never fails a delivered job: the hold is committed.
    console.warn(`[nodaro-image-upscale] could not price the delivered tier ${tier}: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

/**
 * Nodaro Image Upscale's lane row (house-model-lanes.ts): its one input file,
 * the image, under `imageUrl`, at most {@link NODARO_IMAGE_UPSCALE_MAX_INPUT_BYTES};
 * any format the platform's media probe reads (the copy helper's image kinds).
 * The default delivery stores the result; a held run settles on what it
 * delivered. A run refused for its picture says so in plain words: an upscale
 * has no prompt to adjust, so each sentence names the Upscale Image node's
 * other models by the labels it shows them under.
 */
export const NODARO_IMAGE_UPSCALE_LANE: HouseModelLane = Object.freeze({
  inputUrlArgs: Object.freeze(["imageUrl"]),
  input: Object.freeze({ media: "image" as const, maxBytes: NODARO_IMAGE_UPSCALE_MAX_INPUT_BYTES }),
  settledBase: nodaroImageUpscaleSettledBase,
  failureSentences: Object.freeze({
    contentPolicy:
      "This picture was blocked by the content policy, so Nodaro Image Upscale could not upscale it. Topaz Upscale or Recraft Upscale may accept it.",
    inputRefused:
      "Nodaro Image Upscale could not read this picture. Send a PNG, JPEG or WebP image, or try Topaz Upscale or Recraft Upscale.",
  }),
})
