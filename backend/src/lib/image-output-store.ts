/**
 * Storing the images of a run that asked for a format other than PNG (GPT
 * Image 2.6 writes JPEG, WebP, an animated GIF or an SVG), or of a model whose
 * format follows its size (Kling Image 4.0: PNG at 2K and 4K, JPEG at 8K;
 * `imageStoredAsItsBytes`): each under its own
 * extension and content type, a free account's watermark kept in its format,
 * an SVG made safe before anything is stored, and for a GIF or an SVG a PNG
 * still beside it (`thumbnailUrl`) for whatever needs a raster.
 *
 * WHY A PATH OF ITS OWN. Every other image is streamed to `images/<id>.png` as
 * `image/png` whatever its bytes are (`uploadImageMaybeWatermark`), and that
 * stays exactly so: a run that asked for no format is stored as it always was.
 * Here the file is read whole (an SVG must be, to be checked), so its format is
 * taken from its own bytes, never from what was asked or what the provider's
 * address says: what is stored is labelled as what it is.
 *
 * REFUND RULE. Fetching the provider's file and storing it are work on a result
 * the provider already delivered, so their failures are `PostProcessingError`s
 * (no refund), as on the PNG path. An SVG that cannot be made safe is refused
 * BEFORE any of that, as a plain final error, so the job fails and the run is
 * refunded: nothing was delivered that could be kept.
 */
import sharp from "sharp"
import { variantJobId } from "@nodaro/shared/workflow"
import { IMAGE_OUTPUT_FORMAT_EXT, IMAGE_OUTPUT_FORMAT_MIME, IMAGE_OUTPUT_FORMAT_VALUES, type ImageOutputFormat } from "@nodaro/shared/models"
import { isKlingImage4 } from "@nodaro/shared/model-catalog"
import { safeFetch } from "./safe-fetch.js"
import { randomUUID } from "node:crypto"
import { isPreconditionFailed, mediaObjectKey, r2KeyFromOurUrl, r2Url, uploadBufferToR2 } from "./storage.js"
import { noteStoredImage } from "./image-dimensions.js"
import { chargeSetStorage, discardSetKeys, isStorageStateUnknown, knownObjectState, StorageStateUnknownError } from "./image-set-storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { appendSvgWatermark, isSvgRefusedError, looksLikeSvg, sanitizeSvg, SVG_REFUSED_MESSAGE } from "./svg-sanitize.js"
import { DeterministicJobError, isDeterministicJobError } from "./deterministic-job-error.js"
import { getSizeLimit } from "../utils/file-validation.js"
import { applyAnimatedGifWatermark, applyImageWatermark, WATERMARK_TEXT } from "../utils/watermark.js"

/** A format stored on this path: every one but PNG. */
export type StoredImageFormat = Exclude<ImageOutputFormat, "png">

/**
 * The format a job asked for, from its recorded request (`input_data`, written
 * after the catalog snap): `undefined` for PNG or for none, which keep the PNG
 * path. The reconcile cron finalizes from the same row, so a run recovered
 * after its worker died is stored the same way.
 */
export function requestedImageFormat(inputData: Record<string, unknown> | null | undefined): StoredImageFormat | undefined {
  const format = inputData?.outputFormat
  return typeof format === "string" && format !== "png" && (IMAGE_OUTPUT_FORMAT_VALUES as readonly string[]).includes(format)
    ? (format as StoredImageFormat)
    : undefined
}

/**
 * Whether a job's images are stored on this path, as what their bytes are:
 * every run that asked for a format other than PNG ({@link requestedImageFormat}),
 * and every run of a model whose file format follows its size, not a request
 * (Kling Image 4.0: PNG at 2K and 4K, JPEG at 8K). Read off the job's recorded
 * request (`input_data`: the model it resolved to, its `model` or its
 * `provider`), so the reconcile cron and an entity job's tail store it the
 * same way the worker does.
 */
export function imageStoredAsItsBytes(inputData: Record<string, unknown> | null | undefined): boolean {
  if (requestedImageFormat(inputData) !== undefined) return true
  return [inputData?.resolvedModel, inputData?.model, inputData?.provider].some((m) => isKlingImage4(m))
}

/** The format a file is, by its own signature; `undefined` for one this path does not know. */
export function sniffImageFormat(buffer: Buffer): ImageOutputFormat | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg"
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "webp"
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString("latin1", 0, 6))) return "gif"
  if (looksLikeSvg(buffer)) return "svg"
  return undefined
}

export interface StoredFormattedImages {
  /** The stored files, in the order given: the first is the job's `imageUrl`. */
  readonly urls: readonly string[]
  /** The first file's format and content type (`output_data.imageMimeType`). */
  readonly format: ImageOutputFormat
  readonly mimeType: string
  /** Each stored file's own content type, in the order of `urls` (`output_data.imageMimeTypes`). */
  readonly mimeTypes: readonly string[]
  /** How many images of a set could not be stored and were left out (0 for one image). */
  readonly dropped: number
  /** A PNG still of the first file when it is a GIF (its first frame) or an SVG (drawn), else none. */
  readonly thumbnailUrl?: string
  /**
   * A set's objects this store wrote and does not deliver (a left-out
   * picture, or an earlier attempt under another extension), each with the
   * bytes last seen there. Not
   * deleted here: another finalize of the same job may have stored the same
   * key and be about to deliver it, so the caller deletes them only once its
   * own completion won (`discardUndeliveredImages`). Empty for one image.
   */
  readonly undelivered: ReadonlyMap<string, number>
}

/** The error a set none of whose images stored throws, carrying what it may have written. */
export interface ImageSetNotStoredError extends Error {
  readonly undelivered?: ReadonlyMap<string, number>
}

/** The longest side of a GIF's or an SVG's PNG still. */
export const IMAGE_STILL_MAX_SIDE = 1024

interface PreparedImage {
  readonly format: ImageOutputFormat
  readonly bytes: Buffer
}

/**
 * The most bytes this path downloads for one PNG, JPEG or WebP: one over the
 * stored cap is re-encoded to fit it ({@link fitToCap}), so its download may
 * be larger than the cap, but not without bound. Anything else (an SVG, a
 * GIF, a file of no recognised type) is never re-encoded: its download is held
 * to the cap itself, as it always was.
 */
const DOWNLOAD_CEILING_FACTOR = 4

/** How many leading bytes are enough to tell a file's format (an SVG's prolog included). */
const FORMAT_SNIFF_BYTES = 4096

/**
 * The most bytes a file of `format` may download: only a file positively
 * recognised as a PNG, JPEG or WebP (which the re-encoder fits to the cap) may
 * go past the cap. An SVG, a GIF and a file of no recognised type are held to
 * the cap itself, as every download always was.
 */
function downloadLimitFor(format: ImageOutputFormat | undefined, cap: number): number {
  return format === "png" || format === "jpeg" || format === "webp" ? cap * DOWNLOAD_CEILING_FACTOR : cap
}

/**
 * Download one file, held to its limit as it arrives: a declared length over
 * the ceiling stops before any byte is read; an SVG or a GIF over the cap
 * stops as soon as its first bytes say what it is (with the error a download
 * held to the cap always gave, `upload-size-exceeded`), so it is never read
 * up to the ceiling.
 */
async function download(url: string): Promise<Buffer> {
  const response = await safeFetch(url, { timeoutMs: 120_000 })
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
  const cap = getSizeLimit("image")
  const ceiling = cap * DOWNLOAD_CEILING_FACTOR
  const advertised = parseInt(response.headers.get("content-length") ?? "", 10)
  const cancel = async () => { try { await response.body?.cancel() } catch { /* best effort */ } }
  const tooLarge = (got: number, limit: number) =>
    Number.isFinite(advertised) && advertised > limit
      ? new Error(`upload-size-exceeded: Content-Length ${advertised} > ${limit === cap ? "cap" : "ceiling"} ${limit}`)
      : new Error(`upload-size-exceeded: ${got} > ${limit === cap ? "cap" : "ceiling"} ${limit}`)
  if (Number.isFinite(advertised) && advertised > ceiling) {
    await cancel()
    throw tooLarge(advertised, ceiling)
  }
  const reader = (response.body as ReadableStream<Uint8Array> | null | undefined)?.getReader?.()
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    const limit = downloadLimitFor(sniffImageFormat(bytes.subarray(0, FORMAT_SNIFF_BYTES)), cap)
    if (bytes.length > limit) throw tooLarge(bytes.length, limit)
    return bytes
  }
  const chunks: Buffer[] = []
  let got = 0
  let limit = ceiling
  let sniffed = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    got += value.byteLength
    if (!sniffed && got >= FORMAT_SNIFF_BYTES) {
      sniffed = true
      limit = downloadLimitFor(sniffImageFormat(Buffer.concat(chunks).subarray(0, FORMAT_SNIFF_BYTES)), cap)
      // An SVG or GIF that declares more than the cap stops here, as it always did.
      if (Number.isFinite(advertised) && advertised > limit) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge(got, limit)
      }
    }
    if (got > limit) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge(got, limit)
    }
  }
  const bytes = Buffer.concat(chunks)
  if (!sniffed) {
    limit = downloadLimitFor(sniffImageFormat(bytes), cap)
    if (bytes.length > limit) throw tooLarge(bytes.length, limit)
  }
  return bytes
}

/**
 * A file the provider delivered over the stored-image cap, made to fit it as
 * the PNG path does (`recompressOversizedImage`, workers/shared.ts): a PNG,
 * JPEG or WebP is re-encoded to WebP (quality 92, alpha kept, same
 * dimensions) and stored as the WebP it then is. A provider's 4K PNG can be
 * over the cap. A GIF over the cap fails as before (`upload-size-exceeded`);
 * an SVG never reaches here (`prepareBytes` holds it to the cap itself). A
 * file under the cap is kept byte for byte.
 */
async function fitToCap(image: PreparedImage): Promise<PreparedImage> {
  const cap = getSizeLimit("image")
  if (image.bytes.length <= cap) return image
  if (image.format !== "png" && image.format !== "jpeg" && image.format !== "webp") {
    throw new Error(`upload-size-exceeded: ${image.bytes.length} > cap ${cap}`)
  }
  const webp = await sharp(image.bytes).webp({ quality: 92 }).toBuffer()
  if (webp.length > cap) throw new Error(`upload-size-exceeded: recompressed WebP ${webp.length} > cap ${cap}`)
  console.log(`[image-output-store] recompressed an oversized ${image.format}: ${image.bytes.length} -> ${webp.length} bytes (webp q92)`)
  return { format: "webp", bytes: webp }
}

/**
 * The SVG made safe, or the job refused. Outside `runPostProcessing` on
 * purpose: a refusal is not a post-processing failure, so the run is refunded.
 * It is final (`DeterministicJobError`): the queue does not run the provider
 * again for it, and its message starts with `SVG_REFUSED_MESSAGE`, which the
 * reconcile cron fails at once.
 */
async function safeSvg(bytes: Buffer): Promise<string> {
  try {
    return await sanitizeSvg(bytes)
  } catch (err) {
    if (isSvgRefusedError(err)) {
      console.warn(`[image-output-store] an SVG was refused (${(err as { reason?: unknown }).reason ?? "unknown"}): the job fails and is refunded`)
      throw new DeterministicJobError(SVG_REFUSED_MESSAGE, { cause: err })
    }
    throw err
  }
}

/**
 * A downloaded file read for its format: an SVG made safe (a refused one fails
 * the job, refunded) or a raster fit to the stored cap. An SVG over the cap
 * fails before it is read, exactly as it did when the download itself was
 * held to the cap (`upload-size-exceeded`, a post-processing failure). The
 * fit is work on a delivered result: its failures are post-processing ones.
 */
async function prepareBytes(bytes: Buffer): Promise<PreparedImage> {
  const format = sniffImageFormat(bytes) ?? "png"
  if (format === "svg") {
    const cap = getSizeLimit("image")
    if (bytes.length > cap) await runPostProcessing(async () => { throw new Error(`upload-size-exceeded: ${bytes.length} > cap ${cap}`) })
    return { format, bytes: Buffer.from(await safeSvg(bytes), "utf8") }
  }
  return runPostProcessing(() => fitToCap({ format, bytes }))
}

/** Fetch one file and prepare it (`prepareBytes`). The download's failures are post-processing ones. */
async function prepareOne(sourceUrl: string): Promise<PreparedImage> {
  return prepareBytes(await runPostProcessing(() => download(sourceUrl)))
}

/** Fetch, fit and store one picture: its url, and the bytes stored (for a still). */
async function prepareAndStore(sourceUrl: string, jobId: string, index: number, userId: string | undefined, watermark: boolean, charged?: Map<string, number>): Promise<{ url: string; key: string; stored: PreparedImage }> {
  const image = await prepareOne(sourceUrl)
  return runPostProcessing(() => store(image, jobId, index, userId, watermark, charged))
}

/**
 * Delete what a set's store wrote and did not deliver
 * (`StoredFormattedImages.undelivered`), giving back the bytes each key held
 * (`discardOwnedKeys`: what a set's write charged for it), and never a key
 * `delivered` names. The
 * caller runs it only once its own completion of the job won, or once its
 * fence says nothing will complete it. Best effort; never throws.
 */
export async function discardUndeliveredImages(
  jobId: string,
  userId: string | undefined,
  undelivered: ReadonlyMap<string, number> | undefined,
  delivered: readonly string[] = [],
  /** The row states in which this caller cleans up (a completed or held row: only these keys). */
  statuses?: readonly string[],
): Promise<void> {
  if (!undelivered || undelivered.size === 0) return
  // A key a delivered url names, by its parsed key or its path's end.
  const names = (key: string) => delivered.some((url) => r2KeyFromOurUrl(url) === key || url.split("?")[0]!.endsWith(`/${key}`))
  const keys = [...undelivered.keys()].filter((key) => !names(key))
  if (keys.length === 0) return
  // Each key's bytes in storage are what its owner was charged for it (a set
  // charges by what the key holds), read just before the delete; a key whose
  // size cannot be read is kept, never given back on a guess.
  await discardSetKeys(jobId, userId, keys, statuses ? { statuses } : {})
}


/** `fn`, tried a second time after a short pause when the first try fails for a reason that is not final. */
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isDeterministicJobError(err)) throw err
    await new Promise((r) => setTimeout(r, SET_RETRY_PAUSE_MS))
    return fn()
  }
}

/** The pause before a set's picture is tried again. */
const SET_RETRY_PAUSE_MS = 1_000

/** What a set says when not one of its images could be stored: the job fails and is refunded. */
export const IMAGE_SET_NOT_STORED_MESSAGE = "None of the set's images could be saved, so nothing was delivered."

/** The bytes to store: a free account's watermark drawn in the file's own format. */
async function watermarked(image: PreparedImage): Promise<Buffer> {
  switch (image.format) {
    case "gif":
      return applyAnimatedGifWatermark(image.bytes)
    case "svg":
      return Buffer.from(appendSvgWatermark(image.bytes.toString("utf8"), WATERMARK_TEXT), "utf8")
    default:
      // sharp writes the format it read (JPEG stays JPEG, WebP stays WebP).
      return applyImageWatermark(image.bytes)
  }
}


/**
 * Store variant `index` of the job at `images/<jobId>[-v<n>].<ext>`; answers
 * its url and the bytes stored (the still is made from those, watermark included).
 */
async function store(image: PreparedImage, jobId: string, index: number, userId: string | undefined, watermark: boolean, charged?: Map<string, number>): Promise<{ url: string; key: string; stored: PreparedImage }> {
  const bytes = watermark ? await watermarked(image) : image.bytes
  const key = mediaObjectKey(variantJobId(jobId, index), "image", IMAGE_OUTPUT_FORMAT_EXT[image.format])
  if (!charged) {
    // The key written inline, as the storage-writer census reads it (the same key).
    const url = await uploadBufferToR2(bytes, mediaObjectKey(variantJobId(jobId, index), "image", IMAGE_OUTPUT_FORMAT_EXT[image.format]), IMAGE_OUTPUT_FORMAT_MIME[image.format], userId)
    return { url, key, stored: { format: image.format, bytes } }
  }
  // A set's picture is charged by what its key holds in storage, not by which
  // attempt wrote it: the write lands only on the state just read (a
  // conditional write), and is charged the difference. So a re-store of the
  // same key (a retry, or another finalize that took the job over) charges
  // only the difference, two writers racing on one key cannot both charge
  // in full, and a write that errored after landing is charged only when
  // storage shows it was this one (its own marker). A read that fails fails
  // the step (`StorageStateUnknownError`): nothing is charged on a guess.
  const marker = randomUUID()
  for (let round = 0; round < SET_WRITE_ROUNDS; round++) {
    const before = await knownObjectState(key)
    // An earlier write of this picture whose outcome could not be read: if
    // its marker is there now, it landed, and is charged once, here.
    const pending = pendingSetWrites.get(charged)
    if (pending && pending.key === key) {
      pendingSetWrites.delete(charged)
      if (before.exists && before.metadata?.[SET_WRITE_MARKER] === pending.marker) chargeSetStorage(userId, before.size - pending.base)
    }
    charged.set(key, before.size)
    const conditional = before.exists
      ? { ifMatch: before.etag, metadata: { [SET_WRITE_MARKER]: marker } }
      : { ifNoneMatch: "*" as const, metadata: { [SET_WRITE_MARKER]: marker } }
    let url: string
    try {
      // The key written inline, as the storage-writer census reads it (the same key).
      url = await uploadBufferToR2(bytes, mediaObjectKey(variantJobId(jobId, index), "image", IMAGE_OUTPUT_FORMAT_EXT[image.format]), IMAGE_OUTPUT_FORMAT_MIME[image.format], undefined, conditional)
    } catch (err) {
      // Note this write before reading again: if the read fails, the next
      // attempt of this picture settles it from the marker.
      pendingSetWrites.set(charged, { key, marker, base: before.size })
      const after = await knownObjectState(key)
      pendingSetWrites.delete(charged)
      // This write landed (its own marker is there): a 412 is then the answer
      // to the client's own retry of it, an error a lost response. Charged once.
      if (after.exists && after.metadata?.[SET_WRITE_MARKER] === marker) {
        charged.set(key, after.size)
        chargeSetStorage(userId, after.size - before.size)
        if (isPreconditionFailed(err)) {
          const landedUrl = r2Url(key)
          await noteStoredImage(landedUrl, bytes)
          return { url: landedUrl, key, stored: { format: image.format, bytes } }
        }
        throw err
      }
      // Another writer got there first: read again and write on that.
      if (isPreconditionFailed(err)) continue
      throw err
    }
    charged.set(key, bytes.length)
    chargeSetStorage(userId, bytes.length - before.size)
    return { url, key, stored: { format: image.format, bytes } }
  }
  throw new StorageStateUnknownError(`${key} kept changing while it was written`)
}

/**
 * A set picture's write whose outcome could not be read (it errored, then the
 * read after it failed): its marker and the size it wrote over, so the next
 * attempt of the same picture charges it once if it landed. Keyed by the
 * picture's own record of the keys it touched.
 */
const pendingSetWrites = new WeakMap<Map<string, number>, { key: string; marker: string; base: number }>()

/** How many read-then-write rounds a set's picture gets against other writers of its key. */
const SET_WRITE_ROUNDS = 3
/** The metadata a set's write carries, so an errored write that landed is known to be this one. */
const SET_WRITE_MARKER = "nodaro-write"

/**
 * A PNG still of a GIF (its first frame) or an SVG (drawn, at most
 * `IMAGE_STILL_MAX_SIDE` a side), stored beside it. Best effort: a still that
 * cannot be made is said in an alert and left out; the job is never failed for it.
 */
async function storeStill(image: PreparedImage, jobId: string, userId: string | undefined): Promise<string | undefined> {
  if (image.format !== "gif" && image.format !== "svg") return undefined
  try {
    const still = await sharp(image.bytes)
      .resize(IMAGE_STILL_MAX_SIDE, IMAGE_STILL_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer()
    // In the job's own key family (`<jobId>-still`), so it is expired and deleted with the job.
    return await uploadBufferToR2(still, mediaObjectKey(`${jobId}-still`, "image", "png"), "image/png", userId)
  } catch (err) {
    console.error(`[ALERT] [image-output-store] job ${jobId}: no PNG still of its ${image.format}, the job keeps its file without one:`, err)
    return undefined
  }
}

/**
 * Store a run's images in the format their bytes are, the first at
 * `images/<jobId>.<ext>` and each variant at `images/<jobId>-v<n>.<ext>`.
 */
export async function storeFormattedImages(opts: {
  readonly sourceUrls: readonly string[]
  readonly jobId: string
  readonly userId: string | undefined
  readonly watermark: boolean
  /**
   * The job is a SET (it carries a set hold, `setHoldCreditId`): a picture
   * that cannot be stored after a retry is left out and the run settles on
   * the rest. Every other job, several variants included, stores all its
   * pictures or fails, as it always has.
   */
  readonly isSet?: boolean
}): Promise<StoredFormattedImages> {
  const { jobId, userId, watermark } = opts
  if (opts.sourceUrls.length === 0) throw new Error(`[image-output-store] job ${jobId}: no image to store`)
  // Every job that is not a set fetches and fits all its pictures before it
  // stores any, as it always has: a picture that cannot be fetched leaves
  // nothing stored or charged behind.
  if (!(opts.isSet === true && opts.sourceUrls.length > 1)) return storeAllOrNothing(opts.sourceUrls, jobId, userId, watermark)
  // A set (several images from one task) delivers what stored: an image that
  // cannot be fetched, fitted or stored is left out, and the run is charged
  // for the rest (lib/image-set-settle.ts reads the stored count).
  const urls: string[] = []
  const formats: ImageOutputFormat[] = []
  const undelivered = new Map<string, number>()
  // The key of each picture stored, in the order of `urls`.
  const storedKeys: string[] = []
  let still: PreparedImage | undefined
  let lastError: unknown
  // One image at a time, end to end (download, fit, store, release): a
  // watermark decodes the whole picture, and a set of ten 8K pictures (about
  // 67 MP each) held at once would hold them all.
  for (const [i, sourceUrl] of opts.sourceUrls.entries()) {
    // The keys this picture's attempts may have written, and what each was charged.
    const charged = new Map<string, number>()
    try {
      // A set retries a picture once (a transient fetch or store failure)
      // before leaving it out.
      const out = await withOneRetry(() => prepareAndStore(sourceUrl, jobId, i, userId, watermark, charged))
      // An earlier attempt under another extension is not delivered.
      for (const [key, bytes] of charged) if (key !== out.key) undelivered.set(key, bytes)
      const image = out.stored
      urls.push(out.url)
      storedKeys.push(out.key)
      formats.push(image.format)
      // Only a GIF's or an SVG's first stored file is kept, for its still.
      if (urls.length === 1 && (image.format === "gif" || image.format === "svg")) still = out.stored
    } catch (err) {
      // A refused SVG is the job's answer, not a drop; a storage state that
      // could not be read fails the step (retryable) rather than drop a
      // picture on a guess. Either way nothing is deleted here: another
      // finalize of the job may hold the same keys and complete it. What this
      // store wrote rides on the error for the finalize's fence; once the row
      // is failed, the failure funnel deletes every picture of the set
      // (`discardEndedSetImages`, lib/image-set-storage.ts).
      if (isDeterministicJobError(err) || isStorageStateUnknown(err)) {
        const written = new Map<string, number>([...undelivered, ...charged])
        for (const key of storedKeys) if (!written.has(key)) written.set(key, 0)
        throw Object.assign(err as Error, { undelivered: written })
      }
      lastError = err
      // Nothing of a dropped picture is delivered: what it may have written goes, later.
      for (const [key, bytes] of charged) undelivered.set(key, bytes)
      console.error(`[ALERT] [image-output-store] job ${jobId}: image ${i + 1} of ${opts.sourceUrls.length} could not be stored and is left out:`, err)
    }
  }
  if (urls.length === 0) {
    // Nothing was delivered: a final failure the run is refunded for.
    throw Object.assign(new DeterministicJobError(IMAGE_SET_NOT_STORED_MESSAGE, { cause: lastError }), { undelivered })
  }
  const thumbnailUrl = still ? await storeStill(still, jobId, userId) : undefined
  const first = formats[0]!
  return {
    urls,
    format: first,
    mimeType: IMAGE_OUTPUT_FORMAT_MIME[first],
    mimeTypes: formats.map((f) => IMAGE_OUTPUT_FORMAT_MIME[f]),
    dropped: opts.sourceUrls.length - urls.length,
    ...(thumbnailUrl !== undefined && { thumbnailUrl }),
    undelivered,
  }
}

/**
 * One image, or variants that are not a set: every picture fetched and fitted
 * first, then all stored (in parallel, as before), so a picture that cannot
 * be fetched leaves nothing behind.
 */
async function storeAllOrNothing(sourceUrls: readonly string[], jobId: string, userId: string | undefined, watermark: boolean): Promise<StoredFormattedImages> {
  // Every download finishes first, then each file is read in turn (an SVG
  // made safe, a raster fitted), as before: a refused SVG and a failed
  // download never race for which ends the run.
  const downloaded = await runPostProcessing(() => Promise.all(sourceUrls.map(download)))
  const prepared: PreparedImage[] = []
  for (const bytes of downloaded) prepared.push(await prepareBytes(bytes))
  return runPostProcessing(async () => {
    const stored = await Promise.all(prepared.map((image, i) => store(image, jobId, i, userId, watermark)))
    const first = stored[0]!.stored
    const thumbnailUrl = first.format === "gif" || first.format === "svg" ? await storeStill(first, jobId, userId) : undefined
    return {
      urls: stored.map((s) => s.url),
      format: first.format,
      mimeType: IMAGE_OUTPUT_FORMAT_MIME[first.format],
      mimeTypes: stored.map((s) => IMAGE_OUTPUT_FORMAT_MIME[s.stored.format]),
      dropped: 0,
      ...(thumbnailUrl !== undefined && { thumbnailUrl }),
      undelivered: new Map(),
    }
  })
}
