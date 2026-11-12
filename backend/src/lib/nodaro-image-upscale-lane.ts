/**
 * Nodaro Image Upscale's lane on the house-models seam
 * (docs/design/house-models.md): where its input is stored and measured, and
 * how the worker runs it.
 *
 * Its one input, the image, goes through the copy helper
 * (`lib/outside-input-copy.ts`) BEFORE anything is measured, in each place a
 * run is priced:
 *   - `/v1/edit-image`'s guard (routes/edit-image.ts): `copyOutsideInput`
 *     without a job id (a flat scratch copy the 7-day sweep removes);
 *   - a quote of that route: `inspectOutsideInput` — the same checks and the
 *     same measurement, nothing stored. Unused today: `edit-image` is not one
 *     of `/v1/quote`'s quotable node types (`QUOTABLE_NODE_TYPES`), so the
 *     branch is ready for when it is;
 *   - a workflow run's stamp (node-executor.ts): `copyOutsideInput` in the
 *     job's scratch folder.
 * Each passes the lane row's `input.maxBytes` as the cap and reads the
 * image's pixel size from the local copy (`inspectLocalImageSize`); a file
 * already on our storage is never fetched and is measured from its header.
 * The stored URL is what is priced and sent: it rides on the job's
 * `input_data` and the worker's payload alike as `nodaroImageUpscaleStoredUrl`,
 * beside the caller's own `imageUrl`, kept as it was sent — and its `bytes`
 * ride with it as the run's `inputFacts`.
 *
 * The route guard asks `houseModelServed`, then `planHouseModelRun`; the
 * workflow stamp asks only `houseModelServed` (the orchestrator loads no
 * plugin); the worker runs `runHouseModelTask` (which plans again before
 * `start`) and delivers through `deliverHouseModelRun`.
 *
 * The plugin's arguments: `{ imageUrl, factor, outputPixels }`.
 */
import {
  NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID,
  nodaroImageUpscaleSizing,
  nodaroImageUpscaleTooLargeMessage,
  type NodaroImageUpscaleSizing,
} from "@nodaro/render-rules"
import { NODARO_IMAGE_UPSCALE_MODEL_ID, resolveNodaroImageUpscaleFactor } from "@nodaro/shared/credits"
import {
  copyOutsideInput,
  isOutsideInputRefusal,
  OutsideInputFailedError,
  OutsideInputInspectRefusedError,
} from "./outside-input-copy.js"
import { LinkImportsDisabledError } from "./link-imports.js"
import { probeImageDisplaySize } from "./image-source-size.js"
import { houseModelInvalidRunError, houseModelNotServedError, houseModelServed, runHouseModelTask } from "./house-models.js"
import { houseModelTiming } from "./house-model-timeouts.js"
import { deliverHouseModelRun } from "./house-model-delivery.js"
import { NODARO_IMAGE_UPSCALE_LANE, NODARO_IMAGE_UPSCALE_TOO_LARGE_CODE, inspectLocalImageSize, isNodaroImageUpscaleJob } from "./nodaro-image-upscale-size.js"
import { DeterministicJobError } from "./deterministic-job-error.js"

/** What a held run whose picture the worker still cannot read fails with: the lane's own input-refused sentence. */
const NODARO_IMAGE_UPSCALE_UNREADABLE_SENTENCE = NODARO_IMAGE_UPSCALE_LANE.failureSentences!.inputRefused!

const ID = NODARO_IMAGE_UPSCALE_MODEL_ID

/** The image a run upscales, stored (or, for a quote, inspected) and measured. */
export interface NodaroImageUpscaleInput {
  /** The URL the run uses: on our own storage — the caller's own URL for a quote, which stores nothing. */
  readonly url: string
  /** Its exact size in bytes: the one measurement, handed to the runner as `inputFacts`. */
  readonly bytes: number
  /** The output's size and tier, or a refusal past the limits; undefined when the image's size could not be read. */
  readonly sizing?: NodaroImageUpscaleSizing
  /** The id the run reserves: the output's tier, else the hold. */
  readonly creditId: string
}

/**
 * The copy helper's options for this lane's image: the kind, the lane row's
 * one size limit (`input.maxBytes`), the user, and the pixel-size reading of a
 * downloaded copy as its `inspect`.
 */
export function nodaroImageUpscaleCopyOptions(userId: string, signal?: AbortSignal) {
  return {
    kind: "image" as const,
    maxBytes: NODARO_IMAGE_UPSCALE_LANE.input!.maxBytes!,
    userId,
    inspect: inspectLocalImageSize,
    ...(signal ? { signal } : {}),
  }
}

/**
 * The image the helper stored (or, for a quote, checked) at `url`, measured: a
 * copy from its local file (`inspected`), a file already on our storage from
 * its header. Its output's size and tier follow from `factor`.
 */
export async function measureNodaroImageUpscaleInput(
  url: string,
  stored: { readonly bytes: number; readonly inspected?: { readonly width: number; readonly height: number } },
  factor: unknown,
): Promise<NodaroImageUpscaleInput> {
  const size = stored.inspected ?? (await probeImageDisplaySize(url))
  const sizing = size ? nodaroImageUpscaleSizing(size, factor) : undefined
  return {
    url,
    bytes: stored.bytes,
    ...(sizing ? { sizing } : {}),
    creditId: sizing?.kind === "sized" ? sizing.creditId : NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID,
  }
}

/**
 * The image at `url`, copied to our storage by the helper (in the job's
 * scratch folder when `jobId` is given) and measured. Throws what the helper
 * throws.
 */
export async function copyNodaroImageUpscaleInput(
  url: string,
  factor: unknown,
  opts: { readonly userId: string; readonly jobId?: string; readonly signal?: AbortSignal },
): Promise<NodaroImageUpscaleInput> {
  const copied = await copyOutsideInput(url, { ...nodaroImageUpscaleCopyOptions(opts.userId, opts.signal), ...(opts.jobId ? { jobId: opts.jobId } : {}) })
  return measureNodaroImageUpscaleInput(copied.url, copied, factor)
}

/** The plugin's arguments for a run (`plan` and `start`). */
export function nodaroImageUpscaleArgs(imageUrl: string, factor: unknown, outputPixels: number): Readonly<Record<string, unknown>> {
  return { imageUrl, factor: resolveNodaroImageUpscaleFactor(factor), outputPixels }
}

/** A refusal of the image, as a route answers it. */
export interface NodaroImageUpscaleInputRefusal {
  readonly status: number
  readonly code: string
  readonly message: string
}

/**
 * How the image's refusal reads to the person, or undefined for an error that
 * is not one (a cancellation, a drain, the upload policy's own refusal): those
 * go on as they are.
 *   - the deployment turned outside links off: its own refusal, unchanged (403);
 *   - the image was refused (wrong kind, too large, unreadable, its size could
 *     not be read): final (400);
 *   - too many files being fetched, or reading took too long, or storage
 *     failed: try again in a moment (429 / 503).
 * The helper's sentences name no address; the one this lane writes names no
 * maker.
 */
export function nodaroImageUpscaleInputRefusal(err: unknown): NodaroImageUpscaleInputRefusal | undefined {
  if (err instanceof LinkImportsDisabledError) return { status: 403, code: err.code, message: err.message }
  if (err instanceof OutsideInputInspectRefusedError) {
    return { status: 400, code: err.code, message: "Nodaro Image Upscale could not read this image's size. Send a PNG, JPEG or WebP image." }
  }
  if (isOutsideInputRefusal(err)) {
    const status = err.code === "input_busy" ? 429 : err.code === "input_timed_out" ? 503 : 400
    return { status, code: err.code, message: err.message }
  }
  if (err instanceof OutsideInputFailedError) return { status: 503, code: err.code, message: err.message }
  return undefined
}

/** True for a refusal the person can simply try again (nothing about the image is wrong). */
export function isRetryableNodaroImageUpscaleRefusal(code: string): boolean {
  return code === "input_busy" || code === "input_timed_out" || code === "input_failed"
}

/**
 * The workflow run's twin of the route's guard (node-executor.ts): asks
 * `houseModelServed`, stores and measures the image through the copy helper
 * in the job's scratch folder, refuses an output past the limits, and stamps
 * what the run uses — the stored URL, its bytes, the output's pixels when
 * known and the id it reserves. Never plans: the orchestrator loads no plugin.
 * Every other job passes untouched.
 */
export async function stampNodaroImageUpscaleInput(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
  ctx: { readonly userId: string; readonly jobId: string; readonly signal?: AbortSignal },
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  if (!isNodaroImageUpscaleJob(jobName, payload)) return { ok: true, patch: {} }
  if (!houseModelServed(ID)) return { ok: false, code: "model_not_available", message: houseModelNotServedError(ID).message }
  const imageUrl = typeof payload.imageUrl === "string" ? payload.imageUrl : undefined
  if (!imageUrl) return { ok: true, patch: {} }
  let input: NodaroImageUpscaleInput
  try {
    input = await copyNodaroImageUpscaleInput(imageUrl, payload.upscaleFactor, { userId: ctx.userId, jobId: ctx.jobId, ...(ctx.signal ? { signal: ctx.signal } : {}) })
  } catch (err) {
    const refusal = nodaroImageUpscaleInputRefusal(err)
    if (refusal) return { ok: false, code: refusal.code, message: refusal.message }
    throw err
  }
  if (input.sizing?.kind === "too-large") {
    return { ok: false, code: NODARO_IMAGE_UPSCALE_TOO_LARGE_CODE, message: nodaroImageUpscaleTooLargeMessage(input.sizing) }
  }
  return { ok: true, patch: nodaroImageUpscaleStamp(input) }
}

/**
 * What a run of the stored, measured image carries on its payload and
 * `input_data`, beside the caller's own `imageUrl`, which is kept as it was
 * sent: re-runs, the MCP flows and the job's input display read it, and the
 * stored copy is a scratch file (deleted when a workflow job ends, and swept
 * after 7 days on the route). The worker and the runner read the stored copy
 * from `nodaroImageUpscaleStoredUrl`.
 */
export function nodaroImageUpscaleStamp(input: NodaroImageUpscaleInput): Record<string, unknown> {
  return {
    nodaroImageUpscaleStoredUrl: input.url,
    nodaroImageUpscaleInputBytes: input.bytes,
    nodaroImageUpscaleCreditId: input.creditId,
    ...(input.sizing?.kind === "sized" ? { nodaroImageUpscaleOutputPixels: input.sizing.pixels } : {}),
  }
}

/**
 * The stored copy a run upscales: the stamp's `nodaroImageUpscaleStoredUrl`,
 * else — a job queued before the stamp kept the caller's link apart — its
 * `imageUrl`, which the runner still refuses unless it is a file of our own
 * storage.
 */
export function nodaroImageUpscaleStoredUrl(payload: Readonly<Record<string, unknown>>): string | undefined {
  const stored = payload.nodaroImageUpscaleStoredUrl
  if (typeof stored === "string" && stored.length > 0) return stored
  return typeof payload.imageUrl === "string" && payload.imageUrl.length > 0 ? payload.imageUrl : undefined
}

/** A whole, positive number, or undefined. */
function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined
}

/**
 * The worker's run of a Nodaro Image Upscale job: its arguments from the
 * stamped payload (an output's pixels the lanes could not read are read from
 * the stored image now), the stamped bytes as the run's one measurement, the
 * seam's runner with the model's own timing, then the one delivery.
 * Rejections are the runner's, rethrown unchanged (`isHouseModelRunFinal` /
 * `isHouseModelRunPending` tell them apart).
 */
export async function runNodaroImageUpscaleJob(
  payload: Readonly<Record<string, unknown>>,
  ctx: { readonly jobId: string; readonly onProgress?: () => void },
): Promise<void> {
  const imageUrl = nodaroImageUpscaleStoredUrl(payload)
  if (!imageUrl) throw houseModelInvalidRunError(ID)
  let outputPixels = count(payload.nodaroImageUpscaleOutputPixels)
  if (outputPixels === undefined) {
    // A held run: its size could not be read before the hold. Read again from
    // the stored copy; a picture still unreadable (the lane's input-refused
    // sentence) or one past the limits (the refusal the route gives it) fails
    // final, refunded, and nothing is started.
    const size = await probeImageDisplaySize(imageUrl)
    const sizing = size ? nodaroImageUpscaleSizing(size, payload.upscaleFactor) : undefined
    if (sizing?.kind === "too-large") throw new DeterministicJobError(nodaroImageUpscaleTooLargeMessage(sizing))
    if (sizing === undefined) throw new DeterministicJobError(NODARO_IMAGE_UPSCALE_UNREADABLE_SENTENCE)
    outputPixels = sizing.pixels
  }
  const bytes = count(payload.nodaroImageUpscaleInputBytes)
  const run = await runHouseModelTask(ID, nodaroImageUpscaleArgs(imageUrl, payload.upscaleFactor, outputPixels), {
    jobId: ctx.jobId,
    ...houseModelTiming(ID),
    ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
    ...(bytes !== undefined ? { inputFacts: { [imageUrl]: { bytes } } } : {}),
  })
  await deliverHouseModelRun({ id: ID, jobId: ctx.jobId, jobType: "edit-image", job: payload, ...run, claimant: "worker" })
}
