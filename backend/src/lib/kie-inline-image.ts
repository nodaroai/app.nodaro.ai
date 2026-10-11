/**
 * Every image KIE's OpenAI-shaped lanes (chat-completions, responses) receive
 * travels INLINE, as a `data:` URL — never as an image URL for KIE to fetch.
 *
 * Why never a URL: on 2026-10-09 KIE's chat-completions lane answered every
 * image sent as a URL with `code 500: Network error, please try again later.`
 * — 8 of 8 requests for public photo-host images, and our own CDN's URL the
 * same way — while the same images sent inline were read normally. A URL
 * there buys a failure and a fallback to another lane, not an answer.
 *
 * Why resized when large: KIE also refuses an inline data URL past a size it
 * does not document ("Inline data URL is too large. Upload the file and pass
 * an HTTP(S) URL instead."), and a request has a total size too. So each image
 * gets an allowance — {@link KIE_INLINE_DATA_URL_MAX_CHARS}, shrunk to an even
 * share of {@link KIE_INLINE_REQUEST_BUDGET_CHARS} when a request carries many
 * images — and is re-encoded smaller until it fits.
 *
 * Bounded memory: a request may carry hundreds of images (a reduce over its
 * candidates puts one image block per candidate in one message), so they are
 * downloaded, decoded and re-encoded through a pool of
 * {@link KIE_INLINE_CONCURRENCY}, never all at once.
 *
 * This runs ONLY on the way into those two KIE formats (`callKie` /
 * `streamKie` in llm-client.ts), and its result is memoised per block, so a
 * structured call's validation retries reuse it instead of fetching again.
 * Every other lane keeps the blocks it was given: the Anthropic lanes send
 * their bytes verbatim (their own 5 MB cap is what `prefetchAsBase64` sizes
 * for) and the direct Gemini lane inlines or uploads them itself.
 */
import sharp from "sharp"
import { safeFetchBytes, PublicDownloadTooLargeError } from "./safe-fetch-bytes.js"
import { LlmLaneError } from "./llm-errors.js"
import type { LlmContentBlock, LlmRequest } from "./llm-client.js"

type ImageBase64Block = Extract<LlmContentBlock, { type: "image_base64" }>
type ImageBlock = Extract<LlmContentBlock, { type: "image" }>

/**
 * The longest `data:` URL sent to KIE's OpenAI-shaped lanes for one image; an
 * image past it is re-encoded smaller.
 *
 * KIE does not document its inline limit: the model pages
 * (docs.kie.ai/market/gemini/gemini-3-8-flash-openai.md and its siblings)
 * describe only the `image_url` shape. The one observation is a refusal of a
 * 2,676,538-character data URL (a 2 MB PNG) on 2026-10-08. That bounds the
 * limit from above and says nothing about how far below it the limit sits, or
 * whether it holds still, so this stays well under it: about 56% of the
 * refused size, roughly 1.1 MB of image.
 */
export const KIE_INLINE_DATA_URL_MAX_CHARS = 1_500_000

/**
 * The most data-URL characters one request carries across ALL its images.
 * Each image's allowance is the smaller of the per-image cap and an even share
 * of this, so a request's images never add up past it. Ten million characters
 * is about half of the roughly 20 MB an inline Gemini request may total,
 * leaving room for the prompt and the JSON around it.
 */
export const KIE_INLINE_REQUEST_BUDGET_CHARS = 10_000_000

/**
 * How many images one request downloads, decodes and re-encodes at a time.
 * The direct Gemini lane works through its media one at a time
 * (lib/gemini/media.ts); three keeps a many-image request's memory bounded
 * without serialising the usual two or three images.
 */
export const KIE_INLINE_CONCURRENCY = 3

/** What the person reads when an image URL could not be downloaded. */
export const KIE_IMAGE_FETCH_FAILED_MESSAGE =
  "The image could not be downloaded. Check that its link is public and still works, then try again."

/** What the person reads when an image's bytes are not a readable image. It
 *  names only formats this path can decode: the image library this server
 *  ships reads a HEIC's header but cannot decode it. */
export const KIE_IMAGE_UNREADABLE_MESSAGE =
  "The image could not be read (unsupported or corrupt file). Use a PNG, JPEG, WebP or AVIF image."

/** What the person reads when one image is past the byte cap — downloaded or
 *  carried in a `data:` URL. */
export const KIE_IMAGE_TOO_LARGE_MESSAGE =
  "The image is too large to send. Use an image under 25 MB."

/** What the person reads when a request's images cannot all fit, even small. */
export const KIE_IMAGES_OVER_BUDGET_MESSAGE =
  "Too many images to send in one request. Try again with fewer or smaller images."

/**
 * Re-encode steps, tried in order until the data URL fits: JPEG at the
 * native long edge first (1568 px, where the prefetch also caps), then less
 * quality, then smaller. The 512 px step is the floor; an image that does not
 * fit its allowance even there is refused.
 */
const KIE_INLINE_STEPS: ReadonlyArray<{ longEdge: number; quality: number }> = [
  { longEdge: 1568, quality: 90 },
  { longEdge: 1568, quality: 80 },
  { longEdge: 1280, quality: 75 },
  { longEdge: 1024, quality: 70 },
  { longEdge: 768, quality: 65 },
  { longEdge: 512, quality: 60 },
]

/** The most one image may weigh before it is refused — downloaded, or decoded from a `data:` URL. */
const KIE_INLINE_FETCH_MAX_BYTES = 25 * 1024 * 1024

/** The formats kept verbatim when they fit — what every vision lane reads. Keyed by the format sharp reads from the bytes. */
const VERBATIM_FORMATS: Readonly<Record<string, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
}

/** Length of the `data:` URL these bytes become — what KIE's limit applies to. */
function dataUrlLength(mediaType: string, base64: string): number {
  return "data:".length + mediaType.length + ";base64,".length + base64.length
}

function laneError(message: string, userMessage: string, cause?: unknown): LlmLaneError {
  const err = new LlmLaneError(`KIE inline image: ${message}`, { lane: "kie", userMessage })
  if (cause !== undefined) err.cause = cause
  return err
}

/** The format sharp reads from the bytes, or a lane error when they are not an image. */
async function formatOf(bytes: Buffer): Promise<string | undefined> {
  try {
    return (await sharp(bytes).metadata()).format
  } catch (err) {
    throw laneError("the image could not be decoded", KIE_IMAGE_UNREADABLE_MESSAGE, err)
  }
}

/**
 * Re-encode `bytes` to the first JPEG step whose data URL fits `maxChars`:
 * EXIF orientation applied, alpha flattened onto white (a transparent PNG
 * must not turn black), never enlarged.
 */
async function reencodeToFit(bytes: Buffer, maxChars: number): Promise<ImageBase64Block> {
  for (const { longEdge, quality } of KIE_INLINE_STEPS) {
    let jpeg: Buffer
    try {
      jpeg = await sharp(bytes)
        .rotate()
        .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality })
        .toBuffer()
    } catch (err) {
      throw laneError("the image could not be decoded", KIE_IMAGE_UNREADABLE_MESSAGE, err)
    }
    const data = jpeg.toString("base64")
    if (dataUrlLength("image/jpeg", data) <= maxChars) return { type: "image_base64", mediaType: "image/jpeg", data }
  }
  throw laneError(
    `the image does not fit its ${maxChars}-character allowance even at the smallest re-encode`,
    KIE_IMAGES_OVER_BUDGET_MESSAGE,
  )
}

/**
 * Bytes as a block that fits `maxChars`: verbatim, typed from the bytes, when
 * they are a JPEG/PNG/GIF/WebP whose data URL fits; a JPEG re-encode
 * otherwise. `given` is the block these bytes came from, returned as is when
 * nothing about it needs to change.
 */
async function fitBytes(bytes: Buffer, maxChars: number, given?: ImageBase64Block): Promise<ImageBase64Block> {
  const format = await formatOf(bytes)
  const mediaType = format ? VERBATIM_FORMATS[format] : undefined
  if (mediaType) {
    const data = given?.data ?? bytes.toString("base64")
    if (dataUrlLength(mediaType, data) <= maxChars) {
      return given && given.mediaType === mediaType ? given : { type: "image_base64", mediaType, data }
    }
  }
  return reencodeToFit(bytes, maxChars)
}

/**
 * An `image_base64` block as KIE's OpenAI-shaped lanes may carry it, read from
 * its own bytes (a producer may have copied a response's Content-Type
 * verbatim — `application/octet-stream`, `image/avif`): the same block when it
 * is a JPEG/PNG/GIF/WebP that fits `maxChars`, the same bytes under their real
 * type when only the declared type was wrong, a JPEG re-encode otherwise. Never
 * a second fetch.
 */
export async function fitImageForKieInline(
  block: ImageBase64Block,
  maxChars: number = KIE_INLINE_DATA_URL_MAX_CHARS,
): Promise<ImageBase64Block> {
  return fitBytes(Buffer.from(block.data, "base64"), maxChars, block)
}

/**
 * The bytes of a `data:` URL, decoded here — never fetched. Only a base64
 * `image/*` payload within the byte cap is accepted; its declared type is
 * checked to be an image, and the real format is then read from the bytes.
 */
function decodeDataUrl(url: string): Buffer {
  const comma = url.indexOf(",")
  const params = comma === -1 ? [] : url.slice("data:".length, comma).toLowerCase().split(";")
  if (!params[0]?.startsWith("image/") || !params.includes("base64")) {
    throw laneError("a data: URL that is not a base64 image", KIE_IMAGE_UNREADABLE_MESSAGE)
  }
  const payload = url.slice(comma + 1)
  if (payload.length > Math.ceil(KIE_INLINE_FETCH_MAX_BYTES / 3) * 4) {
    throw laneError(`a data: URL past the ${KIE_INLINE_FETCH_MAX_BYTES}-byte cap`, KIE_IMAGE_TOO_LARGE_MESSAGE)
  }
  return Buffer.from(payload, "base64")
}

/**
 * An image URL as a block KIE can carry inline. A `data:` URL is decoded
 * locally; any other URL is downloaded once (SSRF-guarded, byte-capped, under
 * the caller's `signal`). Either way the format is read from the bytes and the
 * image fitted to `maxChars` as {@link fitImageForKieInline} does.
 */
export async function fetchImageForKieInline(
  url: string,
  maxChars: number = KIE_INLINE_DATA_URL_MAX_CHARS,
  signal?: AbortSignal,
): Promise<ImageBase64Block> {
  if (/^data:/i.test(url)) return fitBytes(decodeDataUrl(url), maxChars)
  let bytes: Buffer
  try {
    bytes = await safeFetchBytes(url, KIE_INLINE_FETCH_MAX_BYTES, signal)
  } catch (err) {
    if (err instanceof PublicDownloadTooLargeError) {
      throw laneError(`an image from ${hostOf(url)} is past the ${KIE_INLINE_FETCH_MAX_BYTES}-byte cap`, KIE_IMAGE_TOO_LARGE_MESSAGE, err)
    }
    throw laneError(`could not fetch an image from ${hostOf(url)} to send inline`, KIE_IMAGE_FETCH_FAILED_MESSAGE, err)
  }
  return fitBytes(bytes, maxChars)
}

/** The host alone — enough to diagnose, without a signed URL's query in a log line. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "an unparseable URL"
  }
}

/**
 * Each image block's inline result, per allowance, for as long as the block
 * itself lives. A structured call re-asks with the SAME block objects (its
 * correction turn only appends messages), so its retries reuse this instead
 * of downloading and re-encoding again. A failure is dropped, never reused.
 */
const inlinedBlocks = new WeakMap<object, Map<number, Promise<ImageBase64Block>>>()

function inlineOnce(block: ImageBlock | ImageBase64Block, allowance: number, signal?: AbortSignal): Promise<ImageBase64Block> {
  let byAllowance = inlinedBlocks.get(block)
  if (!byAllowance) {
    byAllowance = new Map()
    inlinedBlocks.set(block, byAllowance)
  }
  const done = byAllowance.get(allowance)
  if (done) return done
  const work = block.type === "image" ? fetchImageForKieInline(block.url, allowance, signal) : fitImageForKieInline(block, allowance)
  const entries = byAllowance
  entries.set(allowance, work)
  work.catch(() => entries.delete(allowance))
  return work
}

/** `fn` over `items`, at most `limit` at a time; the first failure stops new work. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      signal?.throwIfAborted()
      const index = next++
      try {
        results[index] = await fn(items[index] as T)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export interface KieInlineOptions {
  /** Total data-URL characters for the request's images. Defaults to {@link KIE_INLINE_REQUEST_BUDGET_CHARS}. */
  budgetChars?: number
  /** Aborts the downloads (a streamed call passes its own). */
  signal?: AbortSignal
}

/**
 * `req` with every image block ready for KIE's OpenAI-shaped lanes: each
 * `image` URL downloaded (or decoded, for a `data:` URL) and inlined, each
 * `image_base64` read from its bytes and fitted, every one within its
 * allowance — the per-image cap, or an even share of the request budget when
 * that is smaller. Text, video and audio blocks pass through untouched; a
 * request with no image comes back as the same object.
 *
 * Throws a KIE `LlmLaneError` carrying a sentence the person can read when an
 * image cannot be downloaded or decoded, or cannot fit its allowance even at
 * the 512 px floor — so a caller with another lane can serve the request from
 * it, and a caller without one says what is actually wrong.
 */
export async function inlineImagesForKie(req: LlmRequest, opts: KieInlineOptions = {}): Promise<LlmRequest> {
  const slots: Array<{ message: number; index: number; block: ImageBlock | ImageBase64Block }> = []
  req.messages.forEach((m, message) => {
    if (typeof m.content === "string") return
    m.content.forEach((block, index) => {
      if (block.type === "image" || block.type === "image_base64") slots.push({ message, index, block })
    })
  })
  if (slots.length === 0) return req

  const budget = opts.budgetChars ?? KIE_INLINE_REQUEST_BUDGET_CHARS
  const allowance = Math.min(KIE_INLINE_DATA_URL_MAX_CHARS, Math.floor(budget / slots.length))
  const inlined = await mapWithConcurrency(slots, KIE_INLINE_CONCURRENCY, (slot) => inlineOnce(slot.block, allowance, opts.signal), opts.signal)

  const replacements = new Map<string, ImageBase64Block>()
  slots.forEach((slot, i) => replacements.set(`${slot.message}:${slot.index}`, inlined[i] as ImageBase64Block))
  const messages = req.messages.map((m, message) => {
    if (typeof m.content === "string") return m
    if (!m.content.some((_, index) => replacements.has(`${message}:${index}`))) return m
    return { ...m, content: m.content.map((block, index) => replacements.get(`${message}:${index}`) ?? block) }
  })
  return { ...req, messages }
}
