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

const SUPPORTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
}

const MAX_DECODED_BYTES = 8 * 1024 * 1024 // 8 MB

export interface RegisterUploadOpts {
  server: McpServer
  session: McpSession
}

export function registerUploadTools({ server, session }: RegisterUploadOpts): void {
  if (!passesGate(session, writeGate)) return

  server.registerTool(
    "upload_image",
    {
      title: "Upload Image",
      description:
        "Upload a local/attached image to Nodaro and get back a public URL. " +
        "Use this BEFORE `modify_image` / `image_to_video` / `lip_sync` whenever " +
        "the user provides an image as an attachment (chat hosts like Claude.ai " +
        "expose attachments only via auth-gated URLs that Nodaro can't fetch). " +
        "Pass the image as base64-encoded bytes (no `data:` prefix) plus the " +
        "MIME type. The returned URL is then passed as `image_url` to subsequent " +
        "tools. Max 8 MB decoded.",
      inputSchema: {
        data: z
          .string()
          .min(1)
          .max(16 * 1024 * 1024)
          .describe(
            "Base64-encoded image bytes (no `data:` prefix). Max ~10 MB encoded.",
          ),
        mime_type: z
          .enum(SUPPORTED_MIME)
          .describe("MIME type of the source image. HEIC/HEIF auto-converted to JPEG."),
      },
      outputSchema: {
        url: z.string(),
        bytes: z.number(),
        mimeType: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const cleaned = args.data.replace(/^data:image\/[^;]+;base64,/, "")
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
          content: [{ type: "text" as const, text: "Decoded image is empty." }],
          isError: true,
        }
      }
      if (buffer.length > MAX_DECODED_BYTES) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Image too large: ${buffer.length} bytes (max ${MAX_DECODED_BYTES}). Resize and retry.`,
            },
          ],
          isError: true,
        }
      }

      let finalMime = args.mime_type
      if (finalMime === "image/heic" || finalMime === "image/heif") {
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

      const ext = MIME_TO_EXT[finalMime] ?? "jpg"
      const key = `uploads/${session.userId}/${randomUUID()}.${ext}`

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

      const url = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Uploaded ${buffer.length}-byte ${finalMime} image. ` +
              `Pass this URL to subsequent tools as image_url: ${url}`,
          },
        ],
        structuredContent: {
          url,
          bytes: buffer.length,
          mimeType: finalMime,
        },
      }
    },
  )
}
