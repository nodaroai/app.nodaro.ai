/**
 * What a provider's image limits need to know about an image before a run
 * holds credits: its pixel size and its size in bytes, read from the first
 * bytes of the file and the server's own answer.
 *
 * Header only, like `image-source-size.ts`: one ranged GET of at most
 * `IMAGE_HEADER_MAX_READ_BYTES`, stopped as soon as the size is known. The
 * file's byte size comes from the same response — the total in
 * `Content-Range` (a ranged answer) or `Content-Length` (a server that sent
 * the whole file) — so nothing is downloaded to weigh it.
 *
 * The pixel size is the one sharp reads (`imageDimensionsOf`): JPEG, PNG,
 * WebP, GIF (its first frame), TIFF, AVIF, SVG. A format sharp does not read
 * (BMP, a HEIC photo) answers `undefined` here.
 *
 * Never throws: anything that cannot be read in time answers `undefined`
 * fields, and the caller decides what an unknown means.
 */
import { fetchOwnMedia } from "./fetch-own-media.js"
import { IMAGE_HEADER_FIRST_READ_BYTES, IMAGE_HEADER_MAX_READ_BYTES, imageDimensionsOf, type ImageDimensions } from "./image-dimensions.js"

/** One deadline for the whole read: a refusal rides on it, so it is longer than the "auto" ratio probe's. */
export const IMAGE_SOURCE_PROBE_DEADLINE_MS = 10_000

export interface ImageSourceProbe {
  /** The displayed pixel size, or undefined when the header could not be read. */
  readonly size?: ImageDimensions
  /** The file's size in bytes as its server declares it, or undefined when it declared none. */
  readonly sizeBytes?: number
}

/** The total length of the file a response is (part of), from its headers. */
export function declaredFileBytes(res: Pick<Response, "status" | "headers">): number | undefined {
  const range = res.headers.get("content-range")
  const total = range?.match(/\/(\d+)\s*$/)?.[1]
  if (total !== undefined) {
    const n = Number(total)
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
  }
  // A 206 without a readable total names only the part sent, never the file.
  if (res.status === 206) return undefined
  const length = Number(res.headers.get("content-length") ?? "")
  return Number.isSafeInteger(length) && length > 0 ? length : undefined
}

async function readProbe(url: string, signal: AbortSignal): Promise<ImageSourceProbe> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetchOwnMedia(url, {
      headers: { Range: `bytes=0-${IMAGE_HEADER_MAX_READ_BYTES - 1}` },
      timeoutMs: IMAGE_SOURCE_PROBE_DEADLINE_MS,
      signal,
    })
    if (!res.ok || !res.body) {
      void res.body?.cancel().catch(() => {})
      return {}
    }
    const sizeBytes = declaredFileBytes(res)
    reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let decodeAt = IMAGE_HEADER_FIRST_READ_BYTES
    for (;;) {
      const { done, value } = await reader.read()
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
      if (!done && total < decodeAt) continue
      const size = await imageDimensionsOf(Buffer.concat(chunks, Math.min(total, IMAGE_HEADER_MAX_READ_BYTES)))
      if (size || done || total >= IMAGE_HEADER_MAX_READ_BYTES) {
        // A server that ignored the range and ended within it sent the whole file.
        const whole = sizeBytes ?? (done && res.status === 200 ? total : undefined)
        return { ...(size ? { size } : {}), ...(whole !== undefined ? { sizeBytes: whole } : {}) }
      }
      decodeAt = IMAGE_HEADER_MAX_READ_BYTES
    }
  } catch {
    return {}
  } finally {
    void reader?.cancel().catch(() => {})
  }
}

/** The pixel size and byte size of the image at `url` (see the module doc). */
export async function probeImageSource(url: string): Promise<ImageSourceProbe> {
  const deadline = new AbortController()
  const timer = setTimeout(
    () => deadline.abort(new DOMException("image source probe: deadline passed", "TimeoutError")),
    IMAGE_SOURCE_PROBE_DEADLINE_MS,
  )
  const deadlinePassed = new Promise<ImageSourceProbe>((resolve) => {
    deadline.signal.addEventListener("abort", () => resolve({}), { once: true })
  })
  try {
    return await Promise.race([readProbe(url, deadline.signal), deadlinePassed])
  } finally {
    clearTimeout(timer)
    if (!deadline.signal.aborted) deadline.abort()
  }
}
