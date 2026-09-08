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
 * So this module is the bridge: URL → bytes (SSRF-safe) → either `inlineData`
 * for small assets or a Files API upload for large ones.
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

import { createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { GoogleGenAI, Part } from "@google/genai"
import { safeFetch } from "../safe-fetch.js"
import type { LlmContentBlock } from "../llm-client.js"

/** Raw-bytes ceiling for inlining rather than uploading. See module docstring. */
const INLINE_MAX_BYTES = 6 * 1024 * 1024

/** Refuse absurd inputs rather than streaming them to disk indefinitely. */
const MAX_MEDIA_BYTES = 512 * 1024 * 1024

/** Download budget. Long videos on a cold R2 edge are genuinely slow. */
const FETCH_TIMEOUT_MS = 120_000

/** Google's documented ceiling for `VideoMetadata.fps`. */
const MAX_SAMPLING_FPS = 24

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

/**
 * Stream the response body to a temp file and upload by PATH rather than
 * buffering. A 600 s video-analysis input can be hundreds of MB; holding that
 * in a worker's heap alongside ffmpeg is how you OOM a container.
 */
async function uploadViaTempFile(
  ai: GoogleGenAI,
  response: Response,
  url: string,
  mimeType: string,
): Promise<Part> {
  const workDir = join(tmpdir(), `gemini-upload-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, "media")
  try {
    if (!response.body) throw new Error(`Gemini media fetch returned no body: ${url}`)
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(localPath))

    const { size } = await stat(localPath)
    if (size > MAX_MEDIA_BYTES) {
      throw new Error(`Gemini media too large: ${size} bytes exceeds ${MAX_MEDIA_BYTES} (${url})`)
    }

    const uploaded = await ai.files.upload({ file: localPath, config: { mimeType } })
    if (!uploaded.name || !uploaded.uri) {
      throw new Error(`Gemini Files API: upload returned no name/uri for ${url}`)
    }
    await waitUntilActive(ai, uploaded.name, mimeType)

    cacheSet(url, { fileUri: uploaded.uri, mimeType, cachedAt: Date.now() })
    return { fileData: { fileUri: uploaded.uri, mimeType } }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
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
export async function blockToGeminiPart(ai: GoogleGenAI, block: LlmContentBlock): Promise<Part> {
  const part = await resolveBlockPart(ai, block)
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

async function resolveBlockPart(ai: GoogleGenAI, block: LlmContentBlock): Promise<Part> {
  if (block.type === "text") return { text: block.text }
  if (block.type === "image_base64") {
    return { inlineData: { mimeType: block.mediaType, data: block.data } }
  }
  // Inline video bytes: validated, then passed through VERBATIM. Re-encoding
  // would defeat the point of the block — the caller is asking about one exact,
  // immutable payload, and the bytes it handed us are that payload's identity.
  if (block.type === "video_base64") {
    assertInlineVideoBytes(block)
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

  const response = await safeFetch(block.url, { timeoutMs: FETCH_TIMEOUT_MS })
  if (!response.ok) {
    throw new Error(`Gemini media fetch failed (${response.status}) for ${block.type}: ${block.url}`)
  }

  const mimeType = resolveMimeType(block.type, declared, response.headers.get("content-type"), block.url)
  const declaredLength = Number(response.headers.get("content-length") ?? Number.NaN)

  // Small and self-declared: inline it and skip the upload round-trip entirely.
  if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength <= INLINE_MAX_BYTES) {
    const bytes = Buffer.from(await response.arrayBuffer())
    return { inlineData: { mimeType, data: bytes.toString("base64") } }
  }

  // Unknown or large: stream to disk, upload by path.
  return uploadViaTempFile(ai, response, block.url, mimeType)
}

/** Resolve a whole message's content. Sequential by design: a fan-out here would
 *  race several hundred-MB downloads against each other inside one worker. */
export async function blocksToGeminiParts(
  ai: GoogleGenAI,
  content: string | LlmContentBlock[],
): Promise<Part[]> {
  if (typeof content === "string") return [{ text: content }]
  const parts: Part[] = []
  for (const block of content) parts.push(await blockToGeminiPart(ai, block))
  return parts
}
