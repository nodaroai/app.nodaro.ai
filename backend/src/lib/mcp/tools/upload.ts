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
import { redis } from "../../queue.js"

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
  // upload_image_widget first — for hosts that render MCP UI resources
  // (Claude.ai web), this is the lowest-friction path: file picker
  // inside the chat iframe, no leave-tab dance, auto-announces the URL
  // to the LLM on success. Falls back gracefully — if the host doesn't
  // render widgets, the structuredContent still carries upload_url +
  // public_url so the LLM can present them as plain links.
  registerWidgetImageUpload(server, session)
  // Registration order matters: tools/list returns tools in this order
  // and LLMs weight earlier-listed tools more heavily when the
  // descriptions are otherwise comparable. Handoff next because it's
  // the only path that works in EVERY client (Claude.ai web/Android
  // sandbox, Cursor, Cline, Claude Desktop, Claude Code). Presigned
  // (curl PUT) second — only works in clients with unrestricted bash.
  // Inline base64 last — last-resort fallback for tiny files.
  for (const meta of Object.values(KIND_META)) {
    registerHandoffUpload(server, session, meta)
    registerPresignedUrl(server, session, meta)
    registerChunkedUpload(server, session, meta)
    registerInlineUpload(server, session, meta)
  }
}

/**
 * `upload_image_widget` — opens the in-iframe upload UI. Mints the same
 * handoff token the static upload page uses, so the existing `POST
 * /v1/upload-page/:token` endpoint receives the multipart from the
 * widget without any new route. Once the upload lands, the widget
 * itself calls `pushUserMessage("...uploaded at <url>...")` so the LLM
 * picks the URL up on the next turn — no manual "done" needed.
 */
function registerWidgetImageUpload(server: McpServer, session: McpSession): void {
  server.registerTool(
    "upload_image_widget",
    {
      title: "Upload Image (in-chat widget)",
      description:
        "**PREFERRED for Claude.ai web** when the user needs to supply a photo. " +
        "Opens an in-iframe file picker (works on phones — opens the camera or " +
        "gallery natively). The widget uploads the file to Nodaro and announces " +
        "the resulting public URL back to the chat automatically — the user only " +
        "taps the picker once. Returns `upload_url` + `public_url` via " +
        "structuredContent so the LLM can also present them as plain links if " +
        "the host doesn't render the widget.\n\n" +
        "Pass `purpose` to label the upload card (e.g. \"for the headshot app\") " +
        "and to seed the announcement message — helps the LLM remember which " +
        "downstream call this image was meant for.",
      inputSchema: {
        purpose: z
          .string()
          .max(120)
          .optional()
          .describe(
            "Short hint shown on the upload card (e.g. 'product photo for catalog app').",
          ),
      },
      outputSchema: {
        upload_url: z.string(),
        public_url: z.string(),
        expires_in_seconds: z.number(),
        prompt: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/upload-image",
        ui: {
          resourceUri: "ui://nodaro/widget/v3/upload-image",
          visibility: ["model", "app"],
        },
      },
    },
    async (args) => {
      const key = `uploads/handoff/image/${session.userId}/${randomUUID()}`
      const expiresIn = 60 * 60 // 1 hour
      const token = signUploadToken({
        userId: session.userId,
        key,
        // Browser-handoff tokens don't bake the mime — the widget sends
        // multipart and the server uses the form's reported Content-Type.
        mime: "",
        exp: Date.now() + expiresIn * 1000,
        purpose: "handoff",
        kind: "image",
      })
      const uploadUrl = `${config.PUBLIC_URL.replace(/\/+$/, "")}/v1/upload-page/${token}`
      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              "Opened the upload widget for the user.\n\n" +
              "When they pick a file the widget will upload it and post a " +
              "follow-up chat message with this URL:\n  " +
              publicUrl +
              "\n\nWait for that announcement, then use the URL as the image " +
              "input for the next step (modify_image / animate_image / " +
              "run_app / etc.).",
          },
        ],
        structuredContent: {
          upload_url: uploadUrl,
          public_url: publicUrl,
          expires_in_seconds: expiresIn,
          ...(args.purpose ? { prompt: args.purpose } : {}),
        },
      }
    },
  )
}

// ────────────────────────────────────────────────────────────────────
// Chunked upload (server-side stitching, Redis-backed)
// ────────────────────────────────────────────────────────────────────
//
// Three tools per kind: upload_*_init / _chunk / _complete. The LLM
// streams base64-encoded chunks through the MCP channel (which is
// allowlisted on every host — no sandbox concerns), the server buffers
// them in Redis, and on _complete writes a single PutObject to R2.
//
// Why server-side stitching instead of R2 multipart: R2 multipart
// requires ≥ 5 MB per non-final part. 5 MB raw = ~6.7 MB base64 ≈ 1.7M
// output tokens — way over any reasonable per-call output budget for
// modern LLMs. Server-side stitching lets us use small chunks
// (~64–256 KB raw, ~21–85K tokens base64) that fit comfortably.
//
// Why Redis instead of in-memory Map: lets us scale to multiple Railway
// instances without losing chunks if a request load-balances to a
// different node mid-upload, AND the chunks survive a single instance
// restart (unlikely to matter for a 10-min session, but cheap insurance).
const CHUNK_TTL_SECONDS = 10 * 60 // 10 min from last activity
const MAX_TOTAL_BYTES = 100 * 1024 * 1024 // 100 MB total per upload
const MAX_CHUNKS = 1000 // sanity cap on chunk count
// Per-chunk hard cap: 1 MB base64 ≈ 768 KB raw ≈ 256K tokens. Recommend
// callers stay below ~256 KB raw / 85K tokens; this is the upper bound
// for clients with large output budgets (Gemini, GPT, etc.).
const MAX_CHUNK_BASE64_CHARS = 1_500_000

const META_KEY = (uploadId: string): string => `mcp:chunked:${uploadId}:meta`
const CHUNKS_KEY = (uploadId: string): string => `mcp:chunked:${uploadId}:chunks`

interface ChunkSessionMeta {
  userId: string
  kind: "image" | "audio" | "video"
  mime: string
  key: string
  bytesUploaded: number
  chunkCount: number
}

async function readMeta(uploadId: string): Promise<ChunkSessionMeta | null> {
  const raw = await redis.hgetall(META_KEY(uploadId))
  if (!raw || !raw["userId"]) return null
  return {
    userId: raw["userId"]!,
    kind: raw["kind"] as ChunkSessionMeta["kind"],
    mime: raw["mime"]!,
    key: raw["key"]!,
    bytesUploaded: Number(raw["bytesUploaded"] ?? "0"),
    chunkCount: Number(raw["chunkCount"] ?? "0"),
  }
}

async function bumpTtl(uploadId: string): Promise<void> {
  await Promise.all([
    redis.expire(META_KEY(uploadId), CHUNK_TTL_SECONDS),
    redis.expire(CHUNKS_KEY(uploadId), CHUNK_TTL_SECONDS),
  ])
}

async function dropSession(uploadId: string): Promise<void> {
  await redis.del(META_KEY(uploadId), CHUNKS_KEY(uploadId))
}

function registerChunkedUpload(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  // ─── _init ──────────────────────────────────────────────────────
  server.registerTool(
    `upload_${meta.kind}_init`,
    {
      title: `Upload ${meta.kind} (chunked — start)`,
      description:
        `Start a chunked ${meta.kind} upload. Use this when the file ` +
        `bytes are accessible to the LLM (e.g. attached to chat) AND ` +
        `\`request_${meta.kind}_upload\` (browser handoff) isn't viable, ` +
        `e.g. autonomous pipelines that can't pause for user interaction.\n\n` +
        `**Workflow:**\n` +
        `  1. Call \`upload_${meta.kind}_init\` with mime_type → ` +
        `{ upload_id, public_url }. The public_url is deterministic and ` +
        `safe to use in subsequent tool calls AFTER \`_complete\` succeeds.\n` +
        `  2. For each chunk, call \`upload_${meta.kind}_chunk\` with ` +
        `the upload_id, sequential chunk_index (1-based), and base64 data.\n` +
        `  3. Call \`upload_${meta.kind}_complete\` with the upload_id ` +
        `to assemble + upload to R2.\n\n` +
        `**Recommended chunk size:** 64–256 KB of raw bytes (encoded base64 ` +
        `~85–340 KB ≈ 21–85K output tokens). Smaller chunks = more round-` +
        `trips but safer for clients with tight output budgets. Hard cap: ` +
        `1.5 MB of base64 chars per chunk, 100 MB total, 1000 chunks max.\n\n` +
        `Session expires 10 minutes after the last chunk activity.`,
      inputSchema: {
        mime_type: z
          .enum(meta.supportedMime as readonly [string, ...string[]])
          .describe("MIME type of the source media."),
      },
      outputSchema: {
        upload_id: z.string(),
        public_url: z.string(),
        expires_in_seconds: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const uploadId = randomUUID()
      const ext = MIME_TO_EXT[args.mime_type] ?? "bin"
      const key = `uploads/${meta.kind}/${session.userId}/${randomUUID()}.${ext}`
      const fields: Record<string, string> = {
        userId: session.userId,
        kind: meta.kind,
        mime: args.mime_type,
        key,
        bytesUploaded: "0",
        chunkCount: "0",
      }
      await redis.hset(META_KEY(uploadId), fields)
      await redis.expire(META_KEY(uploadId), CHUNK_TTL_SECONDS)
      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Chunked upload started. Send chunks to upload_${meta.kind}_chunk ` +
              `with upload_id=${uploadId}, then call upload_${meta.kind}_complete. ` +
              `Final URL (after _complete): ${publicUrl}`,
          },
        ],
        structuredContent: {
          upload_id: uploadId,
          public_url: publicUrl,
          expires_in_seconds: CHUNK_TTL_SECONDS,
        },
      }
    },
  )

  // ─── _chunk ─────────────────────────────────────────────────────
  server.registerTool(
    `upload_${meta.kind}_chunk`,
    {
      title: `Upload ${meta.kind} (chunked — send chunk)`,
      description:
        `Send one base64-encoded chunk of a chunked ${meta.kind} upload. ` +
        `chunk_index is 1-based and MUST be sent in order (first chunk = 1, ` +
        `second = 2, etc.). After all chunks are sent, call ` +
        `upload_${meta.kind}_complete. Recommended raw chunk size: 64–256 KB.`,
      inputSchema: {
        upload_id: z
          .string()
          .min(1)
          .describe("Returned by upload_*_init."),
        chunk_index: z
          .number()
          .int()
          .min(1)
          .max(MAX_CHUNKS)
          .describe("1-based, sequential."),
        data: z
          .string()
          .min(1)
          .max(MAX_CHUNK_BASE64_CHARS)
          .describe("Base64-encoded chunk bytes (no `data:` prefix)."),
      },
      outputSchema: {
        accepted: z.boolean(),
        chunk_index: z.number(),
        bytes: z.number(),
        bytes_uploaded_total: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const sessionMeta = await readMeta(args.upload_id)
      if (!sessionMeta) return errorResult("Unknown or expired upload_id.")
      if (sessionMeta.userId !== session.userId)
        return errorResult("upload_id belongs to a different user.")
      if (sessionMeta.kind !== meta.kind)
        return errorResult(
          `upload_id was opened for kind=${sessionMeta.kind}; this tool handles ${meta.kind}.`,
        )
      const expectedNext = sessionMeta.chunkCount + 1
      if (args.chunk_index !== expectedNext)
        return errorResult(
          `Out-of-order chunk: expected chunk_index=${expectedNext}, got ${args.chunk_index}.`,
        )

      // Decode to validate + measure raw bytes. Cheap (max 1 MB raw ≈ no-op).
      const cleaned = args.data.replace(/^data:[^;]+;base64,/, "")
      let buf: Buffer
      try {
        buf = Buffer.from(cleaned, "base64")
      } catch (err) {
        return errorResult(`Invalid base64: ${(err as Error).message}`)
      }
      if (buf.length === 0) return errorResult("Decoded chunk is empty.")
      const newTotal = sessionMeta.bytesUploaded + buf.length
      if (newTotal > MAX_TOTAL_BYTES)
        return errorResult(
          `Total upload would exceed ${MAX_TOTAL_BYTES} bytes (${newTotal} attempted).`,
        )

      // Persist the base64 string (decoder runs again on _complete; storing
      // strings keeps the Redis path simple and inspectable). Keys are
      // 1-based; HSET overwrites are idempotent for duplicate-send safety.
      await redis.hset(CHUNKS_KEY(args.upload_id), String(args.chunk_index), cleaned)
      await redis.hset(META_KEY(args.upload_id), {
        bytesUploaded: String(newTotal),
        chunkCount: String(args.chunk_index),
      })
      await bumpTtl(args.upload_id)

      return {
        content: [
          {
            type: "text" as const,
            text: `Accepted chunk ${args.chunk_index} (${buf.length} bytes). ` +
              `Total so far: ${newTotal} bytes.`,
          },
        ],
        structuredContent: {
          accepted: true,
          chunk_index: args.chunk_index,
          bytes: buf.length,
          bytes_uploaded_total: newTotal,
        },
      }
    },
  )

  // ─── _complete ──────────────────────────────────────────────────
  server.registerTool(
    `upload_${meta.kind}_complete`,
    {
      title: `Upload ${meta.kind} (chunked — finalize)`,
      description:
        `Finalize a chunked ${meta.kind} upload. Reads all chunks from the ` +
        `server buffer in order, assembles them, ${meta.kind === "image" ? "transcodes HEIC/HEIF to JPEG, " : ""}` +
        `writes a single PutObject to R2, and returns the public_url. ` +
        `Pass that URL to ${meta.callsiteHint} as ${meta.kind}_url.`,
      inputSchema: {
        upload_id: z.string().min(1).describe("Returned by upload_*_init."),
      },
      outputSchema: {
        public_url: z.string(),
        bytes: z.number(),
        mime_type: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const sessionMeta = await readMeta(args.upload_id)
      if (!sessionMeta) return errorResult("Unknown or expired upload_id.")
      if (sessionMeta.userId !== session.userId)
        return errorResult("upload_id belongs to a different user.")
      if (sessionMeta.kind !== meta.kind)
        return errorResult(
          `upload_id was opened for kind=${sessionMeta.kind}; this tool handles ${meta.kind}.`,
        )
      if (sessionMeta.chunkCount === 0)
        return errorResult("No chunks received — call upload_*_chunk first.")

      const chunkMap = await redis.hgetall(CHUNKS_KEY(args.upload_id))
      const buffers: Buffer[] = []
      for (let i = 1; i <= sessionMeta.chunkCount; i++) {
        const b64 = chunkMap[String(i)]
        if (!b64) {
          await dropSession(args.upload_id)
          return errorResult(
            `Missing chunk ${i} (received ${sessionMeta.chunkCount} chunks but #${i} is absent).`,
          )
        }
        buffers.push(Buffer.from(b64, "base64"))
      }
      // Explicit type widening — Buffer.concat returns Buffer<ArrayBufferLike>
      // but sharp's toBuffer returns Buffer<ArrayBuffer>; the wider type
      // accepts both reassignments without TS complaining.
      let buffer: Buffer = Buffer.concat(buffers)
      if (buffer.length === 0) {
        await dropSession(args.upload_id)
        return errorResult("Assembled buffer is empty.")
      }

      // HEIC/HEIF → JPEG (downstream image providers don't accept HEIC).
      // Public URL is already known to the LLM (extension was set at _init
      // from mime_type), so we keep the same R2 key. Mime/Content-Type
      // updates to image/jpeg even if the URL still ends in .heic.
      let finalMime = sessionMeta.mime
      if (
        meta.kind === "image" &&
        (finalMime === "image/heic" || finalMime === "image/heif")
      ) {
        try {
          buffer = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          finalMime = "image/jpeg"
        } catch (err) {
          await dropSession(args.upload_id)
          return errorResult(
            `Failed to decode HEIC/HEIF: ${(err as Error).message}`,
          )
        }
      }

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: sessionMeta.key,
            Body: buffer,
            ContentType: finalMime,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        )
      } catch (err) {
        // Don't drop the session on R2 failure — caller can retry _complete.
        return errorResult(`Storage upload failed: ${(err as Error).message}`)
      }

      await dropSession(args.upload_id)
      const publicUrl = `${config.R2_PUBLIC_URL}/${sessionMeta.key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Uploaded ${buffer.length}-byte ${finalMime} ${meta.kind}. ` +
              `Pass this URL to ${meta.callsiteHint} as ${meta.kind}_url: ${publicUrl}`,
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
      title: `Upload ${meta.kind} (inline base64 — last resort)`,
      description:
        `**LAST-RESORT FALLBACK — do NOT use for user-attached ${meta.kind} files.** ` +
        `Hard size cap ~30–50 KB raw because the base64 payload flows through ` +
        `the LLM's per-tool output token budget; anything larger truncates ` +
        `silently and corrupts the upload.\n\n` +
        `**Try these FIRST instead** (none have meaningful size limits):\n` +
        `  1. \`request_${meta.kind}_upload\` — universal default, works in ` +
        `EVERY client (Claude.ai web/Android, Cursor, Cline, Desktop, Code). ` +
        `Hands the upload off to the user's own browser via a Nodaro page.\n` +
        `  2. \`upload_${meta.kind}_init\` / \`_chunk\` / \`_complete\` — ` +
        `chunked, autonomous (no user action). Works in EVERY client because ` +
        `chunks flow through the MCP channel (allowlisted), not the bash ` +
        `egress sandbox. Slower than the others (many round-trips) but no ` +
        `user interaction needed.\n` +
        `  3. \`prepare_${meta.kind}_upload\` — automation path for clients ` +
        `with unrestricted bash egress (Cursor / Cline / Desktop / Code). ` +
        `Will FAIL silently on Claude.ai web/Android (sandbox blocks egress).\n\n` +
        `Only fall back to THIS tool if the user has a programmatically- ` +
        `generated tiny ${meta.kind} (a thumbnail, an icon, ` +
        `a sub-50KB clip) AND the other tools have failed. ` +
        (meta.kind === "image"
          ? `**Resize first**: max long edge ~512–1024 px, JPEG quality 80, ` +
            `target 30–50 KB raw.`
          : `**Compress / trim first**: target <50 KB raw.`) +
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

/**
 * Handoff upload — Claude can't reach our servers from inside the bash
 * sandbox (Anthropic's egress proxy blocks every object-storage host
 * including ours), so this tool side-steps the sandbox entirely by
 * routing the upload through the user's own browser instead.
 *
 * The tool returns two URLs derived from a single signed token:
 *   - `upload_page_url`: a small Nodaro-hosted page the user opens in
 *     their browser, drops the file on, and submits.
 *   - `public_url`: the eventual R2 public URL the file will land at
 *     once uploaded. Deterministic from the token's `key`, so Claude
 *     knows the URL up-front and can use it in subsequent tool calls
 *     after the user confirms.
 *
 * Instruction to the LLM: when the user attached an image to the chat
 * (so the bytes only exist in chat context, no public URL), Claude must
 * (1) render a download button/link for the attached image so the user
 * can save it locally, (2) show the upload-page URL so they can drop
 * the saved file on it, then (3) wait for the user to confirm before
 * calling the downstream verb with `public_url`.
 */
function registerHandoffUpload(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  const toolName = `request_${meta.kind}_upload`
  server.registerTool(
    toolName,
    {
      title: `Upload ${meta.kind} (browser handoff — preferred)`,
      description:
        `**PREFERRED upload path for user-attached ${meta.kind} files.** Works ` +
        `in EVERY MCP client (Claude.ai web/Android, Cursor, Cline, Claude ` +
        `Desktop, Claude Code) at any file size by routing the upload through ` +
        `the user's OWN browser instead of any LLM-side bash sandbox.\n\n` +
        `**Use this whenever** the user attached a ${meta.kind} (or asked you ` +
        `to use one they have locally) and there is no public URL for it yet. ` +
        `Don't try \`prepare_${meta.kind}_upload\` first — it FAILS on Claude.ai ` +
        `web/Android (sandbox blocks egress). Don't try \`upload_${meta.kind}\` ` +
        `first either — its ~30 KB cap will silently truncate user photos.\n\n` +
        `Returns:\n` +
        `  - \`upload_page_url\` — short Nodaro link the user opens in any ` +
        `browser to drop the file.\n` +
        `  - \`public_url\` — the eventual R2 URL (deterministic from the ` +
        `token, known up front so you can reference it in the next tool call).\n\n` +
        `**After calling this tool**, in your same response back to the user ` +
        `you MUST present both of:\n` +
        `  1. A download button/link for the ${meta.kind} the user attached ` +
        `(so they can save it to their device).\n` +
        `  2. The \`upload_page_url\` as a clearly-labeled link, with ` +
        `instructions to drop the saved file on that page.\n` +
        `Then wait for the user to confirm completion before calling ` +
        `${meta.callsiteHint} with \`public_url\` (passed as ` +
        `${meta.kind}_url).\n\n` +
        `**Skip this tool only when** the ${meta.kind} already has a public ` +
        `URL — either from a prior generation job (\`outputUrl\`) or because ` +
        `the user pasted a URL directly. In that case call ` +
        `${meta.callsiteHint} with that URL.`,
      inputSchema: {},
      outputSchema: {
        upload_page_url: z.string(),
        public_url: z.string(),
        expires_in_seconds: z.number(),
        kind: z.enum(["image", "audio", "video"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      // Extension-less key: the user's mime isn't known until upload, but
      // Claude needs the eventual URL up-front (deterministic-URL invariant).
      // Downstream providers fetch by URL and use the Content-Type response
      // header, so the missing extension is harmless.
      const key = `uploads/handoff/${meta.kind}/${session.userId}/${randomUUID()}`
      const expiresIn = 60 * 60 // 1 hour
      const token = signUploadToken({
        userId: session.userId,
        key,
        // mime isn't known yet — server will set R2 ContentType from the
        // multipart upload's actual mimetype. Field is required by the
        // shared TokenPayload shape; empty string means "use upload's type".
        mime: "",
        exp: Date.now() + expiresIn * 1000,
        purpose: "handoff",
        kind: meta.kind,
      })
      const uploadPageUrl = `${config.PUBLIC_URL}/v1/upload-page/${token}`
      const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Upload page ready for ${meta.kind}.\n\n` +
              `In your reply to the user, present:\n` +
              `  1. A download link/button for the ${meta.kind} they ` +
              `attached (so they can save it to disk).\n` +
              `  2. This upload page: ${uploadPageUrl}\n\n` +
              `Once they confirm the upload is done, call ` +
              `${meta.callsiteHint} with this ${meta.kind}_url:\n` +
              `  ${publicUrl}\n\n` +
              `Link valid for ${expiresIn / 60} minutes.`,
          },
        ],
        structuredContent: {
          upload_page_url: uploadPageUrl,
          public_url: publicUrl,
          expires_in_seconds: expiresIn,
          kind: meta.kind,
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
      title: `Upload ${meta.kind} (autonomous curl — restricted clients only)`,
      description:
        `**AUTOMATION upload path** — only works in MCP clients with ` +
        `unrestricted bash egress: Cursor / Cline / Claude Desktop / Claude ` +
        `Code CLI. Returns a presigned R2 PUT URL the LLM's code-interpreter ` +
        `pipes the file to directly via curl.\n\n` +
        `**WILL FAIL on Claude.ai web AND Claude for Android** — their bash ` +
        `sandboxes block egress to every object-storage host (HTTP 403 / ` +
        `"Host not in allowlist"). The "Additional allowed domains" UI at ` +
        `claude.ai/settings/capabilities is broken (Anthropic issue #19087) ` +
        `so the user can't whitelist us either.\n\n` +
        `**If you're not certain which environment you're in**, prefer ` +
        `\`request_${meta.kind}_upload\` (browser handoff — interactive) or ` +
        `\`upload_${meta.kind}_init\` / \`_chunk\` / \`_complete\` (chunked ` +
        `via MCP channel — fully autonomous). Both work EVERYWHERE. Only use ` +
        `THIS tool when you've already confirmed the LLM has unrestricted ` +
        `curl egress (e.g. inside a Cursor / Cline / Desktop / Code session ` +
        `and a prior network call to a non-Anthropic host succeeded).\n\n` +
        `Workflow when applicable:\n` +
        `  1. Call \`${toolName}\` with the file's mime_type → ` +
        `{ upload_url, public_url }\n` +
        `  2. In the code-interpreter / bash, stream the file:\n` +
        `       curl -X PUT --data-binary @path/to/file \\\n` +
        `         -H 'Content-Type: <mime_type>' \\\n` +
        `         '<upload_url>'\n` +
        `     curl exits 0 on success.\n` +
        `  3. Pass \`public_url\` to ${meta.callsiteHint} as ${meta.kind}_url.\n\n` +
        `URL valid for 1 hour. The file bytes never traverse the LLM context ` +
        `— any file size, no base64 inflation, no truncation.`,
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
