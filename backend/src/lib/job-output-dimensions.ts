/**
 * THE stamp of an image job's pixel size on its `output_data` (decided
 * 2026-10-15).
 *
 * A client laying out a grid of generated images needs each image's real size
 * before the image loads, and to show or sort by it. Every job completion
 * passes through one writer — `markJobCompletedDetailed` (workers/shared.ts),
 * plus the review approval's own CAS (lib/job-policy-review.ts) — and both run
 * their fields through here before they write. So every lane that publishes an
 * image is covered without a line of its own: the generation funnel, the
 * studios, the local sharp/ffmpeg lanes, relays and plugin lanes.
 * `lib/__tests__/job-output-dimensions-census.test.ts` pins that.
 *
 * WHAT IS STAMPED. An output that publishes `imageUrl` — the platform's image
 * output, the key the library and the MCP job envelope read — gains:
 *  - `width` / `height`: the size of `imageUrl`, integers, in pixels;
 *  - `images`: beside `imageUrls` (a job that made several), one
 *    `{ url, width, height }` per entry, index-aligned. An entry whose size
 *    could not be read keeps its `url` and has no `width` / `height`.
 * Only ABSENT fields are written: a lane that records its own size
 * (image-overlay) keeps it, and no existing field changes type.
 *
 * WHERE THE SIZE COMES FROM — the stored file, never the provider's copy: the
 * free-tier watermark and the oversized-image WebP re-encode rewrite the file
 * (dropping any EXIF orientation with it), and the size must describe what a
 * client downloads. In order:
 *  1. the size this process noted when it stored the file (the storage
 *     writers measure what they write — `lib/image-dimensions.ts`). A note
 *     that the stored bytes hold NO readable size ends it there: reading the
 *     file back would read the same bytes;
 *  2. a bounded read of the stored file's first bytes through the storage
 *     client. Never its public URL: the CDN caches a 404 for a year and this
 *     runs before the job reads `completed` (backend/CLAUDE.md, "Never GET a
 *     CDN media URL before its job is complete"), and inside a self-hosted
 *     container the public URL may not resolve at all. Only objects in our own
 *     bucket are read — a foreign URL is never fetched — and never a video or
 *     audio file (by key family or extension).
 *
 * NEVER SLOWER THAN ITS DEADLINE, NEVER A FAILURE. The reads share one
 * deadline (`OUTPUT_DIMENSIONS_DEADLINE_MS`), at most
 * `OUTPUT_DIMENSIONS_MAX_PARALLEL_READS` at a time, and any failure —
 * unreadable, not an image, slow — only leaves the fields out. A completion
 * never waits longer, and never fails, because of a size.
 *
 * The result gate's idempotency key is NOT the stamped output: the funnel keys
 * it on the lane's own output (`applyResultGate`'s `hashSubject`), because the
 * size depends on timing and two attempts at one job must find one verdict.
 */
import { r2KeyFromOurUrl, streamR2Object } from "./storage.js"
import {
  IMAGE_HEADER_FIRST_READ_BYTES,
  IMAGE_HEADER_MAX_READ_BYTES,
  imageDimensionsOf,
  storedImageDimensions,
  type ImageDimensions,
} from "./image-dimensions.js"

/** The most one completion waits for the sizes it has to read back. */
export const OUTPUT_DIMENSIONS_DEADLINE_MS = 3_000

/** The most stored files one completion reads back at once. */
export const OUTPUT_DIMENSIONS_MAX_PARALLEL_READS = 4

/** Key families of our own media that are never an image: not worth a read. */
const NOT_IMAGE_KEY_PREFIXES: readonly string[] = ["videos/", "audios/", "audio/"]

/** Files that are never an image, wherever they live — the motion reference
 *  sheet publishes its `reference-sheets/<jobId>.mp4` under `imageUrl` too. */
const NOT_IMAGE_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|mpe?g|ts|mp3|wav|m4a|aac|ogg|opus|oga|flac|weba)$/i

/** One entry of `images`, beside `imageUrls`. */
export interface OutputImage {
  readonly url: string
  readonly width?: number
  readonly height?: number
}

export interface ImageDimensionsOptions {
  /** Defaults to `OUTPUT_DIMENSIONS_DEADLINE_MS`. */
  readonly deadlineMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** The urls a stamp of `out` must measure, or null when it adds nothing. */
function whatToMeasure(out: Record<string, unknown>): { primary?: string; list?: readonly string[] } | null {
  if (!isUrl(out.imageUrl)) return null
  const primary = out.width === undefined && out.height === undefined ? out.imageUrl : undefined
  const list =
    out.images === undefined && Array.isArray(out.imageUrls) && out.imageUrls.length > 0 && out.imageUrls.every(isUrl)
      ? (out.imageUrls as readonly string[])
      : undefined
  return primary || list ? { primary, list } : null
}

/** The key of one of OUR stored objects that could be an image, or null (foreign, video, audio). */
function storedImageKey(url: string): string | null {
  const key = r2KeyFromOurUrl(url)
  if (!key || NOT_IMAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) || NOT_IMAGE_EXTENSION.test(key)) return null
  return key
}

/** A stored content type that can hold an image — absent and opaque ones included. */
function mayBeImage(contentType: string | null): boolean {
  if (!contentType) return true
  const type = contentType.toLowerCase()
  return type.startsWith("image/") || type.startsWith("application/octet-stream") || type.startsWith("binary/octet-stream")
}

/**
 * The displayed size of one stored object, from its first bytes: one ranged
 * read on `signal`, decoded at the first 64 KB and again at the cap. Never throws.
 */
async function readStoredImageDimensions(key: string, signal: AbortSignal): Promise<ImageDimensions | undefined> {
  const object = await streamR2Object(key, { range: `bytes=0-${IMAGE_HEADER_MAX_READ_BYTES - 1}`, signal }).catch(() => null)
  if (!object) return undefined
  const { body } = object
  try {
    if (!mayBeImage(object.contentType)) return undefined
    const chunks: Buffer[] = []
    let total = 0
    let decodeAt = IMAGE_HEADER_FIRST_READ_BYTES
    for await (const chunk of body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      chunks.push(bytes)
      total += bytes.length
      if (total < decodeAt) continue
      const size = await imageDimensionsOf(Buffer.concat(chunks, Math.min(total, IMAGE_HEADER_MAX_READ_BYTES)))
      // A store that ignores the range is cut off at the cap, never read whole.
      if (size || total >= IMAGE_HEADER_MAX_READ_BYTES) return size
      decodeAt = IMAGE_HEADER_MAX_READ_BYTES
    }
    return total > 0 ? await imageDimensionsOf(Buffer.concat(chunks, total)) : undefined
  } catch {
    // A body that failed or was aborted at the deadline.
    return undefined
  } finally {
    body.destroy()
  }
}

/**
 * The size of every url that has one: noted at store time, else read back
 * under one deadline, at most `OUTPUT_DIMENSIONS_MAX_PARALLEL_READS` at a time.
 * What arrived before the deadline is kept.
 */
async function measure(urls: readonly string[], deadlineMs: number): Promise<ReadonlyMap<string, ImageDimensions>> {
  const sizes = new Map<string, ImageDimensions>()
  const reads: Array<{ url: string; key: string }> = []
  for (const url of urls) {
    const noted = storedImageDimensions(url)
    if (noted) {
      sizes.set(url, noted)
      continue
    }
    // `null`: this process stored it and its bytes hold no readable size —
    // reading the file back would read the same bytes.
    if (noted === null) continue
    const key = storedImageKey(url)
    if (key) reads.push({ url, key })
  }
  if (reads.length === 0) return sizes

  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new DOMException("image size read: deadline passed", "TimeoutError")), deadlineMs)
  const deadlinePassed = new Promise<void>((resolve) => deadline.signal.addEventListener("abort", () => resolve(), { once: true }))
  try {
    let next = 0
    const reader = async (): Promise<void> => {
      while (next < reads.length && !deadline.signal.aborted) {
        const { url, key } = reads[next++]!
        const size = await readStoredImageDimensions(key, deadline.signal)
        if (size && !deadline.signal.aborted) sizes.set(url, size)
      }
    }
    const all = Promise.all(Array.from({ length: Math.min(OUTPUT_DIMENSIONS_MAX_PARALLEL_READS, reads.length) }, reader))
    await Promise.race([all, deadlinePassed])
    if (deadline.signal.aborted) {
      console.warn(`[job-output-dimensions] ${reads.length} stored image(s) not read within ${deadlineMs} ms; their size is left out`)
    }
    return new Map(sizes)
  } finally {
    clearTimeout(timer)
    // Settles the race's loser: an unfinished read is aborted, never left running.
    if (!deadline.signal.aborted) deadline.abort()
  }
}

/**
 * `output` with the pixel size of the image(s) it publishes — a NEW object, or
 * `output` itself when there is nothing to add. Anything that is not an image
 * output (no `imageUrl`, not an object) comes back as it was. Never throws.
 */
export async function withImageDimensions<T>(output: T, opts: ImageDimensionsOptions = {}): Promise<T> {
  if (!isRecord(output)) return output
  try {
    const want = whatToMeasure(output)
    if (!want) return output
    const urls = [...new Set([...(want.primary ? [want.primary] : []), ...(want.list ?? [])])]
    const sizes = await measure(urls, opts.deadlineMs ?? OUTPUT_DIMENSIONS_DEADLINE_MS)
    const primary = want.primary ? sizes.get(want.primary) : undefined
    const images: readonly OutputImage[] | undefined = want.list?.map((url) => {
      const size = sizes.get(url)
      return size ? { url, width: size.width, height: size.height } : { url }
    })
    const anyImageSized = images?.some((image) => image.width !== undefined) ?? false
    if (!primary && !anyImageSized) return output
    return {
      ...output,
      ...(primary ? { width: primary.width, height: primary.height } : {}),
      ...(anyImageSized ? { images } : {}),
    }
  } catch (err) {
    console.warn(`[job-output-dimensions] image size not stamped: ${err instanceof Error ? err.message : String(err)}`)
    return output
  }
}

/**
 * The completion fields with `output_data` stamped (`withImageDimensions`) —
 * a NEW object, or `fields` itself when there is nothing to add. Every other
 * column is passed through untouched. Never throws.
 */
export async function withOutputImageDimensions(
  fields: Record<string, unknown>,
  opts: ImageDimensionsOptions = {},
): Promise<Record<string, unknown>> {
  const output = fields.output_data
  const stamped = await withImageDimensions(output, opts)
  return stamped === output ? fields : { ...fields, output_data: stamped }
}
