/**
 * Upload tools — let the LLM bring its own image into Nodaro for use as a
 * source in `modify_image`, `image_to_video`, `lip_sync`, etc.
 *
 * Why this exists: Claude.ai (and most chat hosts) attach user images to the
 * conversation under their own auth-gated URL (`https://claude.ai/api/...
 * /files/.../preview`). Our worker can't fetch those URLs, so until we had
 * an upload tool the LLM had no way to bring a user-provided local image
 * into a Nodaro generation pipeline.
 *
 * The tool accepts base64-encoded image data + mime type. Most chat-host
 * LLMs can encode an attachment they have read access to. The tool:
 *   1. Validates mime type (png/jpeg/webp/avif/heic/heif)
 *   2. Validates size (<= 8 MB decoded — keeps the JSON-RPC payload sane;
 *      JSON-RPC over HTTP can technically take more but base64 inflation
 *      makes it impractical for the chat host's tool envelope)
 *   3. HEIC/HEIF → JPEG via sharp (browsers don't render HEIC; downstream
 *      providers don't accept it either)
 *   4. Uploads to R2 under `uploads/{uuid}.{ext}`
 *   5. Returns the public URL the LLM passes to `modify_image.image_url`
 *
 * Gating: `assets:write` scope. Falls back to `assets:read` if write isn't
 * configured (some early DCR rows from Cursor/Cline didn't have write).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "../../storage.js"
import { config } from "../../config.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { McpSession } from "../session.js"

const writeGate: ToolGate = { required: ["assets:write"] }

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

// Decoded-byte caps. Base64 inflates by ~33%, so the JSON-RPC payload is
// ceil(decoded * 4/3) + envelope. The /mcp route is configured for a 64 MB
// body limit (see routes/mcp.ts), so the absolute ceiling is ~48 MB decoded.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 16 * 1024 * 1024
const MAX_VIDEO_BYTES = 32 * 1024 * 1024

export interface RegisterUploadOpts {
  server: McpServer
  session: McpSession
}

interface UploadOpts {
  buffer: Buffer
  mime: string
  ext: string
  userId: string
  kind: "image" | "audio" | "video"
}

async function persistToR2({
  buffer,
  mime,
  ext,
  userId,
  kind,
}: UploadOpts): Promise<string> {
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

function decodeBase64(data: string, dataPrefixRegex: RegExp): Buffer | string {
  const cleaned = data.replace(dataPrefixRegex, "")
  try {
    return Buffer.from(cleaned, "base64")
  } catch (err) {
    return `Invalid base64 data: ${(err as Error).message}`
  }
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true }
}

export function registerUploadTools({ server, session }: RegisterUploadOpts): void {
  if (!passesGate(session, writeGate)) return

  // ── upload_image ───────────────────────────────────────────────────
  server.registerTool(
    "upload_image",
    {
      title: "Upload Image",
      description:
        "Upload a local/attached image to Nodaro and get back a public URL. " +
        "Use this BEFORE `modify_image` / `image_to_video` / `lip_sync` whenever " +
        "the user provides an image as an attachment (chat hosts expose " +
        "attachments only via auth-gated URLs that Nodaro can't fetch). " +
        "Pass the image as base64-encoded bytes (no `data:` prefix) plus the " +
        "MIME type. The returned URL is then passed as `image_url` to subsequent " +
        "tools. Max 8 MB decoded.",
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(16 * 1024 * 1024)
          .describe("Base64-encoded image bytes (no `data:` prefix). Max ~11 MB encoded."),
        mime_type: z
          .enum(SUPPORTED_IMAGE_MIME)
          .describe("MIME type of the source image. HEIC/HEIF auto-converted to JPEG."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const decoded = decodeBase64(args.data, /^data:image\/[^;]+;base64,/)
      if (typeof decoded === "string") return errorResult(decoded)
      let buffer = decoded
      if (buffer.length === 0) return errorResult("Decoded image is empty.")
      if (buffer.length > MAX_IMAGE_BYTES) {
        return errorResult(
          `Image too large: ${buffer.length} bytes (max ${MAX_IMAGE_BYTES}). Resize and retry.`,
        )
      }

      let finalMime: string = args.mime_type
      if (finalMime === "image/heic" || finalMime === "image/heif") {
        try {
          buffer = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          finalMime = "image/jpeg"
        } catch (err) {
          return errorResult(`Failed to decode HEIC/HEIF: ${(err as Error).message}`)
        }
      }

      const ext = IMAGE_MIME_TO_EXT[finalMime] ?? "jpg"
      let url: string
      try {
        url = await persistToR2({
          buffer,
          mime: finalMime,
          ext,
          userId: session.userId,
          kind: "image",
        })
      } catch (err) {
        return errorResult(`Storage upload failed: ${(err as Error).message}`)
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Uploaded ${buffer.length}-byte ${finalMime} image. Pass this URL to subsequent tools as image_url: ${url}`,
          },
        ],
        structuredContent: { url, bytes: buffer.length, mimeType: finalMime },
      }
    },
  )

  // ── upload_audio ───────────────────────────────────────────────────
  server.registerTool(
    "upload_audio",
    {
      title: "Upload Audio",
      description:
        "Upload a local/attached audio file to Nodaro and get back a public URL. " +
        "Use this BEFORE tools that take an `audio_url` or `voice_sample_url` " +
        "(e.g. `lip_sync`, `voice_clone`). Pass the audio as base64-encoded bytes " +
        "(no `data:` prefix) plus the MIME type. Max 16 MB decoded.",
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(24 * 1024 * 1024)
          .describe("Base64-encoded audio bytes (no `data:` prefix)."),
        mime_type: z
          .enum(SUPPORTED_AUDIO_MIME)
          .describe("MIME type. Common: audio/mpeg (mp3), audio/wav, audio/mp4 (m4a)."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const decoded = decodeBase64(args.data, /^data:audio\/[^;]+;base64,/)
      if (typeof decoded === "string") return errorResult(decoded)
      const buffer = decoded
      if (buffer.length === 0) return errorResult("Decoded audio is empty.")
      if (buffer.length > MAX_AUDIO_BYTES) {
        return errorResult(
          `Audio too large: ${buffer.length} bytes (max ${MAX_AUDIO_BYTES}). Compress or trim and retry.`,
        )
      }
      const ext = AUDIO_MIME_TO_EXT[args.mime_type] ?? "bin"
      let url: string
      try {
        url = await persistToR2({
          buffer,
          mime: args.mime_type,
          ext,
          userId: session.userId,
          kind: "audio",
        })
      } catch (err) {
        return errorResult(`Storage upload failed: ${(err as Error).message}`)
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Uploaded ${buffer.length}-byte ${args.mime_type} audio. Pass this URL to subsequent tools as audio_url: ${url}`,
          },
        ],
        structuredContent: { url, bytes: buffer.length, mimeType: args.mime_type },
      }
    },
  )

  // ── upload_video ───────────────────────────────────────────────────
  server.registerTool(
    "upload_video",
    {
      title: "Upload Video",
      description:
        "Upload a local/attached video to Nodaro and get back a public URL. " +
        "Use this BEFORE tools that take a `video_url` (e.g. `video_to_video`, " +
        "`extend_video`, `motion_transfer`, `add_captions`, `combine_videos`). " +
        "Pass the video as base64-encoded bytes (no `data:` prefix) plus the " +
        "MIME type. Max 32 MB decoded — for larger files, ask the user to " +
        "host the video on a public URL and use that directly.",
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(48 * 1024 * 1024)
          .describe("Base64-encoded video bytes (no `data:` prefix)."),
        mime_type: z
          .enum(SUPPORTED_VIDEO_MIME)
          .describe("MIME type. Common: video/mp4, video/webm, video/quicktime."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const decoded = decodeBase64(args.data, /^data:video\/[^;]+;base64,/)
      if (typeof decoded === "string") return errorResult(decoded)
      const buffer = decoded
      if (buffer.length === 0) return errorResult("Decoded video is empty.")
      if (buffer.length > MAX_VIDEO_BYTES) {
        return errorResult(
          `Video too large: ${buffer.length} bytes (max ${MAX_VIDEO_BYTES}). Compress, trim, or pass a public URL directly.`,
        )
      }
      const ext = VIDEO_MIME_TO_EXT[args.mime_type] ?? "bin"
      let url: string
      try {
        url = await persistToR2({
          buffer,
          mime: args.mime_type,
          ext,
          userId: session.userId,
          kind: "video",
        })
      } catch (err) {
        return errorResult(`Storage upload failed: ${(err as Error).message}`)
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Uploaded ${buffer.length}-byte ${args.mime_type} video. Pass this URL to subsequent tools as video_url: ${url}`,
          },
        ],
        structuredContent: { url, bytes: buffer.length, mimeType: args.mime_type },
      }
    },
  )
}
