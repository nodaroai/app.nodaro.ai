/**
 * Upload tools — let the LLM bring user-provided media into Nodaro.
 *
 * Why these exist:
 *   - Chat hosts (Claude.ai, ChatGPT) attach user-uploaded files under
 *     auth-gated URLs that our server cannot fetch.
 *   - Auto-fetching arbitrary public URLs server-side raises copyright
 *     concerns (we'd be making durable copies of third-party content).
 *   - The explicit-consent pattern is: LLM sees the user's attached
 *     image, encodes it, calls upload_image, then uses the returned URL
 *     in modify_image / image_to_video / lip_sync / etc.
 *
 * Two upload patterns per media kind:
 *
 *   SINGLE-SHOT  (upload_image / upload_audio / upload_video):
 *     For files small enough to fit in a single MCP tool call. Fast and
 *     simple — base64 + MIME type → public URL.
 *
 *   CHUNKED      (upload_*_init / upload_*_chunk / upload_*_complete):
 *     For files too large for one call (the /mcp body limit is 32 MB,
 *     ~24 MB decoded after base64 inflation). Uses R2 multipart upload
 *     under the hood.
 *
 * All uploads are scoped to the authenticated user under
 * `uploads/{kind}/{userId}/{uuid}.{ext}` and gated by `assets:write`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { s3 } from "../../storage.js"
import { config } from "../../config.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { McpSession } from "../session.js"

const writeGate: ToolGate = { required: ["assets:write"] }

// ── MIME / extension tables ────────────────────────────────────────────

const SUPPORTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const

const SUPPORTED_AUDIO_MIME = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/x-m4a",
] as const

const SUPPORTED_VIDEO_MIME = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
] as const

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
}
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
}
const VIDEO_MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
}

const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_AUDIO_BYTES = 64 * 1024 * 1024
const MAX_VIDEO_BYTES = 256 * 1024 * 1024

// ── helpers ────────────────────────────────────────────────────────────

function decodeBase64(data: string, prefixRegex: RegExp): Buffer | string {
  const cleaned = data.replace(prefixRegex, "")
  try {
    return Buffer.from(cleaned, "base64")
  } catch (err) {
    return `Invalid base64 data: ${(err as Error).message}`
  }
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true }
}

async function singleShotPut(
  buffer: Buffer,
  mime: string,
  ext: string,
  userId: string,
  kind: "image" | "audio" | "video",
): Promise<string> {
  const key = `uploads/${kind}/${userId}/${randomUUID()}.${ext}`
  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  return `${config.R2_PUBLIC_URL}/${key}`
}

// ── chunked upload state ───────────────────────────────────────────────

interface ChunkedSession {
  userId: string
  kind: "image" | "audio" | "video"
  mime: string
  ext: string
  key: string
  uploadId: string
  parts: Array<{ PartNumber: number; ETag: string }>
  expiresAt: number
}

/**
 * Per-process map of in-flight chunked uploads. Each MCP request creates a
 * fresh server but the SDK reuses the same Node process, so this Map shares
 * across requests for the same instance. Entries auto-expire after 1 hour.
 *
 * Trade-off: if Railway round-robins requests across multiple replicas, a
 * chunked upload that started on replica A will fail on replica B. Worth
 * the simplicity for now — we only run a single backend replica.
 */
const chunkedSessions = new Map<string, ChunkedSession>()
const CHUNK_SESSION_TTL_MS = 60 * 60 * 1000 // 1h

function reapExpired(): void {
  const now = Date.now()
  for (const [id, session] of chunkedSessions) {
    if (session.expiresAt < now) {
      // Best-effort abort on R2 to free incomplete-multipart storage.
      void s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: session.key,
            UploadId: session.uploadId,
          }),
        )
        .catch(() => {})
      chunkedSessions.delete(id)
    }
  }
}

// ── registration ───────────────────────────────────────────────────────

export interface RegisterUploadOpts {
  server: McpServer
  session: McpSession
}

interface KindMeta {
  toolPrefix: "upload_image" | "upload_audio" | "upload_video"
  kind: "image" | "audio" | "video"
  supportedMime: readonly string[]
  mimeToExt: Record<string, string>
  maxBytes: number
  prefixRegex: RegExp
  description: {
    sourceVerb: string
    callsiteHint: string
  }
}

const KIND_META: Record<"image" | "audio" | "video", KindMeta> = {
  image: {
    toolPrefix: "upload_image",
    kind: "image",
    supportedMime: SUPPORTED_IMAGE_MIME,
    mimeToExt: IMAGE_MIME_TO_EXT,
    maxBytes: MAX_IMAGE_BYTES,
    prefixRegex: /^data:image\/[^;]+;base64,/,
    description: {
      sourceVerb: "image",
      callsiteHint: "modify_image / image_to_video / lip_sync",
    },
  },
  audio: {
    toolPrefix: "upload_audio",
    kind: "audio",
    supportedMime: SUPPORTED_AUDIO_MIME,
    mimeToExt: AUDIO_MIME_TO_EXT,
    maxBytes: MAX_AUDIO_BYTES,
    prefixRegex: /^data:audio\/[^;]+;base64,/,
    description: {
      sourceVerb: "audio",
      callsiteHint: "lip_sync (audio_url) / voice_clone / dubbing",
    },
  },
  video: {
    toolPrefix: "upload_video",
    kind: "video",
    supportedMime: SUPPORTED_VIDEO_MIME,
    mimeToExt: VIDEO_MIME_TO_EXT,
    maxBytes: MAX_VIDEO_BYTES,
    prefixRegex: /^data:video\/[^;]+;base64,/,
    description: {
      sourceVerb: "video",
      callsiteHint: "video_to_video / extend_video / motion_transfer / add_captions",
    },
  },
}

export function registerUploadTools({ server, session }: RegisterUploadOpts): void {
  if (!passesGate(session, writeGate)) return

  for (const meta of Object.values(KIND_META)) {
    registerSingleShot(server, session, meta)
    registerChunkedTrio(server, session, meta)
    registerPresignedUrl(server, session, meta)
  }
}

/**
 * The "escape hatch" upload path. Returns a presigned R2 PUT URL the LLM's
 * code interpreter can stream the file to via bash/curl, then the public URL
 * the LLM passes downstream as image_url / video_url / audio_url.
 *
 * This is THE recommended path for any user-attached file, because the
 * file bytes never traverse the LLM context (which truncates at ~16K chars
 * regardless of the upload tool's accept cap). The LLM reads the file path,
 * runs `curl -X PUT --data-binary @path PRESIGNED_URL`, then references
 * `public_url` in subsequent tools.
 */
function registerPresignedUrl(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  server.registerTool(
    `${meta.toolPrefix}_url`,
    {
      title: `Upload ${meta.kind} (presigned URL — recommended)`,
      description:
        `**RECOMMENDED upload path for any user-attached ${meta.description.sourceVerb}.** ` +
        `Returns a presigned PUT URL the LLM's code interpreter pipes the file ` +
        `to directly, plus the public URL to use downstream. The bytes NEVER ` +
        `flow through the LLM context — no base64 inflation, no truncation, ` +
        `no context-budget overhead, ANY file size.\n\n` +
        `Workflow:\n` +
        `  1. Call this tool with mime_type → returns { upload_url, public_url }\n` +
        `  2. In the code interpreter / bash:\n` +
        `       curl -X PUT --data-binary @path/to/file \\\n` +
        `         -H 'Content-Type: <mime_type>' \\\n` +
        `         '<upload_url>'\n` +
        `     (curl exits 0 on success.)\n` +
        `  3. Pass \`public_url\` to ${meta.description.callsiteHint} as ` +
        `${meta.kind}_url.\n\n` +
        `URL is valid for 1 hour. Use this in preference to ${meta.toolPrefix} ` +
        `(base64) and ${meta.toolPrefix}_init (chunked) — those have ` +
        `LLM-context constraints that this avoids entirely.`,
      inputSchema: {
        mime_type: z
          .enum(meta.supportedMime as readonly [string, ...string[]])
          .describe("MIME type of the file you intend to PUT."),
      },
      outputSchema: {
        upload_url: z.string(),
        public_url: z.string(),
        expires_in_seconds: z.number(),
        mime_type: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const ext = meta.mimeToExt[args.mime_type] ?? "bin"
      const key = `uploads/${meta.kind}/${session.userId}/${randomUUID()}.${ext}`
      const expiresIn = 60 * 60 // 1 hour
      let uploadUrl: string
      try {
        uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: key,
            ContentType: args.mime_type,
            CacheControl: "public, max-age=31536000, immutable",
          }),
          { expiresIn },
        )
      } catch (err) {
        return errorResult(
          `Failed to generate presigned URL: ${(err as Error).message}`,
        )
      }
      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Presigned upload URL ready for ${meta.kind} (${args.mime_type}).\n` +
              `1. PUT the file to: ${uploadUrl}\n` +
              `2. Reference downstream as: ${publicUrl}\n` +
              `Valid for ${expiresIn / 60} minutes.`,
          },
        ],
        structuredContent: {
          upload_url: uploadUrl,
          public_url: publicUrl,
          expires_in_seconds: expiresIn,
          mime_type: args.mime_type,
        },
      }
    },
  )
}

function registerSingleShot(server: McpServer, session: McpSession, meta: KindMeta): void {
  server.registerTool(
    meta.toolPrefix,
    {
      title: `Upload ${meta.kind[0]!.toUpperCase()}${meta.kind.slice(1)}`,
      description:
        `Upload ${meta.description.sourceVerb} bytes to Nodaro and get back a ` +
        `public URL. Pass base64-encoded bytes (no \`data:\` prefix) plus the ` +
        `MIME type.\n\n` +
        (meta.kind === "image"
          ? `**RESIZE BEFORE ENCODING** if the source is a user attachment. ` +
            `Use your code-interpreter (sharp / PIL / etc.) to downscale to a ` +
            `max long edge of ~1024 px at JPEG quality ~80 — target raw size ` +
            `200–400 KB (~270–540 KB base64). This keeps the call within LLM ` +
            `output context AND is plenty of resolution for downstream image-` +
            `to-image providers. Skipping this step on a multi-MB photo will ` +
            `silently truncate the base64 and corrupt the upload.\n\n`
          : `**TRIM / COMPRESS** the source first if it's a long recording or ` +
            `high-bitrate file. Aim for <2 MB raw. LLM output context can't ` +
            `reliably carry tens of megabytes of base64 in tool args.\n\n`) +
        `For files that genuinely need full quality (print, archival), ask the ` +
        `user to upload via https://app.nodaro.ai/library and paste back the ` +
        `URL. Server cap: ${Math.floor(meta.maxBytes / 1024 / 1024)} MB decoded.`,
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(Math.ceil((meta.maxBytes * 4) / 3) + 1024)
          .describe("Base64-encoded media bytes (no `data:` prefix)."),
        mime_type: z
          .enum(meta.supportedMime as readonly [string, ...string[]])
          .describe("MIME type of the source media."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const decoded = decodeBase64(args.data, meta.prefixRegex)
      if (typeof decoded === "string") return errorResult(decoded)
      let buffer = decoded
      if (buffer.length === 0) return errorResult(`Decoded ${meta.kind} is empty.`)
      if (buffer.length > meta.maxBytes) {
        return errorResult(
          `${meta.kind} too large: ${buffer.length} bytes (max ${meta.maxBytes}). ` +
            `For larger files use ${meta.toolPrefix}_init.`,
        )
      }

      let finalMime: string = args.mime_type
      if (meta.kind === "image" && (finalMime === "image/heic" || finalMime === "image/heif")) {
        try {
          buffer = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          finalMime = "image/jpeg"
        } catch (err) {
          return errorResult(`Failed to decode HEIC/HEIF: ${(err as Error).message}`)
        }
      }

      const ext = meta.mimeToExt[finalMime] ?? "bin"
      let url: string
      try {
        url = await singleShotPut(buffer, finalMime, ext, session.userId, meta.kind)
      } catch (err) {
        return errorResult(`Storage upload failed: ${(err as Error).message}`)
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Uploaded ${buffer.length}-byte ${finalMime} ${meta.kind}. ` +
              `Pass this URL to subsequent tools as ${meta.kind}_url: ${url}`,
          },
        ],
        structuredContent: { url, bytes: buffer.length, mimeType: finalMime },
      }
    },
  )
}

function registerChunkedTrio(server: McpServer, session: McpSession, meta: KindMeta): void {
  // ── _init ──
  server.registerTool(
    `${meta.toolPrefix}_init`,
    {
      title: `Upload ${meta.kind} (start chunked)`,
      description:
        `Start a chunked ${meta.kind} upload. **Strongly preferred over ` +
        `${meta.toolPrefix} for any file you need to read in pieces** — each ` +
        `chunk is a separate tool call so the LLM never has to concatenate ` +
        `long base64 strings in its own output (which truncates silently).\n\n` +
        `Workflow:\n` +
        `  1. Call ${meta.toolPrefix}_init with the mime_type → returns upload_id\n` +
        `  2. Call ${meta.toolPrefix}_chunk for each piece, in order, ` +
        `chunk_index starting at 1\n` +
        `  3. Call ${meta.toolPrefix}_complete to finalize → returns the URL\n\n` +
        `R2 multipart requires every part except the last to be at least 5 MB ` +
        `decoded (~7 MB base64). For images / small audio that's typically a ` +
        `single chunk anyway; the chunked path is mostly a robustness boost.`,
      inputSchema: {
        mime_type: z
          .enum(meta.supportedMime as readonly [string, ...string[]])
          .describe("MIME type of the source media."),
      },
      outputSchema: {
        upload_id: z.string(),
        kind: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      reapExpired()
      const ext = meta.mimeToExt[args.mime_type] ?? "bin"
      const key = `uploads/${meta.kind}/${session.userId}/${randomUUID()}.${ext}`
      let uploadId: string
      try {
        const created = await s3.send(
          new CreateMultipartUploadCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: key,
            ContentType: args.mime_type,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        )
        uploadId = created.UploadId ?? ""
        if (!uploadId) throw new Error("R2 did not return an UploadId")
      } catch (err) {
        return errorResult(`Failed to start multipart upload: ${(err as Error).message}`)
      }
      const handle = `${meta.kind}-${randomUUID()}`
      chunkedSessions.set(handle, {
        userId: session.userId,
        kind: meta.kind,
        mime: args.mime_type,
        ext,
        key,
        uploadId,
        parts: [],
        expiresAt: Date.now() + CHUNK_SESSION_TTL_MS,
      })
      return {
        content: [
          {
            type: "text" as const,
            text: `Chunked ${meta.kind} upload started. upload_id=${handle}. Send chunks via ${meta.toolPrefix}_chunk, then call ${meta.toolPrefix}_complete.`,
          },
        ],
        structuredContent: { upload_id: handle, kind: meta.kind },
      }
    },
  )

  // ── _chunk ──
  server.registerTool(
    `${meta.toolPrefix}_chunk`,
    {
      title: `Upload ${meta.kind} (chunk)`,
      description:
        `Send one chunk of a chunked ${meta.kind} upload (after ${meta.toolPrefix}_init). ` +
        `Each chunk except the last MUST be at least 5 MB; chunks should be sent ` +
        `in order. The chunk is base64-encoded raw bytes (no \`data:\` prefix). ` +
        `Once all chunks are sent, call ${meta.toolPrefix}_complete to finalize.`,
      inputSchema: {
        upload_id: z.string().describe("Returned by upload_*_init."),
        chunk_index: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .describe("1-based chunk index. Must be sequential and increasing."),
        data: z
          .string()
          .min(1)
          .max(12 * 1024 * 1024)
          .describe("Base64-encoded chunk bytes. Each chunk decoded ≈ 5–8 MB recommended."),
      },
      outputSchema: {
        accepted: z.boolean(),
        chunk_index: z.number(),
        bytes: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const session_ = chunkedSessions.get(args.upload_id)
      if (!session_ || session_.userId !== session.userId) {
        return errorResult("Unknown or expired upload_id.")
      }
      if (args.chunk_index !== session_.parts.length + 1) {
        return errorResult(
          `Out-of-order chunk: expected ${session_.parts.length + 1}, got ${args.chunk_index}.`,
        )
      }
      const decoded = Buffer.from(args.data, "base64")
      if (decoded.length === 0) return errorResult("Decoded chunk is empty.")
      try {
        const partRes = await s3.send(
          new UploadPartCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: session_.key,
            UploadId: session_.uploadId,
            PartNumber: args.chunk_index,
            Body: decoded,
          }),
        )
        if (!partRes.ETag) throw new Error("R2 did not return an ETag for this part")
        session_.parts.push({ PartNumber: args.chunk_index, ETag: partRes.ETag })
        session_.expiresAt = Date.now() + CHUNK_SESSION_TTL_MS
      } catch (err) {
        return errorResult(`Chunk upload failed: ${(err as Error).message}`)
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Accepted chunk ${args.chunk_index} (${decoded.length} bytes).`,
          },
        ],
        structuredContent: {
          accepted: true,
          chunk_index: args.chunk_index,
          bytes: decoded.length,
        },
      }
    },
  )

  // ── _complete ──
  server.registerTool(
    `${meta.toolPrefix}_complete`,
    {
      title: `Upload ${meta.kind} (finish chunked)`,
      description:
        `Finalize a chunked ${meta.kind} upload (after ${meta.toolPrefix}_init + N × ${meta.toolPrefix}_chunk). ` +
        `Returns the public URL the LLM passes to subsequent tools as ` +
        `${meta.kind}_url.`,
      inputSchema: {
        upload_id: z.string().describe("The upload_id from upload_*_init."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const session_ = chunkedSessions.get(args.upload_id)
      if (!session_ || session_.userId !== session.userId) {
        return errorResult("Unknown or expired upload_id.")
      }
      if (session_.parts.length === 0) {
        return errorResult("No chunks uploaded yet.")
      }
      try {
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: session_.key,
            UploadId: session_.uploadId,
            MultipartUpload: { Parts: session_.parts },
          }),
        )
      } catch (err) {
        return errorResult(`Failed to finalize multipart upload: ${(err as Error).message}`)
      }
      chunkedSessions.delete(args.upload_id)
      const url = `${config.R2_PUBLIC_URL}/${session_.key}`
      return {
        content: [
          {
            type: "text" as const,
            text: `Finalized ${session_.kind} upload. Pass this URL to subsequent tools as ${session_.kind}_url: ${url}`,
          },
        ],
        structuredContent: {
          url,
          bytes: 0, // we don't track running total for now
          mimeType: session_.mime,
        },
      }
    },
  )
}
