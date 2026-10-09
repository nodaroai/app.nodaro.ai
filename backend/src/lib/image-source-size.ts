/**
 * The size of the image an image-to-image or edit request transforms, read
 * from the first bytes of the file — the input that lets "auto" keep the
 * source photo's shape on a model without a native auto
 * (`normalizeModelInput`'s `sourceImage` in @nodaro/shared).
 *
 * Shared by the two places a run starts: the image routes (`/v1/image-to-image`,
 * `/v1/edit-image`) and the workflow run (node-executor, ahead of the
 * synchronous payload build). Both probe the SAME image the provider is sent,
 * through this one function, so a source resolves to one ratio wherever it runs.
 *
 * Three promises:
 *   1. HEADER ONLY. A byte range of at most `SOURCE_SIZE_MAX_READ_BYTES`; the
 *      read stops as soon as the size is known, and a server that ignores the
 *      range is cut off at the cap rather than downloaded.
 *   2. BOUNDED. `SOURCE_SIZE_DEADLINE_MS` covers everything: the request, the
 *      read and `fetchOwnMedia`'s retry pauses all run on one abort signal, and
 *      the answer itself is raced against the same deadline, so nothing past
 *      it — a stalled body included — can hold a caller.
 *   3. FAIL-OPEN. Any failure — refused, missing, slow, not an image — answers
 *      `undefined`, which leaves "auto" on its usual fallback. Never a reason
 *      for a run to fail.
 */
import sharp from "sharp"
import { autoAspectNeedsSourceImage, type SourceImageSize } from "@nodaro/shared"
import { fetchOwnMedia, isOwnMediaUrl } from "./fetch-own-media.js"

/** One deadline for the whole probe. */
export const SOURCE_SIZE_DEADLINE_MS = 4_000

/** First decode attempt: covers PNG / WebP / GIF / AVIF headers and most JPEGs. */
export const SOURCE_SIZE_FIRST_READ_BYTES = 64 * 1024

/**
 * The most this ever reads. A phone JPEG can carry an EXIF thumbnail, ICC
 * profile and XMP ahead of its frame header, which can push that header past
 * the first read.
 */
export const SOURCE_SIZE_MAX_READ_BYTES = 512 * 1024

/**
 * Sizes already read, by url — our own media only: we write those objects under
 * fresh keys, so a url's bytes never change. A third-party url can serve
 * different bytes tomorrow, so it is read every time.
 */
const sizeByUrl = new Map<string, SourceImageSize>()
const MAX_REMEMBERED = 500

function remember(url: string, size: SourceImageSize): void {
  if (!isOwnMediaUrl(url)) return
  if (sizeByUrl.size >= MAX_REMEMBERED) {
    const oldest = sizeByUrl.keys().next().value
    if (oldest !== undefined) sizeByUrl.delete(oldest)
  }
  sizeByUrl.set(url, size)
}

/** Clears the sizes already read — for tests. */
export function forgetProbedImageSizes(): void {
  sizeByUrl.clear()
}

/** Host only: object keys can carry signed query values. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "<unparsable>"
  }
}

/** The DISPLAYED size (EXIF orientation applied) from an image's leading bytes, or undefined. */
async function sizeFromHeader(bytes: Buffer): Promise<SourceImageSize | undefined> {
  try {
    const meta = await sharp(bytes).metadata()
    const width = meta.autoOrient?.width ?? meta.width
    const height = meta.autoOrient?.height ?? meta.height
    return width > 0 && height > 0 ? { width, height } : undefined
  } catch {
    // Not enough of the header yet, or not an image sharp can read.
    return undefined
  }
}

/** The request and the bounded read, on `signal`. Never throws. */
async function readSize(url: string, signal: AbortSignal): Promise<SourceImageSize | undefined> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetchOwnMedia(url, {
      headers: { Range: `bytes=0-${SOURCE_SIZE_MAX_READ_BYTES - 1}` },
      timeoutMs: SOURCE_SIZE_DEADLINE_MS,
      signal,
    })
    if (!res.ok || !res.body) {
      void res.body?.cancel().catch(() => {})
      console.warn(`[source-image-size] ${hostOf(url)} answered HTTP ${res.status}; "auto" keeps its usual ratio`)
      return undefined
    }
    reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let decodeAt = SOURCE_SIZE_FIRST_READ_BYTES
    for (;;) {
      const { done, value } = await reader.read()
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
      if (!done && total < decodeAt) continue
      const size = await sizeFromHeader(Buffer.concat(chunks, Math.min(total, SOURCE_SIZE_MAX_READ_BYTES)))
      if (size) return size
      if (done || total >= SOURCE_SIZE_MAX_READ_BYTES) {
        console.warn(`[source-image-size] no readable image header from ${hostOf(url)}; "auto" keeps its usual ratio`)
        return undefined
      }
      decodeAt = SOURCE_SIZE_MAX_READ_BYTES
    }
  } catch (err) {
    // An abort is the deadline, which the caller reports.
    if (!signal.aborted) {
      console.warn(
        `[source-image-size] could not read the source image from ${hostOf(url)} (${err instanceof Error ? err.message : String(err)}); "auto" keeps its usual ratio`,
      )
    }
    return undefined
  } finally {
    // Frees the socket when the size was found before the body ended.
    void reader?.cancel().catch(() => {})
  }
}

/**
 * The displayed pixel size of the image at `url`, read from its header.
 * `undefined` when it cannot be read within the deadline (see the module doc).
 */
export async function probeImageDisplaySize(url: string): Promise<SourceImageSize | undefined> {
  const known = sizeByUrl.get(url)
  if (known) return known

  const deadline = new AbortController()
  const timer = setTimeout(
    () => deadline.abort(new DOMException("source image size: deadline passed", "TimeoutError")),
    SOURCE_SIZE_DEADLINE_MS,
  )
  const deadlinePassed = new Promise<undefined>((resolve) => {
    deadline.signal.addEventListener("abort", () => resolve(undefined), { once: true })
  })
  try {
    const size = await Promise.race([readSize(url, deadline.signal), deadlinePassed])
    if (size) {
      remember(url, size)
      return size
    }
    if (deadline.signal.aborted) {
      console.warn(`[source-image-size] ${hostOf(url)} did not answer within ${SOURCE_SIZE_DEADLINE_MS} ms; "auto" keeps its usual ratio`)
    }
    return undefined
  } finally {
    clearTimeout(timer)
    // Settles the race's loser: an unfinished read is cancelled, never left running.
    if (!deadline.signal.aborted) deadline.abort()
  }
}

/**
 * The source size an image request needs, or undefined without any I/O when
 * it would not be used: only "auto" on a model whose catalog ratios lack
 * "auto" reads it (`autoAspectNeedsSourceImage`), and only for a real url.
 */
export async function sourceImageForAutoAspect(
  modelId: string | undefined,
  aspectRatio: unknown,
  imageUrl: unknown,
): Promise<SourceImageSize | undefined> {
  if (!autoAspectNeedsSourceImage(modelId, aspectRatio)) return undefined
  if (typeof imageUrl !== "string" || imageUrl.length === 0) return undefined
  return probeImageDisplaySize(imageUrl)
}
