/**
 * Server-side asset materialization.
 *
 * When a user (or LLM) provides a media URL to a Nodaro generation route,
 * the underlying provider (KIE, Replicate, etc.) may not be able to fetch
 * it: domain not allowlisted, geo-blocked, slow, requires custom headers,
 * lossy CDN transform, etc. Rather than make the LLM jump through hoops to
 * pre-upload (the previous \`upload_image\`/\`upload_audio\`/\`upload_video\`
 * MCP tools), we transparently fetch the URL ourselves and re-host it on
 * our R2 bucket — providers always see a fast, allowlisted URL pointing at
 * the ORIGINAL bytes (no base64 round-trip → no quality loss).
 *
 * Idempotent: URLs already on cdn.nodaro.ai or our R2 bucket are passed
 * through unchanged.
 *
 * Auth-gated hosts (claude.ai/api/.../files/*, chatgpt.com/files/*) cannot
 * be fetched by us either; we surface a clear error so the LLM can suggest
 * uploading via Nodaro's web UI.
 */
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "./storage.js"
import { config } from "./config.js"
import { safeFetch } from "./safe-fetch.js"

export type MediaKind = "image" | "audio" | "video"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
}

const KIND_PREFIXES: Record<MediaKind, string> = {
  image: "image/",
  audio: "audio/",
  video: "video/",
}

const MAX_BYTES_BY_KIND: Record<MediaKind, number> = {
  image: 32 * 1024 * 1024, // 32 MB
  audio: 64 * 1024 * 1024, // 64 MB
  video: 256 * 1024 * 1024, // 256 MB
}

/**
 * Hostnames we know require auth that we don't have. Skip the fetch attempt
 * and surface a clear error so the caller's response message is useful.
 */
const AUTH_GATED_HOSTS = new Set([
  "claude.ai",
  "chatgpt.com",
  "files.oaiusercontent.com",
])

interface MaterializeOpts {
  /** Source URL the user / LLM provided. */
  url: string
  /** Owning user id — partitions the R2 key namespace. */
  userId: string
  /** Expected media kind. Used for content-type validation + size cap. */
  kind: MediaKind
}

interface MaterializeResult {
  /** Final URL the provider should fetch. Either the original (already on
   *  our CDN) or a freshly-uploaded R2 URL. */
  url: string
  /** Was the asset re-hosted? */
  rehosted: boolean
}

/**
 * Returns true if the URL is already hosted on our infrastructure and
 * passing through is safe.
 */
function isOwnedHost(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.hostname === "cdn.nodaro.ai" ||
      u.hostname === "assets.nodaro.ai" ||
      u.hostname.endsWith(".r2.cloudflarestorage.com") ||
      (config.R2_PUBLIC_URL.length > 0 && url.startsWith(config.R2_PUBLIC_URL))
    )
  } catch {
    return false
  }
}

function isAuthGated(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return AUTH_GATED_HOSTS.has(host) || host.endsWith(".claude.ai")
  } catch {
    return false
  }
}

export async function materializeAsset(opts: MaterializeOpts): Promise<MaterializeResult> {
  const { url, userId, kind } = opts

  if (isOwnedHost(url)) {
    return { url, rehosted: false }
  }
  if (isAuthGated(url)) {
    throw new Error(
      `Asset URL ${url} requires the host's user-auth to fetch. Ask the user ` +
        "to download the file and re-upload it via app.nodaro.ai/library, then " +
        "reference it via the resulting library URL.",
    )
  }

  const res = await safeFetch(url, {
    method: "GET",
    redirect: "follow",
    // Some CDNs reject default Node fetch UA. Pretend to be a normal client.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Nodaro/1.0)" },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }

  const contentType = (res.headers.get("content-type") || "").split(";")[0]?.trim() || ""
  const expectedPrefix = KIND_PREFIXES[kind]
  if (!contentType.startsWith(expectedPrefix)) {
    throw new Error(
      `Asset at ${url} returned content-type "${contentType}" but expected ${kind}/*. ` +
        "If the URL is correct, the host may be returning HTML (auth wall, error page, etc.).",
    )
  }

  const arrayBuffer = await res.arrayBuffer()
  const bytes = Buffer.from(arrayBuffer)
  if (bytes.length === 0) {
    throw new Error(`Asset at ${url} responded with an empty body.`)
  }
  const max = MAX_BYTES_BY_KIND[kind]
  if (bytes.length > max) {
    throw new Error(
      `Asset at ${url} is ${bytes.length} bytes; over the ${max}-byte cap for ${kind} assets.`,
    )
  }

  const ext = MIME_TO_EXT[contentType] ?? (kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "mp4")
  const key = `uploads/${kind}/${userId}/materialized/${randomUUID()}.${ext}`
  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  return {
    url: `${config.R2_PUBLIC_URL}/${key}`,
    rehosted: true,
  }
}

/**
 * Convenience wrapper that materializes an optional URL — returns null if
 * the input is null/undefined/empty, throws on materialization failure.
 */
export async function materializeIfPresent(
  url: string | null | undefined,
  userId: string,
  kind: MediaKind,
): Promise<string | null> {
  if (!url) return null
  const { url: out } = await materializeAsset({ url, userId, kind })
  return out
}
