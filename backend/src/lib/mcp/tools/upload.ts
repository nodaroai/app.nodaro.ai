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
  // Three tiers, in fall-through priority order. LLMs weight earlier
  // tools more heavily, so the most-likely-to-work path goes first.
  //
  // 1. WIDGET (`upload_<kind>_widget`) — Apps clients (Claude.ai web /
  //    Android). File picker inside the chat iframe, supports
  //    multi-file via `max_files`, auto-announces URL(s) on success.
  // 2. HANDOFF (`request_<kind>_upload`) — Apps clients without widget
  //    rendering. User opens a Nodaro-hosted page in their own browser
  //    and confirms when done.
  // 3. CURL (`prepare_<kind>_upload`) — non-Apps CLI clients with
  //    unrestricted bash (Cursor / Cline / Claude Desktop / Claude
  //    Code). Returns a presigned PUT URL the LLM streams the file to.
  //
  // The historical inline-base64 (`upload_<kind>`) and chunked
  // (`upload_<kind>_init` / `_chunk` / `_complete`) tools were dropped
  // — the widget supersedes them for every meaningful use case and the
  // 12 redundant tools were just noise in tools/list.
  for (const meta of Object.values(KIND_META)) {
    registerWidgetUpload(server, session, meta)
  }
  for (const meta of Object.values(KIND_META)) {
    registerHandoffUpload(server, session, meta)
    registerPresignedUrl(server, session, meta)
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
/**
 * Per-kind widget URI map — widgets are registered at three v3 paths
 * (one per kind) with the same builder, just parameterized for the
 * accept-MIME and copy.
 */
const WIDGET_URI_FOR_KIND: Record<KindMeta["kind"], string> = {
  image: "ui://nodaro/widget/v3/upload-image",
  audio: "ui://nodaro/widget/v3/upload-audio",
  video: "ui://nodaro/widget/v3/upload-video",
}

/** Reasonable upper bound — [redacted-reference] supports up to ~10 in their soul-train flow. */
const MAX_FILES_HARD_CAP = 10

function registerWidgetUpload(
  server: McpServer,
  session: McpSession,
  meta: KindMeta,
): void {
  const toolName = `upload_${meta.kind}_widget`
  const widgetUri = WIDGET_URI_FOR_KIND[meta.kind]
  server.registerTool(
    toolName,
    {
      title: `Upload ${meta.kind} (in-chat widget)`,
      description:
        `**PREFERRED for Claude.ai web** when the user needs to supply ` +
        `${meta.kind === "audio" ? "audio" : meta.kind === "video" ? "video" : "a photo or set of photos"}. ` +
        `Opens an in-iframe file picker (multi-select supported via ` +
        `\`max_files\`; on phones the picker opens the camera or library ` +
        `natively). The widget uploads the file(s) to Nodaro and announces ` +
        `the resulting public URL(s) back to the chat automatically — the ` +
        `user only taps the picker once. Returns \`uploads\` (array of ` +
        `\`{upload_url, public_url}\`) plus a single \`upload_url\` / ` +
        `\`public_url\` referencing the first slot, so even hosts that ` +
        `don't render the widget can present the URLs as plain links.\n\n` +
        `Pass \`max_files\` to allocate that many upload slots (default 1, ` +
        `max ${MAX_FILES_HARD_CAP}). Use the higher count for "use these N ` +
        `references" flows (e.g. character training, multi-angle headshots). ` +
        `Pass \`purpose\` to label the upload card and seed the ` +
        `announcement message so the LLM remembers what each upload is for.`,
      inputSchema: {
        purpose: z
          .string()
          .max(120)
          .optional()
          .describe(
            `Short hint shown on the upload card (e.g. 'product ${meta.kind} for catalog app').`,
          ),
        max_files: z
          .number()
          .int()
          .min(1)
          .max(MAX_FILES_HARD_CAP)
          .optional()
          .describe(
            `Number of upload slots to allocate. Default 1. Use 2-${MAX_FILES_HARD_CAP} for ` +
            `multi-file flows (character refs, batch edits). Picking more than this ` +
            `errors in-widget — re-run with a higher count.`,
          ),
      },
      outputSchema: {
        // Multi-file shape (preferred — what the new widget reads).
        uploads: z
          .array(
            z.object({ upload_url: z.string(), public_url: z.string() }),
          )
          .optional(),
        // Single-file alias for the first slot — kept so hosts caching the
        // old outputSchema still see a valid response, and so non-widget
        // callers can grab the URL without indexing into uploads[0].
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
        "ui/resourceUri": widgetUri,
        ui: {
          resourceUri: widgetUri,
          visibility: ["model", "app"],
        },
      },
    },
    async (args) => {
      const expiresIn = 60 * 60 // 1 hour
      const count = Math.min(
        Math.max(1, args.max_files ?? 1),
        MAX_FILES_HARD_CAP,
      )
      const uploads: Array<{ upload_url: string; public_url: string }> = []
      const publicBase = config.PUBLIC_URL.replace(/\/+$/, "")
      for (let i = 0; i < count; i++) {
        const key = `uploads/handoff/${meta.kind}/${session.userId}/${randomUUID()}`
        const token = signUploadToken({
          userId: session.userId,
          key,
          // Browser-handoff tokens don't bake the mime — the widget sends
          // multipart and the server uses the form's reported Content-Type.
          mime: "",
          exp: Date.now() + expiresIn * 1000,
          purpose: "handoff",
          kind: meta.kind,
        })
        uploads.push({
          upload_url: `${publicBase}/v1/upload-page/${token}`,
          public_url: `${config.R2_PUBLIC_URL}/${key}`,
        })
      }
      const first = uploads[0]!
      const slotsCopy = count === 1 ? "the file" : `up to ${count} files`
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Opened the upload widget for the user (${slotsCopy}).\n\n` +
              `When they pick the file(s) the widget will upload them and ` +
              `post a follow-up chat message containing the resulting ` +
              `URL(s). The first eventual URL will be:\n  ` +
              first.public_url +
              `\n\nWait for the announcement, then use the URL(s) as the ` +
              `${meta.kind} input(s) for the next step ` +
              `(${meta.callsiteHint}).`,
          },
        ],
        structuredContent: {
          uploads,
          upload_url: first.upload_url,
          public_url: first.public_url,
          expires_in_seconds: expiresIn,
          ...(args.purpose ? { prompt: args.purpose } : {}),
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
        `\`upload_${meta.kind}_widget\` (in-chat picker, supports multi-file ` +
        `via \`max_files\`) or \`request_${meta.kind}_upload\` (browser ` +
        `handoff in a separate tab). Both work EVERYWHERE. Only use THIS ` +
        `tool when you've already confirmed the LLM has unrestricted curl ` +
        `egress (e.g. inside a Cursor / Cline / Desktop / Code session and ` +
        `a prior network call to a non-Anthropic host succeeded).\n\n` +
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
