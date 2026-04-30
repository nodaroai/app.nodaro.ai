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
import sharp from "sharp"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "../../storage.js"
import { config } from "../../config.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { McpSession } from "../session.js"
import { signUploadToken } from "../../../routes/upload-proxy.js"

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
    registerInlineUpload(server, session, meta)
  }
}

/**
 * Inline base64 upload — the file content travels through the MCP tool call
 * itself. The MCP connector is allowlisted by every host that supports MCP
 * at all (otherwise tools/list and OAuth wouldn't work), so this path
 * sidesteps the bash sandbox egress filter that breaks
 * `prepare_*_upload` + curl on Claude.ai web.
 *
 * Trade-off: tool args go through the LLM's output context, so very large
 * base64 strings can truncate. Practical sweet spot is files ≤ ~1 MB raw
 * (~1.4 MB base64 = ~350K tokens). For images, the LLM should resize to
 * ~1024 px / quality 80 first (200–400 KB raw) — fits comfortably in
 * context.
 *
 * Architecture: this complements `prepare_*_upload`. When the bash sandbox
 * blocks the curl PUT, the LLM falls back to inline upload through the
 * MCP channel.
 */
function registerInlineUpload(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  const toolName = `upload_${meta.kind}`
  server.registerTool(
    toolName,
    {
      title: `Upload ${meta.kind} (inline base64)`,
      description:
        `Upload a ${meta.kind} by passing base64-encoded bytes inline. The file ` +
        `flows through the MCP tool call (allowlisted on every MCP host), ` +
        `bypassing the bash-sandbox egress restriction that blocks ` +
        `\`prepare_${meta.kind}_upload\` + curl on Claude.ai web.\n\n` +
        `**When to use this** vs \`prepare_${meta.kind}_upload\`:\n` +
        `  - \`prepare_${meta.kind}_upload\` (curl PUT) — preferred when it ` +
        `works (any file size). Requires the user to allowlist mcp.nodaro.ai ` +
        `on Claude.ai web, or use a non-restricted client (Cursor, Claude ` +
        `Desktop, Cline, etc.).\n` +
        `  - \`${toolName}\` (this tool) — fallback when curl is blocked. ` +
        `Works in any MCP host but practical limit is ~1 MB raw because ` +
        `LLM output context can truncate long base64. ` +
        (meta.kind === "image"
          ? `**Resize first**: max long edge ~1024 px, JPEG quality ~80, ` +
            `target 200–400 KB raw.`
          : `**Compress / trim first**: target <1 MB raw.`) +
        `\n\nWorkflow:\n` +
        `  1. ${meta.kind === "image" ? "Resize the image" : "Compress/trim the file"} ` +
        `in your code interpreter.\n` +
        `  2. Base64-encode the bytes (no \`data:\` prefix).\n` +
        `  3. Call this tool with \`data\` + \`mime_type\` → returns ` +
        `\`{ public_url }\`.\n` +
        `  4. Pass \`public_url\` to ${meta.callsiteHint}.`,
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(8 * 1024 * 1024)
          .describe(
            "Base64-encoded media bytes (no `data:` prefix). Max ~6 MB encoded.",
          ),
        mime_type: z
          .enum(meta.supportedMime as readonly [string, ...string[]])
          .describe("MIME type of the source media."),
      },
      outputSchema: {
        public_url: z.string(),
        bytes: z.number(),
        mime_type: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const cleaned = args.data.replace(/^data:[^;]+;base64,/, "")
      let buffer: Buffer
      try {
        buffer = Buffer.from(cleaned, "base64")
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid base64 data: ${(err as Error).message}`,
            },
          ],
          isError: true,
        }
      }
      if (buffer.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Decoded ${meta.kind} is empty.` }],
          isError: true,
        }
      }

      // HEIC/HEIF → JPEG via sharp; downstream providers don't accept HEIC.
      let finalMime: string = args.mime_type
      if (
        meta.kind === "image" &&
        (finalMime === "image/heic" || finalMime === "image/heif")
      ) {
        try {
          buffer = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          finalMime = "image/jpeg"
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to decode HEIC/HEIF: ${(err as Error).message}`,
              },
            ],
            isError: true,
          }
        }
      }

      const ext = MIME_TO_EXT[finalMime] ?? "bin"
      const key = `uploads/${meta.kind}/${session.userId}/${randomUUID()}.${ext}`
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: finalMime,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        )
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Storage upload failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        }
      }

      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Uploaded ${buffer.length}-byte ${finalMime} ${meta.kind}. ` +
              `Pass this URL to subsequent tools as ${meta.kind}_url: ${publicUrl}`,
          },
        ],
        structuredContent: {
          public_url: publicUrl,
          bytes: buffer.length,
          mime_type: finalMime,
        },
      }
    },
  )
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
        `signed PUT URL the LLM's code-interpreter / bash pipes the file to ` +
        `directly, plus the public URL to reference downstream.\n\n` +
        `Workflow:\n` +
        `  1. Call \`${toolName}\` with the file's mime_type → ` +
        `{ upload_url, public_url }\n` +
        `  2. In the code-interpreter / bash, stream the file:\n` +
        `       curl -X PUT --data-binary @path/to/file \\\n` +
        `         -H 'Content-Type: <mime_type>' \\\n` +
        `         '<upload_url>'\n` +
        `     curl exits 0 on success.\n` +
        `  3. Pass \`public_url\` to ${meta.callsiteHint} as ${meta.kind}_url.\n\n` +
        `The file bytes never traverse the LLM context — any file size, no ` +
        `base64 inflation, no truncation, no token overhead. URL valid for ` +
        `1 hour.\n\n` +
        `**Note for Claude.ai bash sandbox**: if curl returns ` +
        `"Host not in allowlist / HTTP 403", the user needs to allowlist ` +
        `mcp.nodaro.ai and cdn.nodaro.ai in their Claude.ai network ` +
        `settings (Settings → Network → Allowed domains). Surface that ` +
        `instruction to the user and offer the alternative: ask the user ` +
        `to upload at https://app.nodaro.ai/library and paste back the ` +
        `resulting URL.`,
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
      const token = signUploadToken({
        userId: session.userId,
        key,
        mime: args.mime_type,
        exp: Date.now() + expiresIn * 1000,
      })
      // Upload via mcp.nodaro.ai specifically. LLM code-interpreter
      // sandboxes (Claude.ai) only allowlist the MCP resource server
      // domain (which they discover via /.well-known/oauth-protected-
      // resource), NOT the OAuth auth server. config.PUBLIC_URL points
      // to app.nodaro.ai (auth server) and is also blocked. Hardcode
      // the MCP host — it serves the same Fastify instance via Caddy
      // host routing.
      const uploadUrl = `https://mcp.nodaro.ai/v1/upload-proxy/${token}`
      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Upload URL ready for ${meta.kind} (${args.mime_type}).\n` +
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
