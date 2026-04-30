/**
 * Upload tools — let the LLM bring user-provided media into Nodaro.
 *
 * One pattern per kind: `prepare_image_upload` / `prepare_audio_upload` /
 * `prepare_video_upload`. Each returns a presigned R2 PUT URL the LLM's
 * code-interpreter pipes the file to via curl, plus the public URL it
 * passes downstream as image_url / audio_url / video_url.
 *
 * Why presigned-URL only:
 *   - The earlier base64 (single-shot) and chunked (R2 multipart) tools
 *     forced the LLM to carry file bytes through its context. Even after
 *     resizing, view-tool truncation at ~16 KB chars and LLM-output
 *     truncation on long base64 strings made user-attached photo uploads
 *     unreliable in Claude.ai's web client.
 *   - Presigned URLs let the LLM stream from disk → curl → R2 without the
 *     bytes ever entering its context. Any file size, no truncation, no
 *     base64 inflation, no token overhead.
 *   - Auto-fetching arbitrary public URLs server-side raises copyright
 *     concerns (durable copies of third-party content under our control),
 *     so URL materialization isn't a substitute either.
 *
 * All uploads are scoped to the authenticated user under
 * `uploads/{kind}/{userId}/{uuid}.{ext}` and gated on `assets:write`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
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

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
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

interface KindMeta {
  kind: "image" | "audio" | "video"
  supportedMime: readonly string[]
  callsiteHint: string
}

const KIND_META: Record<"image" | "audio" | "video", KindMeta> = {
  image: {
    kind: "image",
    supportedMime: SUPPORTED_IMAGE_MIME,
    callsiteHint: "modify_image / image_to_video / lip_sync",
  },
  audio: {
    kind: "audio",
    supportedMime: SUPPORTED_AUDIO_MIME,
    callsiteHint: "lip_sync (audio_url) / voice_clone / dubbing",
  },
  video: {
    kind: "video",
    supportedMime: SUPPORTED_VIDEO_MIME,
    callsiteHint: "video_to_video / extend_video / motion_transfer / add_captions",
  },
}

export interface RegisterUploadOpts {
  server: McpServer
  session: McpSession
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true }
}

export function registerUploadTools({ server, session }: RegisterUploadOpts): void {
  if (!passesGate(session, writeGate)) return
  for (const meta of Object.values(KIND_META)) {
    registerPresignedUrl(server, session, meta)
  }
}

function registerPresignedUrl(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  const toolName = `prepare_${meta.kind}_upload`
  server.registerTool(
    toolName,
    {
      title: `Prepare ${meta.kind} upload`,
      description:
        `Bring a local/attached ${meta.kind} file into Nodaro. Returns a ` +
        `presigned PUT URL the LLM's code-interpreter / bash pipes the file ` +
        `to directly, plus the public URL to reference downstream.\n\n` +
        `Workflow:\n` +
        `  1. Call \`${toolName}\` with the file's mime_type → ` +
        `{ upload_url, public_url }\n` +
        `  2. In the code-interpreter / bash, stream the file:\n` +
        `       curl -X PUT --data-binary @path/to/file \\\n` +
        `         -H 'Content-Type: <mime_type>' \\\n` +
        `         '<upload_url>'\n` +
        `     curl exits 0 on success.\n` +
        `  3. Pass \`public_url\` to ${meta.callsiteHint} as ` +
        `${meta.kind}_url.\n\n` +
        `The file bytes never traverse the LLM context — any file size, no ` +
        `base64 inflation, no truncation, no token overhead. Presigned URL ` +
        `valid for 1 hour.`,
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
      const ext = MIME_TO_EXT[args.mime_type] ?? "bin"
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
        return errorResult(`Failed to generate presigned URL: ${(err as Error).message}`)
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
