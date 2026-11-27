/**
 * A photo over a network's byte limit is re-encoded so the network accepts it.
 *
 * Facebook refuses a photo of 10 MB or more and Instagram a JPEG over 8 MB,
 * while the platform's own 2K PNGs (GPT Image 2 at 2K) can be larger than
 * both. A network that declares `photoMaxBytes` therefore gets, for every
 * photo of a publish (`fitRequestPhotos`):
 *   - a photo within the limit, sent as it is. Its size comes from a HEAD
 *     request; the photo itself is not downloaded;
 *   - a photo over it, re-encoded as a JPEG (quality 90) at its own size, and
 *     scaled down, keeping its shape, only when that JPEG is still too large.
 *     It is turned upright by its EXIF orientation and laid on white where it
 *     was transparent. The copy is stored in the publish job's scratch folder
 *     and its URL replaces the photo's; `discardPhotoCopies` deletes it once
 *     the publish call has ended (the network fetches the photo during the
 *     call).
 *
 * What it reads, and what it leaves alone:
 *   - Only OUR OWN media (a picture made or uploaded here), and only through
 *     its public address, the one the network itself fetches. So it can read
 *     nothing the network could not: a folder the public edge blocks, or an
 *     object that is not public, answers the same refusal here. An outside
 *     link is sent as it is, as before: copying it into our storage would be
 *     an import of an outside file, which this step does not ask for.
 *   - An animated picture or an SVG is sent as it is: a JPEG would keep one
 *     frame, or draw a file this step should not rasterize.
 *   - One photo at a time per process (each holds the file and its decoded
 *     pixels in memory), and never past the caller's deadline
 *     (`publishDeadlineMs`).
 *
 * Fail-open: a photo that cannot be read is sent as it is, and the network
 * answers for it. A copy that cannot be stored, or no time left to make it, is
 * a `NotPublishedError`: nothing was sent, so a retry is safe.
 */
import sharp from "sharp"
import { isOwnMediaUrl } from "../../lib/fetch-own-media.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import { boundedPublicChunks } from "../../lib/safe-fetch-bytes.js"
import { discardJobScratchFile, uploadJobScratchBuffer } from "../../lib/job-scratch.js"
import { DOWNSCALE_INPUT_PIXEL_CEILING, isAnimatedPng, sizeWithinPixels } from "../../lib/image-pixel-fit.js"
import { PHOTO_ITEM_ACTIONS, PHOTO_URL_ACTIONS } from "./actions.js"
import type { PublishRequest } from "./platforms/index.js"
import { BadBodyError, NotPublishedError } from "./providers/types.js"

/** The JPEG quality a photo is re-encoded at. */
export const PHOTO_JPEG_QUALITY = 90

/** The largest photo read in order to re-encode it. A bigger one is sent as it is. */
export const PHOTO_READ_MAX_BYTES = 100 * 1024 * 1024

/** One limit for reading a photo, response and body together (the most the download allows). */
const PHOTO_READ_TIMEOUT_MS = 120_000

/** One limit for asking how large a photo is. */
const SIZE_PROBE_TIMEOUT_MS = 10_000

/** The time a re-encode may take, each attempt. */
const ENCODE_TIMEOUT_SECONDS = 30

/** Time kept for the network's own call once the photos are fitted. */
export const PUBLISH_CALL_RESERVE_MS = 60_000

/** A scaled-down JPEG aims at this share of the limit: its size follows its pixel count only roughly. */
const SHRINK_TARGET = 0.9

/** How many times a photo is scaled down before the fitter gives up. Two are enough in practice. */
const MAX_SHRINK_STEPS = 6

/** Photos read and re-encoded at once in this process: each holds the file and its decoded pixels in memory. */
const MAX_FITS_AT_ONCE = 1

export interface FitOptions {
  /** When the publish call must answer (epoch ms): the sync route's `publishDeadlineMs`. */
  readonly deadlineMs?: number
}

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

type SizeProbe =
  | { readonly kind: "size"; readonly bytes: number }
  | { readonly kind: "refused" }
  | { readonly kind: "unknown" }

let fitsRunning = 0
const fitsWaiting: Array<() => void> = []

async function takeFitSlot(): Promise<void> {
  if (fitsRunning < MAX_FITS_AT_ONCE) {
    fitsRunning += 1
    return
  }
  await new Promise<void>((resolve) => fitsWaiting.push(resolve))
}

/** The slot passes straight to the next waiter, so no new caller can slip in between. */
function giveBackFitSlot(): void {
  const next = fitsWaiting.shift()
  if (next) next()
  else fitsRunning -= 1
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

/** Time left before the deadline, less what the network's call needs; undefined without a deadline. */
function timeLeftMs(opts: FitOptions): number | undefined {
  return opts.deadlineMs === undefined ? undefined : opts.deadlineMs - PUBLISH_CALL_RESERVE_MS - Date.now()
}

/** The photo's size from a HEAD request to its public address, without reading it. */
async function probeSize(url: string, timeoutMs: number): Promise<SizeProbe> {
  try {
    const res = await safeFetch(url, { method: "HEAD", timeoutMs })
    // Blocked, missing or private: the network meets the same answer, so nothing is read.
    if (!res.ok) return { kind: "refused" }
    // Only an unencoded length is the size of the file.
    if ((res.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity") return { kind: "unknown" }
    const size = Number(res.headers.get("content-length"))
    return Number.isSafeInteger(size) && size > 0 ? { kind: "size", bytes: size } : { kind: "unknown" }
  } catch {
    return { kind: "unknown" }
  }
}

/** The photo's bytes through the SSRF-safe public download; undefined when unreadable. */
async function readPhoto(url: string, timeoutMs: number): Promise<Buffer | undefined> {
  try {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of boundedPublicChunks(url, { maxBytes: PHOTO_READ_MAX_BYTES, timeoutMs, label: "Image" })) {
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
  const upright = sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING }).timeout({ seconds: ENCODE_TIMEOUT_SECONDS }).rotate()
  const sized = size ? upright.resize(size.width, size.height, { fit: "fill" }) : upright
  return sized.flatten({ background: "#ffffff" }).jpeg({ quality: PHOTO_JPEG_QUALITY }).toBuffer()
}

/**
 * A JPEG of the photo within `maxBytes`: at its own size when that fits, else
 * scaled down. Undefined for a file that is not a still raster picture.
 */
async function jpegUnder(bytes: Buffer, maxBytes: number): Promise<Buffer | undefined> {
  let jpeg: Buffer
  try {
    const meta = await sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING }).metadata()
    if (meta.format === "svg" || (meta.pages ?? 1) > 1 || isAnimatedPng(bytes)) return undefined
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

/** Read, re-encode and store the photo, holding a fit slot. */
async function fitInSlot(url: string, maxBytes: number, jobId: string, opts: FitOptions): Promise<FittedPhoto> {
  const asIs: FittedPhoto = { url, copied: false }
  const left = timeLeftMs(opts)
  if (left !== undefined && left <= 0) {
    throw new NotPublishedError(
      "There was no time left to prepare the photo for posting. The post was NOT published — retrying is safe.",
    )
  }
  const bytes = await readPhoto(url, Math.max(1, Math.floor(Math.min(PHOTO_READ_TIMEOUT_MS, left ?? PHOTO_READ_TIMEOUT_MS))))
  if (!bytes || bytes.length <= maxBytes) return asIs

  const jpeg = await jpegUnder(bytes, maxBytes)
  if (!jpeg) {
    console.warn(`[social-photo] the file from ${hostOf(url)} is over ${inMegabytes(maxBytes)} and is not a still picture this re-encodes; sent as it is`)
    return asIs
  }
  try {
    return { url: await uploadJobScratchBuffer(jpeg, "social-photo", "jpg", "image/jpeg", jobId), copied: true }
  } catch (err) {
    console.error(`[social-photo] storing the re-encoded photo for job ${jobId} failed:`, err)
    throw new NotPublishedError(
      `The photo is larger than ${inMegabytes(maxBytes)} and its smaller copy could not be stored. ` +
        "The post was NOT published — retrying is safe.",
    )
  }
}

/**
 * The photo at `url` within `maxBytes`: as it is when it fits, is not ours or
 * cannot be read, else a re-encoded JPEG stored in the scratch folder of `jobId`.
 */
export async function fitPhotoUnderBytes(url: string, maxBytes: number, jobId: string, opts: FitOptions = {}): Promise<FittedPhoto> {
  const asIs: FittedPhoto = { url, copied: false }
  if (!isOwnMediaUrl(url)) return asIs
  const left = timeLeftMs(opts)
  // Out of time before even asking: sent as it is, as before this step existed.
  if (left !== undefined && left <= 0) return asIs

  const probe = await probeSize(url, Math.max(1, Math.floor(Math.min(SIZE_PROBE_TIMEOUT_MS, left ?? SIZE_PROBE_TIMEOUT_MS))))
  if (probe.kind === "refused") return asIs
  if (probe.kind === "size" && probe.bytes <= maxBytes) return asIs

  await takeFitSlot()
  try {
    return await fitInSlot(url, maxBytes, jobId, opts)
  } finally {
    giveBackFitSlot()
  }
}

/** The photos a request posts: its `mediaUrl` when the action posts one, its photo items when the action posts items. */
function photoUrlsOf(request: PublishRequest): string[] {
  const fromUrl = request.mediaUrl && PHOTO_URL_ACTIONS.has(request.action) ? [request.mediaUrl] : []
  const fromItems = PHOTO_ITEM_ACTIONS.has(request.action)
    ? (request.mediaItems ?? []).filter((item) => item.type === "photo").map((item) => item.url)
    : []
  return [...new Set([...fromUrl, ...fromItems])]
}

function copiesOf(fitted: ReadonlyMap<string, FittedPhoto>): string[] {
  return [...fitted.values()].filter((photo) => photo.copied).map((photo) => photo.url)
}

/**
 * The request with every photo it posts fitted under `maxBytes` (the given
 * request is not changed), and the copies made for it. No limit: the request
 * as it is. When one photo fails, the copies already made are deleted before
 * the error is rethrown.
 */
export async function fitRequestPhotos(
  request: PublishRequest,
  maxBytes: number | undefined,
  jobId: string,
  opts: FitOptions = {},
): Promise<FittedRequest> {
  if (maxBytes === undefined) return { request, copies: [] }
  const photoUrls = photoUrlsOf(request)
  if (photoUrls.length === 0) return { request, copies: [] }

  const fitted = new Map<string, FittedPhoto>()
  try {
    for (const url of photoUrls) fitted.set(url, await fitPhotoUnderBytes(url, maxBytes, jobId, opts))
  } catch (err) {
    await discardPhotoCopies(copiesOf(fitted), jobId)
    throw err
  }

  const urlFor = (url: string): string => fitted.get(url)?.url ?? url
  return {
    request: {
      ...request,
      ...(request.mediaUrl && PHOTO_URL_ACTIONS.has(request.action) ? { mediaUrl: urlFor(request.mediaUrl) } : {}),
      ...(request.mediaItems && PHOTO_ITEM_ACTIONS.has(request.action)
        ? { mediaItems: request.mediaItems.map((item) => (item.type === "photo" ? { ...item, url: urlFor(item.url) } : item)) }
        : {}),
    },
    copies: copiesOf(fitted),
  }
}

/** Delete the copies a publish stored, from the scratch folder of `jobId`. Never throws. */
export async function discardPhotoCopies(copies: readonly string[], jobId: string): Promise<void> {
  if (copies.length === 0) return
  await Promise.all(copies.map((url) => discardJobScratchFile(url, jobId)))
}
