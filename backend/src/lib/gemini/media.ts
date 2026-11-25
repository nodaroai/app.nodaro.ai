/**
 * Gemini direct-lane media resolution — URL → `Part`.
 *
 * WHY THIS EXISTS: the KIE chat-completions lane smuggles media to Gemini as
 * an `image_url` whose URL *KIE* dereferences server-side. That is the only
 * reason every `LlmContentBlock` in this codebase can be a bare URL. Google's
 * own API has no equivalent affordance — a `Part` may carry inline base64
 * bytes, a Files API URI, a Cloud Storage URI, or a YouTube link, and nothing
 * else. An R2 URL passed straight to `generateContent` is not a supported
 * input and is silently useless.
 *
 * So this module is the bridge: URL → bytes → either `inlineData` for small
 * assets or a Files API upload for large ones. The bytes come through
 * `downloadFile` (`providers/video/ffmpeg-utils.ts`): one of OUR stored files
 * is read straight from storage, never back through the public host (a
 * freshly written object can arrive from the edge at a few kB/s); any other
 * link over the SSRF-safe fetch, under the shared default limits (the
 * response within 120 s, then a body that keeps moving gets its announced
 * size at a floor rate, up to a ceiling) instead of one flat 120 s.
 *
 * One block needs no bridge because it never had a URL: `video_base64` carries
 * the exact clip inline, for callers that must analyse bytes they already hold
 * rather than publish them behind a URL whose content can change under the
 * request. It is validated here — exact media type, canonical base64, MP4
 * `ftyp` magic, and the same {@link INLINE_MAX_BYTES} raw ceiling used for
 * inlining a fetched asset — and then passed through untouched.
 *
 * Sizing rule: Google directs callers to the Files API once the TOTAL request
 * clears ~20 MB, and base64 inflates bytes by 4/3. {@link INLINE_MAX_BYTES} is
 * set well under that so several inline images can coexist with the prompt in
 * one request without anyone having to reason about the aggregate.
 */

// @reads-none reads back only the media it downloads into its own temp folder
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { GoogleGenAI, Part } from "@google/genai"
import type { DownloadSource } from "../../providers/video/ffmpeg-utils.js"
import type { LlmContentBlock } from "../llm-client.js"
import { LLM_ROUTE_REQUEST_TIMEOUT_MS } from "../llm-route-timeout.js"
import { FILE_LANE_ERROR } from "../llm/message-builders.js"
import { LLM_VIDEO_FPS_MAX } from "../llm/types.js"

/** Raw-bytes ceiling for inlining rather than uploading. See module docstring. */
const INLINE_MAX_BYTES = 6 * 1024 * 1024

/**
 * The most raw bytes ONE request carries inline in all (decided 2026-11-17):
 * 12 MiB, about 16 million characters once base64 inflates them, under the
 * ~20 MB a request may total. A caller that passes a budget
 * (`GeminiPartOptions.inlineBudget`, the LLM client does) has each part past
 * what is left sent through the Files API instead, so a request that mixes
 * documents with inlined images, audio and video stays under the limit.
 */
export const INLINE_REQUEST_MAX_BYTES = 12 * 1024 * 1024

/** Refuse absurd inputs rather than streaming them to disk indefinitely: the
 *  download stops at this many bytes (at the headers, when it announces more). */
const MAX_MEDIA_BYTES = 512 * 1024 * 1024

/**
 * The most ONE media fetch may take (the default path's size-scaled rule,
 * under this ceiling): 8 min, two under the synchronous LLM routes' 10-min
 * socket idle timeout (`LLM_ROUTE_REQUEST_TIMEOUT_MS`), so a fetch always ends
 * on its own limit, with its "Download timeout" words, before the route can
 * cut the request with no message.
 */
export const MEDIA_FETCH_CEILING_MS = LLM_ROUTE_REQUEST_TIMEOUT_MS - 2 * 60_000

/** Google's documented ceiling for `VideoMetadata.fps`. */
const MAX_SAMPLING_FPS = LLM_VIDEO_FPS_MAX

/** The ONLY container accepted as inline video bytes — exact, not a family. */
const INLINE_VIDEO_MEDIA_TYPE = "video/mp4"

/**
 * Pre-decode allocation guard for `video_base64` — NOT the bound. The bound is
 * {@link INLINE_MAX_BYTES} of RAW bytes, checked on the decoded buffer; this
 * only stops an absurd string from being decoded at all.
 *
 * Base64 is 4 chars per 3 bytes, so one quantum of slack is added deliberately:
 * without it this guard would be exactly as tight as the raw limit and would
 * pre-empt it for every input, leaving the authoritative check unreachable and
 * the real rule stated in the wrong unit.
 */
const INLINE_VIDEO_MAX_BASE64_CHARS = Math.ceil(INLINE_MAX_BYTES / 3) * 4 + 4

/** Files API retention is 48h; expire our handles well inside it. */
const FILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const FILE_CACHE_MAX_ENTRIES = 256

/** Upload → ACTIVE polling. Video transcode dominates; images are ~instant. */
const ACTIVE_POLL_TIMEOUT_MS = 300_000
const ACTIVE_POLL_INTERVAL_MS = 2_000

interface CachedFile {
  fileUri: string
  mimeType: string
  cachedAt: number
}

/**
 * URL → uploaded-file handle. Re-uploading the same 60 MB clip for every
 * window of a video-analysis run would dominate both wall-clock and the
 * project's 20 GB Files quota, so handles are reused within their TTL.
 *
 * Process-local by design: worker processes each keep their own: a miss costs
 * one upload, never a correctness problem.
 */
const fileCache = new Map<string, CachedFile>()

function cacheGet(url: string): CachedFile | undefined {
  const hit = fileCache.get(url)
  if (!hit) return undefined
  if (Date.now() - hit.cachedAt > FILE_CACHE_TTL_MS) {
    fileCache.delete(url)
    return undefined
  }
  return hit
}

function cacheSet(url: string, entry: CachedFile): void {
  // Map preserves insertion order — the first key is the oldest.
  if (fileCache.size >= FILE_CACHE_MAX_ENTRIES) {
    const oldest = fileCache.keys().next()
    if (!oldest.done) fileCache.delete(oldest.value)
  }
  fileCache.set(url, entry)
}

/** Test seam — the cache is process-global, so suites must be able to reset it. */
export function __resetGeminiFileCache(): void {
  fileCache.clear()
}

const EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic",
}

/** Fallback per block kind when neither the caller nor the server states a type. */
const DEFAULT_MIME: Record<"image" | "video" | "audio", string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mpeg",
}

/**
 * Resolve the MIME type, most-authoritative source first: what the caller
 * declared, then what the server served, then the URL's extension, then a
 * per-kind default. Gemini keys its decoder off this, so a wrong value fails
 * the whole request — never guess `application/octet-stream`.
 */
function resolveMimeType(
  kind: "image" | "video" | "audio",
  declared: string | undefined,
  headerValue: string | null,
  url: string,
): string {
  if (declared) return declared
  const fromHeader = headerValue?.split(";")[0]?.trim()
  if (fromHeader && fromHeader !== "application/octet-stream" && fromHeader !== "binary/octet-stream") {
    return fromHeader
  }
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase()
  return (ext && EXTENSION_MIME[ext]) || DEFAULT_MIME[kind]
}

/** YouTube links are a first-class Gemini input — pass the URL through untouched. */
function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be"
  } catch {
    return false
  }
}

/**
 * Wait for an uploaded file to leave PROCESSING. Video is transcoded server
 * side and referencing it too early fails the generate call, so this is not
 * optional for the media types that matter most here.
 */
async function waitUntilActive(ai: GoogleGenAI, name: string, mimeType: string): Promise<void> {
  const deadline = Date.now() + ACTIVE_POLL_TIMEOUT_MS
  for (;;) {
    const file = await ai.files.get({ name })
    if (file.state === "ACTIVE") return
    if (file.state === "FAILED") {
      throw new Error(`Gemini Files API: processing failed for ${mimeType} upload (${name})`)
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Gemini Files API: ${mimeType} upload ${name} still ${file.state} after ${ACTIVE_POLL_TIMEOUT_MS / 1000}s`,
      )
    }
    await new Promise((r) => setTimeout(r, ACTIVE_POLL_INTERVAL_MS))
  }
}

/** Upload a file we hold by PATH, wait until it is usable, and cache its handle under `url`. */
async function uploadFile(ai: GoogleGenAI, localPath: string, url: string, mimeType: string): Promise<Part> {
  const uploaded = await ai.files.upload({ file: localPath, config: { mimeType } })
  if (!uploaded.name || !uploaded.uri) {
    throw new Error(`Gemini Files API: upload returned no name/uri for ${url}`)
  }
  await waitUntilActive(ai, uploaded.name, mimeType)
  cacheSet(url, { fileUri: uploaded.uri, mimeType, cachedAt: Date.now() })
  return { fileData: { fileUri: uploaded.uri, mimeType } }
}

/**
 * A downloader's failure in this module's words: a refused response as
 * "fetch failed (<status>)", a body over the cap as "too large", a timeout in
 * its own `Download timeout:` words naming its limit (without the link — this
 * lane's timeouts never carried one), and anything else as is.
 */
function mediaFetchError(err: unknown, block: { type: string; url: string }, isByteCap: (err: unknown) => boolean): unknown {
  if (isByteCap(err)) return new Error(`Gemini media too large: over ${MAX_MEDIA_BYTES} bytes (${block.url})`)
  const status = err instanceof Error ? /^Failed to download: .* \((\d{3})\)$/.exec(err.message)?.[1] : undefined
  if (status) return new Error(`Gemini media fetch failed (${status}) for ${block.type}: ${block.url}`)
  const linkSuffix = `: ${block.url}`
  if (err instanceof Error && err.message.startsWith("Download timeout:") && err.message.endsWith(linkSuffix)) {
    return Object.assign(new Error(err.message.slice(0, -linkSuffix.length)), { name: err.name })
  }
  return err
}

/**
 * Turn one {@link LlmContentBlock} into a Gemini `Part`.
 *
 * Text and already-base64 blocks are pure transforms. URL-bearing blocks are
 * dereferenced here — see the module docstring for why that is unavoidable on
 * this lane.
 *
 * Split in two on purpose. {@link resolveBlockPart} decides WHERE the bytes come
 * from and has four separate `return` sites for a video (YouTube passthrough,
 * cache hit, inline, Files API upload); this wrapper is the ONE place per-part
 * metadata is attached. Attaching it inside would mean four edits today and a
 * silent drop the day a fifth source is added.
 */
export async function blockToGeminiPart(ai: GoogleGenAI, block: LlmContentBlock, opts: GeminiPartOptions = {}): Promise<Part> {
  const part = await resolveBlockPart(ai, block, opts)
  // `videoMetadata` is a sibling of inlineData/fileData ON THE PART. Nesting it
  // inside either one is rejected outright by the SDK's own types and is the
  // entire content of google-gemini/cookbook#787.
  if ((block.type === "video" || block.type === "video_base64") && block.fps !== undefined) {
    assertSamplingRate(block.fps)
    return { ...part, videoMetadata: { fps: block.fps } }
  }
  return part
}

/** `VideoMetadata.fps`: "the default value is 1.0. The valid range is (0.0, 24.0]"
 *  (@google/genai 2.13.0). Out of range is a 400 from Google after the whole clip
 *  has already been uploaded, so it is worth catching before the round-trip. */
function assertSamplingRate(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_SAMPLING_FPS) {
    throw new Error(`Gemini video fps must be in (0, ${MAX_SAMPLING_FPS}]; got ${fps}`)
  }
}

/**
 * Validate inline video bytes before they can reach Google.
 *
 * Everything here is a bound or an exactness check, and all of it runs while
 * the request is still being BUILT — `buildContents` is upstream of
 * `generateContent`, so a bad payload costs one throw, not a provider round
 * trip, a billed prompt, or a metered usage row.
 *
 * The four checks are four different lies a caller can tell:
 *  - **media type** — Gemini keys its decoder off the declared type. Accepting
 *    a family (`video/*`) or a near-miss (`video/mpeg`) hands the wrong decoder
 *    real bytes; the failure is a 400 at best and a misread clip at worst.
 *  - **canonical base64** — Node's decoder is lenient: it silently skips
 *    whitespace, tolerates a `data:` prefix's tail and accepts non-canonical
 *    padding, so `Buffer.from(...)` "succeeding" proves nothing. Round-tripping
 *    the encode is the only check that the string on the wire is exactly the
 *    bytes we validated.
 *  - **`ftyp` magic** — bytes 4..8 of an ISO-BMFF file. Without it any base64
 *    blob (a JPEG, a JSON dump, a truncated download) passes as "a video" and
 *    the model answers about nothing.
 *  - **size** — the raw ceiling, checked on the decoded length. Base64 inflates
 *    4/3 on the wire, and {@link INLINE_MAX_BYTES} is already set well under
 *    Google's ~20 MB request limit for exactly that reason.
 */
function assertInlineVideoBytes(block: { mediaType: string; data: string }): void {
  if (block.mediaType !== INLINE_VIDEO_MEDIA_TYPE) {
    throw new Error(
      `Gemini inline video: mediaType must be exactly "${INLINE_VIDEO_MEDIA_TYPE}"; got "${block.mediaType}"`,
    )
  }
  const data = block.data
  if (!data) throw new Error("Gemini inline video: data is empty")
  if (data.length > INLINE_VIDEO_MAX_BASE64_CHARS) {
    throw new Error(
      `Gemini inline video: base64 payload is ${data.length} chars, past the ${INLINE_VIDEO_MAX_BASE64_CHARS} it ` +
        `would take to encode the ${INLINE_MAX_BYTES}-byte raw limit — use a video URL block (Files API) instead`,
    )
  }
  const bytes = Buffer.from(data, "base64")
  if (bytes.toString("base64") !== data) {
    throw new Error(
      "Gemini inline video: data is not canonical base64 (no whitespace, no data: prefix, no URL-safe alphabet)",
    )
  }
  if (bytes.length > INLINE_MAX_BYTES) {
    throw new Error(
      `Gemini inline video: ${bytes.length} raw bytes exceeds the ${INLINE_MAX_BYTES}-byte inline limit — ` +
        "use a video URL block (Files API) for larger clips",
    )
  }
  // ISO base media file format: a 4-byte box size, then the 'ftyp' box type.
  if (bytes.length < 12 || bytes.toString("latin1", 4, 8) !== "ftyp") {
    throw new Error("Gemini inline video: data is not an MP4 (no 'ftyp' box at offset 4)")
  }
}

/** What the model being called lets a part carry. */
export interface GeminiPartOptions {
  /**
   * The model reads a document as an inline part on this lane
   * (`LlmModelDef.fileWire.direct === "inline-data"`). Absent, a document
   * throws.
   */
  inlineFiles?: boolean
  /**
   * The raw bytes the request may still carry inline, shared by every part
   * of every message and counted down as parts are built
   * ({@link INLINE_REQUEST_MAX_BYTES}). A fetched asset or a document that
   * does not fit what is left goes through the Files API. Absent: each part
   * is judged on its own, as before.
   */
  inlineBudget?: { left: number }
}

/** Raw bytes of canonical base64 `data`. */
function base64Bytes(data: string): number {
  return Math.floor((data.length * 3) / 4)
}

/** Count `bytes` against the request's inline budget, when it has one. */
function spendInline(opts: GeminiPartOptions, bytes: number): void {
  if (opts.inlineBudget) opts.inlineBudget.left -= bytes
}

/** Upload bytes we already hold through the Files API (a temp file, uploaded by path). */
async function uploadBytes(ai: GoogleGenAI, bytes: Buffer, mimeType: string, label: string): Promise<Part> {
  const workDir = join(tmpdir(), `gemini-upload-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, "media")
  try {
    await writeFile(localPath, bytes)
    const uploaded = await ai.files.upload({ file: localPath, config: { mimeType } })
    if (!uploaded.name || !uploaded.uri) throw new Error(`Gemini Files API: upload returned no name/uri for ${label}`)
    await waitUntilActive(ai, uploaded.name, mimeType)
    return { fileData: { fileUri: uploaded.uri, mimeType } }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function resolveBlockPart(ai: GoogleGenAI, block: LlmContentBlock, opts: GeminiPartOptions): Promise<Part> {
  if (block.type === "text") return { text: block.text }
  if (block.type === "image_base64") {
    spendInline(opts, base64Bytes(block.data))
    return { inlineData: { mimeType: block.mediaType, data: block.data } }
  }
  // Inline video bytes: validated, then passed through VERBATIM. Re-encoding
  // would defeat the point of the block — the caller is asking about one exact,
  // immutable payload, and the bytes it handed us are that payload's identity.
  if (block.type === "video_base64") {
    assertInlineVideoBytes(block)
    spendInline(opts, base64Bytes(block.data))
    return { inlineData: { mimeType: block.mediaType, data: block.data } }
  }
  // A document: its bytes inline as an `application/pdf` part, for a model
  // that declares that shape on this lane (decided 2026-11-17). The bytes are
  // the ones the route fetched, checked and counted (`lib/llm-files.ts`); a
  // call's documents total at most 6 MiB. Read correctly this way 2026-11-17
  // (5, 14 and 15 pages, up to 2.2 MB). A document that does not fit what the
  // request may still carry inline (`inlineBudget`: a request that also
  // inlines large images, audio or video) is uploaded through the Files API
  // instead, never dropped. A stored link (`hostedUrl`) is for the aggregator
  // and is never sent here. On a model that declares no such shape a document
  // is a call site that skipped the routes' check: refused, never dropped.
  if (block.type === "file_base64") {
    if (!opts.inlineFiles) throw new Error(FILE_LANE_ERROR("direct Gemini"))
    const bytes = base64Bytes(block.data)
    if (opts.inlineBudget && bytes > opts.inlineBudget.left) {
      return uploadBytes(ai, Buffer.from(block.data, "base64"), block.mediaType, block.filename)
    }
    spendInline(opts, bytes)
    return { inlineData: { mimeType: block.mediaType, data: block.data } }
  }

  const declared = block.type === "image" ? undefined : block.mimeType

  // YouTube is a native input — never download it (and we could not legally
  // re-host it anyway).
  if (block.type === "video" && isYouTubeUrl(block.url)) {
    return { fileData: { fileUri: block.url } }
  }

  const cached = cacheGet(block.url)
  if (cached) return { fileData: { fileUri: cached.fileUri, mimeType: cached.mimeType } }

  return fetchToPart(ai, block, declared, opts)
}

/**
 * Download a URL block's bytes to a temp file (`downloadFile`: our own stored
 * file from storage, any other link over HTTP; capped at
 * {@link MAX_MEDIA_BYTES}), then send them inline or through the Files API.
 * The choice is made as the headers would make it: inline when the source
 * announced a length within {@link INLINE_MAX_BYTES} and what the request may
 * still carry inline; an unknown or larger one is uploaded by path, never held
 * in the heap — a 600 s video-analysis input can be hundreds of MB. The
 * download's limits stop with it: the upload and its processing wait are not
 * the download's. The temp folder is removed on every way out, and a failed
 * fetch throws — never a dropped reference.
 */
async function fetchToPart(
  ai: GoogleGenAI,
  block: { type: "image" | "video" | "audio"; url: string },
  declared: string | undefined,
  opts: GeminiPartOptions,
): Promise<Part> {
  const workDir = join(tmpdir(), `gemini-upload-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, "media")
  try {
    // Loaded on use, as `clip-measure.ts` does: the LLM lane does not load the ffmpeg runtime until it fetches media.
    const { downloadFile, isDownloadByteCapError } = await import("../../providers/video/ffmpeg-utils.js")
    let source: DownloadSource = {}
    try {
      await downloadFile(block.url, localPath, { maxBytes: MAX_MEDIA_BYTES, ceilingMs: MEDIA_FETCH_CEILING_MS, onSource: (s) => { source = s } })
    } catch (err) {
      throw mediaFetchError(err, block, isDownloadByteCapError)
    }

    const mimeType = resolveMimeType(block.type, declared, source.contentType ?? null, block.url)
    const declaredLength = source.contentLength ?? Number.NaN

    // Small and self-declared: inline it and skip the upload round-trip entirely.
    if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength <= INLINE_MAX_BYTES && (!opts.inlineBudget || declaredLength <= opts.inlineBudget.left)) {
      const bytes = await readFile(localPath)
      spendInline(opts, bytes.length)
      return { inlineData: { mimeType, data: bytes.toString("base64") } }
    }

    // Unknown or large: upload by path.
    const { size } = await stat(localPath)
    if (size > MAX_MEDIA_BYTES) {
      throw new Error(`Gemini media too large: ${size} bytes exceeds ${MAX_MEDIA_BYTES} (${block.url})`)
    }
    return await uploadFile(ai, localPath, block.url, mimeType)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Resolve a whole message's content. Sequential by design: a fan-out here would
 *  race several hundred-MB downloads against each other inside one worker. */
export async function blocksToGeminiParts(
  ai: GoogleGenAI,
  content: string | LlmContentBlock[],
  opts: GeminiPartOptions = {},
): Promise<Part[]> {
  if (typeof content === "string") return [{ text: content }]
  const parts: Part[] = []
  for (const block of content) parts.push(await blockToGeminiPart(ai, block, opts))
  return parts
}
