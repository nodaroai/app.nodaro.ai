/**
 * A photo over a network's byte limit is re-encoded so the network accepts it.
 *
 * Facebook refuses a photo of 10 MB or more and Instagram a JPEG over 8 MB,
 * while the platform's own 2K PNGs (GPT Image 2 at 2K) can be larger than
 * both. A network that declares `photoMaxBytes` therefore gets, for every
 * photo of a publish (`fitRequestPhotos`):
 *   - a photo within the limit, sent as it is. Its size is read from storage,
 *     or from the outside server's answer to a HEAD request; the photo itself
 *     is not read;
 *   - a photo over it, re-encoded as a JPEG (quality 90) at its own size, and
 *     scaled down, keeping its shape, only when that JPEG is still too large.
 *     It is turned upright by its EXIF orientation and laid on white where it
 *     was transparent. The copy is stored in the publish job's scratch folder
 *     and its URL replaces the photo's; `discardPhotoCopies` deletes it once
 *     the publish call has ended (the network fetches the photo during the
 *     call).
 *
 * Fail-open: a photo that cannot be read (storage and its public address both
 * fail, or it is not a picture) is sent as it is, as before, and the network
 * answers for it. A copy that cannot be stored is a `NotPublishedError`:
 * nothing was sent, so a retry is safe.
 */
import sharp from "sharp"
import { headR2Object, r2KeyFromOurUrl, readR2Object } from "../../lib/storage.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { boundedPublicChunks } from "../../lib/safe-fetch-bytes.js"
import { discardJobScratchFile, uploadJobScratchBuffer } from "../../lib/job-scratch.js"
import { DOWNSCALE_INPUT_PIXEL_CEILING, sizeWithinPixels } from "../../lib/image-pixel-fit.js"
import { PHOTO_URL_ACTIONS } from "./actions.js"
import type { PublishRequest } from "./platforms/index.js"
import { BadBodyError, NotPublishedError } from "./providers/types.js"

/** The JPEG quality a photo is re-encoded at. */
export const PHOTO_JPEG_QUALITY = 90

/** The largest photo read in order to re-encode it. A bigger one is sent as it is. */
export const PHOTO_READ_MAX_BYTES = 200 * 1024 * 1024

/** One limit for reading an outside photo, response and body together (the most the download allows). */
const PHOTO_READ_TIMEOUT_MS = 120_000

/** One limit for asking an outside server how large a photo is. */
const SIZE_PROBE_TIMEOUT_MS = 10_000

/** A scaled-down JPEG aims at this share of the limit: its size follows its pixel count only roughly. */
const SHRINK_TARGET = 0.9

/** How many times a photo is scaled down before the fitter gives up. Two are enough in practice. */
const MAX_SHRINK_STEPS = 6

export interface FittedPhoto {
  /** The URL to send: the photo's own, or its re-encoded copy's. */
  readonly url: string
  /** Whether `url` is a copy this call stored (deleted by `discardPhotoCopies`). */
  readonly copied: boolean
}

export interface FittedRequest {
  readonly request: PublishRequest
  /** The copies this call stored, for `discardPhotoCopies` once the publish call has ended. */
  readonly copies: readonly string[]
}

/** Host only: object keys can carry signed query values. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "<unparsable>"
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function inMegabytes(bytes: number): string {
  return `${Math.round(bytes / 100_000) / 10} MB`
}

/** The photo's size as storage or its server states it, without reading it; undefined when unknown. */
async function statedSize(url: string): Promise<number | undefined> {
  try {
    const key = r2KeyFromOurUrl(url)
    if (key) {
      const head = await headR2Object(key)
      return head.exists ? head.sizeBytes : undefined
    }
    const res = await safeFetch(url, { method: "HEAD", timeoutMs: SIZE_PROBE_TIMEOUT_MS })
    if (!res.ok) return undefined
    // Only an unencoded length is the size of the file.
    if ((res.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity") return undefined
    const size = Number(res.headers.get("content-length"))
    return Number.isSafeInteger(size) && size > 0 ? size : undefined
  } catch {
    return undefined
  }
}

/** The photo's bytes: ours through storage, else through the SSRF-safe public download. Undefined when unreadable. */
async function readPhoto(url: string): Promise<Buffer | undefined> {
  const key = r2KeyFromOurUrl(url)
  if (key) {
    const own = await readR2Object(key, { maxBytes: PHOTO_READ_MAX_BYTES })
    if (own && own.body.length > 0) return own.body
    // An empty body is a photo over the read limit: sent as it is.
    if (own) return undefined
    // Storage could not serve it: its public address may, as it will for the network.
  }
  try {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of boundedPublicChunks(url, {
      maxBytes: PHOTO_READ_MAX_BYTES,
      timeoutMs: PHOTO_READ_TIMEOUT_MS,
      label: "Image",
    })) {
      chunks.push(chunk)
      length += chunk.length
    }
    return Buffer.concat(chunks, length)
  } catch (err) {
    console.warn(`[social-photo] could not read the photo from ${hostOf(url)} to fit it (${messageOf(err)}); sent as it is`)
    return undefined
  }
}

/** The photo upright, on white where it was transparent, as a JPEG, at `size` (its own size when absent). */
function encodeJpeg(bytes: Buffer, size?: { width: number; height: number }): Promise<Buffer> {
  const upright = sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING }).rotate()
  const sized = size ? upright.resize(size.width, size.height, { fit: "fill" }) : upright
  return sized.flatten({ background: "#ffffff" }).jpeg({ quality: PHOTO_JPEG_QUALITY }).toBuffer()
}

/** A JPEG of the photo within `maxBytes`: at its own size when that fits, else scaled down. Undefined when not a picture. */
async function jpegUnder(bytes: Buffer, maxBytes: number): Promise<Buffer | undefined> {
  let jpeg: Buffer
  try {
    const meta = await sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING }).metadata()
    const width = meta.autoOrient?.width ?? meta.width
    const height = meta.autoOrient?.height ?? meta.height
    if (!width || !height) return undefined
    let size = { width, height }
    jpeg = await encodeJpeg(bytes)
    for (let step = 1; jpeg.length > maxBytes && step <= MAX_SHRINK_STEPS; step++) {
      size = sizeWithinPixels(
        size.width,
        size.height,
        Math.floor((size.width * size.height * maxBytes * SHRINK_TARGET) / jpeg.length),
      )
      jpeg = await encodeJpeg(bytes, size)
    }
  } catch {
    return undefined
  }
  if (jpeg.length > maxBytes) {
    throw new BadBodyError(`The photo could not be made smaller than ${inMegabytes(maxBytes)} to post. Nothing was posted.`)
  }
  return jpeg
}

/**
 * The photo at `url` within `maxBytes`: as it is when it fits (or cannot be
 * read), else a re-encoded JPEG stored in the scratch folder of `jobId`.
 */
export async function fitPhotoUnderBytes(url: string, maxBytes: number, jobId: string | undefined): Promise<FittedPhoto> {
  const asIs: FittedPhoto = { url, copied: false }
  const stated = await statedSize(url)
  if (stated !== undefined && stated <= maxBytes) return asIs

  const bytes = await readPhoto(url)
  if (!bytes || bytes.length <= maxBytes) return asIs

  const jpeg = await jpegUnder(bytes, maxBytes)
  if (!jpeg) {
    console.warn(`[social-photo] the file from ${hostOf(url)} is over ${inMegabytes(maxBytes)} and is not a picture this can re-encode; sent as it is`)
    return asIs
  }
  try {
    return { url: await uploadJobScratchBuffer(jpeg, "social-photo", "jpg", "image/jpeg", jobId), copied: true }
  } catch (err) {
    console.error(`[social-photo] storing the re-encoded photo for job ${jobId ?? "(none)"} failed:`, err)
    throw new NotPublishedError(
      `The photo is larger than ${inMegabytes(maxBytes)} and its smaller copy could not be stored. ` +
        "The post was NOT published — retrying is safe.",
    )
  }
}

/** The photos of a request: its `mediaUrl` when the action posts one, and its photo items, each once. */
function photoUrlsOf(request: PublishRequest): string[] {
  const fromUrl = request.mediaUrl && PHOTO_URL_ACTIONS.has(request.action) ? [request.mediaUrl] : []
  const fromItems = (request.mediaItems ?? []).filter((item) => item.type === "photo").map((item) => item.url)
  return [...new Set([...fromUrl, ...fromItems])]
}

function copiesOf(fitted: ReadonlyMap<string, FittedPhoto>): string[] {
  return [...fitted.values()].filter((photo) => photo.copied).map((photo) => photo.url)
}

/**
 * The request with every photo fitted under `maxBytes` (the given request is
 * not changed), and the copies made for it. No limit: the request as it is.
 * When one photo fails, the copies already made are deleted before the error
 * is rethrown.
 */
export async function fitRequestPhotos(
  request: PublishRequest,
  maxBytes: number | undefined,
  jobId: string | undefined,
): Promise<FittedRequest> {
  if (maxBytes === undefined) return { request, copies: [] }
  const photoUrls = photoUrlsOf(request)
  if (photoUrls.length === 0) return { request, copies: [] }

  // One at a time: each photo is decoded in full, and a carousel holds up to ten.
  const fitted = new Map<string, FittedPhoto>()
  try {
    for (const url of photoUrls) fitted.set(url, await fitPhotoUnderBytes(url, maxBytes, jobId))
  } catch (err) {
    await discardPhotoCopies(copiesOf(fitted), jobId)
    throw err
  }

  const urlFor = (url: string): string => fitted.get(url)?.url ?? url
  return {
    request: {
      ...request,
      ...(request.mediaUrl && PHOTO_URL_ACTIONS.has(request.action) ? { mediaUrl: urlFor(request.mediaUrl) } : {}),
      ...(request.mediaItems
        ? { mediaItems: request.mediaItems.map((item) => (item.type === "photo" ? { ...item, url: urlFor(item.url) } : item)) }
        : {}),
    },
    copies: copiesOf(fitted),
  }
}

/** Delete the copies a publish stored, from the scratch folder of `jobId`. Never throws. */
export async function discardPhotoCopies(copies: readonly string[], jobId: string | undefined): Promise<void> {
  if (!jobId || copies.length === 0) return
  await Promise.all(copies.map((url) => discardJobScratchFile(url, jobId)))
}
