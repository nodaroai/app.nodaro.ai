import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { type GalleryItem } from "../widgets/gallery.js"

const readGate: ToolGate = { required: ["assets:read"] }
const writeGate: ToolGate = { required: ["assets:write"] }

export interface RegisterGalleryOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

interface GalleryRow {
  id: string
  job_type: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  completed_at: string | null
  provider: string | null
}

const IMAGE_JOBS = new Set([
  "generate-image",
  "edit-image",
  "image-to-image",
  "generate-character",
  "generate-character-asset",
  "generate-object",
  "generate-object-asset",
  "generate-creature",
  "generate-creature-asset",
  "generate-location",
  "generate-location-asset",
])

const VIDEO_JOBS = new Set([
  "image-to-video",
  "text-to-video",
  "generate-video",
  "video-to-video",
  "lip-sync",
  "motion-transfer",
])

const AUDIO_JOBS = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])

function getKind(jobType: string | null): "image" | "video" | "audio" | null {
  if (!jobType) return null
  if (IMAGE_JOBS.has(jobType)) return "image"
  if (VIDEO_JOBS.has(jobType)) return "video"
  if (AUDIO_JOBS.has(jobType)) return "audio"
  return null
}

function jobNamesForKind(kind: "image" | "video" | "audio"): string[] {
  if (kind === "image") return [...IMAGE_JOBS]
  if (kind === "video") return [...VIDEO_JOBS]
  return [...AUDIO_JOBS]
}

function formatRow(row: GalleryRow): string {
  const kind = getKind(row.job_type) ?? "unknown"
  const prompt = (row.input_data?.prompt as string | undefined) ?? ""
  const truncated = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt
  const model = (row.input_data?.provider as string | undefined) ?? row.provider ?? "?"
  const date = (row.completed_at ?? "").split("T")[0]
  return `${row.id}: ${kind} — "${truncated}" (${model}, ${date})`
}

/**
 * Pull reference-asset URLs from a job's input_data. Different job types
 * carry their inputs under different keys — image_url for edits, start +
 * end image for video transitions, audio_url for lip-sync, etc. We collect
 * all of them in pick-order so the widget can render up to ~2 as overlay
 * thumbnails on the tile (visual lineage). Bare strings only — no asset
 * IDs (the widget needs a URL to render).
 */
function extractReferences(input: Record<string, unknown> | null): string[] {
  if (!input) return []
  const refs: string[] = []
  const single = [
    "image_url",
    "imageUrl",
    "start_image_url",
    "startImageUrl",
    "end_image_url",
    "endImageUrl",
    "tail_image_url",
    "audio_url",
    "audioUrl",
    "video_url",
    "videoUrl",
    "reference_image_url",
    "referenceImageUrl",
  ] as const
  for (const k of single) {
    const v = input[k]
    if (typeof v === "string" && v.startsWith("http")) refs.push(v)
  }
  // Array forms — generate-character / multi-ref edits sometimes pass an
  // array under image_urls / imageUrls / reference_images.
  const arrays = ["image_urls", "imageUrls", "reference_images", "referenceImages"] as const
  for (const k of arrays) {
    const v = input[k]
    if (Array.isArray(v)) {
      for (const u of v) {
        if (typeof u === "string" && u.startsWith("http")) refs.push(u)
      }
    }
  }
  // De-dup while preserving order; cap at 4 so we don't ship a huge payload
  // for jobs with lots of references (the widget renders at most 2 anyway).
  return Array.from(new Set(refs)).slice(0, 4)
}

/**
 * Convert a Supabase `jobs` row into a `GalleryItem` shape suitable for the
 * v1.2 gallery widget. We pull the asset URL from `output_data` (the
 * kind-specific key — `imageUrl`, `videoUrl`, `audioUrl`) and the prompt +
 * model from `input_data`.
 */
function rowToGalleryItem(row: GalleryRow): GalleryItem | null {
  const kind = getKind(row.job_type)
  if (!kind) return null
  const out = row.output_data ?? {}
  const assetUrl =
    (kind === "image" && (out.imageUrl as string | undefined)) ||
    (kind === "video" && (out.videoUrl as string | undefined)) ||
    (kind === "audio" && (out.audioUrl as string | undefined)) ||
    ""
  if (!assetUrl) return null
  const thumbnailUrl =
    (out.thumbnailUrl as string | undefined) ?? (kind === "image" ? assetUrl : "")
  const input = row.input_data ?? {}
  const aspectRatio =
    (input.aspect_ratio as string | undefined) ??
    (input.aspectRatio as string | undefined) ??
    undefined
  const resolution =
    (input.resolution as string | undefined) ??
    (input.quality as string | undefined) ??
    undefined
  return {
    jobId: row.id,
    kind,
    prompt: (input.prompt as string | undefined) ?? "",
    model: (input.provider as string | undefined) ?? row.provider ?? "?",
    thumbnailUrl,
    assetUrl,
    createdAt: row.completed_at ?? "",
    favorited: false,
    aspectRatio,
    resolution,
    references: extractReferences(row.input_data),
  }
}

/**
 * Gallery tools.
 *
 * `browse_gallery` and `list_favorites` are read-only over the public/user
 * gallery. `favorite_asset` toggles a favorite. `get_asset` fetches metadata
 * for a single asset (job).
 *
 * v1.2: `browse_gallery` and `list_favorites` return both a text summary AND
 * a `buildGalleryWidget`-built UI resource so Claude.ai renders an inline
 * grid with fullscreen detail view + Use buttons.
 */
export function registerGallery({ server, session, fastify }: RegisterGalleryOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "browse_gallery",
      {
        title: "Show My Gallery / Browse Gallery",
        description:
          "PRIMARY tool when the user asks to SEE their gallery / library / " +
          "recent work — \"show me my gallery\", \"my recent images\", \"my " +
          "library\", \"what have I made\", \"my work\", or any synonym in " +
          "any language (Hebrew: \"תראה לי את הגלריה שלי\" / \"מה יצרתי\"; " +
          "Spanish: \"mi galería\"; etc.). Renders an INTERACTIVE GRID " +
          "WIDGET with thumbnails the user can click to view, copy, or " +
          "feed into edits — preferred over `list_jobs` (which returns " +
          "raw text data).\n\n" +
          "Default scope is the user's own library. Set `scope: \"public\"` " +
          "when the user explicitly asks for the PUBLIC gallery (\"what are " +
          "others making\", \"trending\"). Default kinds are image+video " +
          "(skips audio); pass `kinds: [\"audio\"]` etc. to opt in.",
        inputSchema: {
          scope: z
            .enum(["mine", "public"])
            .optional()
            .describe(
              "`mine` (default) = the user's own library. `public` = recent " +
              "public outputs from OTHER users (excludes the caller, mirrors " +
              "the web app's public gallery).",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("Max items to return (default 50, max 200)."),
          cursor: z
            .string()
            .optional()
            .describe("ISO `completed_at` timestamp from a prior result's next_cursor"),
          kinds: z
            .array(z.enum(["image", "video", "audio"]))
            .min(1)
            .optional()
            .describe(
              "Media kinds to include. Default `[\"image\", \"video\"]`. " +
              "Pass any combination — `[\"audio\"]` for music / TTS only, " +
              "`[\"image\", \"video\", \"audio\"]` for everything.",
            ),
          // Backward-compat: keep the single-kind shape so cached client
          // schemas don't reject calls with `kind: "image"`. Handler reads
          // `kinds ?? (kind ? [kind] : default)`.
          kind: z.enum(["image", "video", "audio"]).optional(),
          query: z
            .string()
            .max(200)
            .optional()
            .describe(
              "Optional prompt search — case-insensitive substring match " +
              "against each item's prompt text. Use when the user asks for " +
              "a topic (\"show me all the rabbit images\", \"find my " +
              "moonlit scenes\"). Pass just the keyword (e.g. \"rabbit\").",
            ),
        },
        outputSchema: {
          items: z.array(z.object({}).passthrough()).optional(),
          nextCursor: z.string().nullable().optional(),
          totalCount: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/gallery",
        ui: {
          resourceUri: "ui://nodaro/widget/v3/gallery",
          visibility: ["model", "app"],
        },
      },
      },
      async (args) => {
        const limit = args.limit ?? 50
        const scope = args.scope ?? "mine"
        const cursorCol = scope === "mine" ? "created_at" : "completed_at"
        // kinds (array, preferred) > kind (legacy single-value, kept for
        // cached-schema compat) > default [image, video].
        const kinds: ("image" | "video" | "audio")[] =
          args.kinds && args.kinds.length > 0
            ? args.kinds
            : args.kind
              ? [args.kind]
              : ["image", "video"]
        const allowedJobTypes = kinds.flatMap((k) => jobNamesForKind(k))

        // Chain filters first, then order, then limit — keeps the test
        // mock chain readable and matches Supabase's typical pattern.
        // "mine" (default) shows the user's own library including
        // in-progress runs; "public" mirrors the web app's public
        // gallery (completed + is_public + NOT caller).
        let query =
          scope === "mine"
            ? supabase
                .from("jobs")
                .select("id, job_type, input_data, output_data, completed_at, created_at, provider, status")
                .eq("user_id", session.userId)
            : supabase
                .from("jobs")
                .select("id, job_type, input_data, output_data, completed_at, created_at, provider, status")
                .eq("is_public", true)
                .eq("status", "completed")
                .neq("user_id", session.userId)
        query = query.not("output_data", "is", null)
        if (args.cursor) query = query.lt(cursorCol, args.cursor)
        if (args.query) {
          // input_data is JSONB; ->> coerces the prompt key to text so we
          // can ilike it. ilike with %…% is a partial substring match,
          // case-insensitive. Trim + escape % / _ so a literal "20%" in
          // the user's request doesn't widen the wildcard.
          const safe = args.query.replace(/[%_\\]/g, (c) => "\\" + c).trim()
          if (safe.length > 0) {
            query = query.ilike("input_data->>prompt", `%${safe}%`)
          }
        }
        query = query
          .in("job_type", allowedJobTypes)
          .order(cursorCol, { ascending: false })
          .limit(limit)
        const { data, error } = await query
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        const rows = (data ?? []) as GalleryRow[]
        const last = rows[rows.length - 1]
        // Cursor matches the column we ordered by (created_at for mine,
        // completed_at for public). For "mine" some rows may not yet
        // have completed_at (still processing) so we explicitly fall back.
        const lastCursorVal =
          scope === "mine"
            ? (last as unknown as { created_at?: string })?.created_at ?? last?.completed_at
            : last?.completed_at
        const nextCursor =
          rows.length === limit && lastCursorVal ? lastCursorVal : null
        const lines = rows.map(formatRow)
        const cursorLine = nextCursor
          ? `\n(next_cursor: ${nextCursor} — call browse_gallery again with this cursor)`
          : ""
        const text = lines.length > 0 ? lines.join("\n") + cursorLine : "(no items)"

        const items = rows
          .map(rowToGalleryItem)
          .filter((item): item is GalleryItem => item !== null)

        // Real total count on the FIRST page only — same column filters as
        // the paged query above. We skip on subsequent pages because the
        // widget caches totalCount across renders, and the count query
        // costs an extra round-trip we don't need to pay 5x while paging.
        let totalCount: number | null = null
        if (!args.cursor) {
          let countQuery =
            scope === "mine"
              ? supabase
                  .from("jobs")
                  .select("id", { count: "exact", head: true })
                  .eq("user_id", session.userId)
              : supabase
                  .from("jobs")
                  .select("id", { count: "exact", head: true })
                  .eq("is_public", true)
                  .eq("status", "completed")
                  .neq("user_id", session.userId)
          countQuery = countQuery.not("output_data", "is", null)
          if (args.query) {
            const safe = args.query.replace(/[%_\\]/g, (c) => "\\" + c).trim()
            if (safe.length > 0) {
              countQuery = countQuery.ilike("input_data->>prompt", `%${safe}%`)
            }
          }
          countQuery = countQuery.in("job_type", allowedJobTypes)
          const { count } = await countQuery
          totalCount = count ?? null
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            items: items as unknown as Record<string, unknown>[],
            nextCursor,
            totalCount: totalCount ?? items.length,
          },
        }
      },
    )

    // ── browse_uploads ──
    // Lists the user's uploaded source assets (images, videos, audio they
    // dropped into the upload widget or saved-to-library), distinct from
    // browse_gallery which lists generation outputs. Reuses the gallery
    // widget — passes `loadMoreTool: "browse_uploads"` so the widget polls
    // THIS tool (not browse_gallery) when the user pages forward.
    server.registerTool(
      "browse_uploads",
      {
        title: "Browse My Uploads",
        description:
          "PRIMARY tool when the user asks to see what they've UPLOADED — " +
          "\"my uploads\", \"my source images\", \"the photos I uploaded\", " +
          "\"my reference videos\", or any synonym. DISTINCT from " +
          "`browse_gallery`, which shows the OUTPUT of generations. Use " +
          "this when the user wants to PICK an existing upload to feed " +
          "into a new generation (modify_image, animate_image, " +
          "lip_sync, etc.).\n\n" +
          "Renders the same interactive grid widget as the gallery; tile " +
          "click → fullscreen detail; the Use button hands the asset id " +
          "back to chat so Claude can pipe it into the next call.",
        inputSchema: {
          kind: z
            .enum(["image", "video", "audio"])
            .optional()
            .describe("Filter by media kind. Omit for all uploads."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max items to return (default 40, max 100)."),
          cursor: z
            .string()
            .uuid()
            .optional()
            .describe("Asset id from a prior result's nextCursor for pagination."),
          search: z
            .string()
            .max(200)
            .optional()
            .describe("Optional filename substring search."),
        },
        outputSchema: {
          items: z.array(z.object({}).passthrough()).optional(),
          nextCursor: z.string().nullable().optional(),
          totalCount: z.number().optional(),
          loadMoreTool: z.string().optional(),
        },
        annotations: { readOnlyHint: true },
        _meta: {
          "ui/resourceUri": "ui://nodaro/widget/v3/gallery",
          ui: {
            resourceUri: "ui://nodaro/widget/v3/gallery",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        const limit = args.limit ?? 40

        // Resolve cursor → created_at upper bound (cursor is an asset id;
        // we want assets older than the one with that id). Mirrors the
        // /v1/library route's cursor-resolution step.
        let cursorTimestamp: string | null = null
        if (args.cursor) {
          const { data: cursorRow } = await supabase
            .from("assets")
            .select("created_at")
            .eq("id", args.cursor)
            .eq("user_id", session.userId)
            .maybeSingle()
          cursorTimestamp = (cursorRow?.created_at as string | undefined) ?? null
        }

        let query = supabase
          .from("assets")
          .select(
            "id, type, filename, mime_type, size_bytes, r2_url, metadata, created_at",
          )
          .eq("user_id", session.userId)
          .order("created_at", { ascending: false })
          .limit(limit + 1) // +1 to detect hasMore

        if (args.kind) query = query.eq("type", args.kind)
        if (args.search) query = query.ilike("filename", `%${args.search}%`)
        if (cursorTimestamp) query = query.lt("created_at", cursorTimestamp)

        const { data, error } = await query
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        const rows = data ?? []
        const hasMore = rows.length > limit
        const pageRows = hasMore ? rows.slice(0, limit) : rows
        const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id as string | undefined) ?? null : null

        // Total count on first page only (matches /v1/library's behaviour).
        let totalCount: number | null = null
        if (!args.cursor) {
          let countQuery = supabase
            .from("assets")
            .select("id", { count: "exact", head: true })
            .eq("user_id", session.userId)
          if (args.kind) countQuery = countQuery.eq("type", args.kind)
          if (args.search) countQuery = countQuery.ilike("filename", `%${args.search}%`)
          const { count } = await countQuery
          totalCount = count ?? null
        }

        // Map asset rows into the gallery widget's item shape. `jobId` is
        // overloaded to carry the asset id — resolveAssetId now accepts
        // both jobs and assets, so the Use button still wires up correctly.
        const items = pageRows.map((a) => {
          const meta = (a.metadata ?? {}) as Record<string, unknown>
          return {
            jobId: a.id as string,
            kind: a.type as "image" | "video" | "audio",
            prompt: (a.filename as string | null) ?? "",
            model: "upload",
            thumbnailUrl:
              (meta.thumbnail_url as string | undefined) ??
              (a.r2_url as string),
            assetUrl: a.r2_url as string,
            createdAt: a.created_at as string,
            favorited: false,
          }
        })

        const lines = items.length > 0
          ? items
              .map((it) => `- ${it.kind} ${it.jobId} ${it.prompt ? `(${it.prompt})` : ""}`)
              .join("\n")
          : "(no uploads)"
        const cursorLine = nextCursor
          ? `\n(next_cursor: ${nextCursor})`
          : ""

        return {
          content: [{ type: "text" as const, text: lines + cursorLine }],
          structuredContent: {
            items: items as unknown as Record<string, unknown>[],
            nextCursor,
            totalCount: totalCount ?? items.length,
            // Hint to the gallery widget: poll this tool (not
            // browse_gallery) when the user pages forward.
            loadMoreTool: "browse_uploads",
          },
        }
      },
    )

    server.registerTool(
      "list_favorites",
      {
        title: "List Favorites",
        description:
          "List the authenticated user's favorited gallery items (most-recent first). Returns the favorite job_ids.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional(),
        },
        outputSchema: {
          items: z.array(z.object({}).passthrough()).optional(),
          nextCursor: z.string().nullable().optional(),
          totalCount: z.number().optional(),
        },
        annotations: { readOnlyHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/gallery",
        ui: {
          resourceUri: "ui://nodaro/widget/v3/gallery",
          visibility: ["model", "app"],
        },
      },
      },
      async (args) => {
        const limit = args.limit ?? 50
        let query = supabase
          .from("gallery_favorites")
          .select("job_id, created_at")
          .eq("user_id", session.userId)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (args.cursor) query = query.lt("created_at", args.cursor)
        const { data, error } = await query
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        const rows = data ?? []
        const last = rows[rows.length - 1]
        const nextCursor =
          rows.length === limit && last?.created_at ? (last.created_at as string) : null
        const text = JSON.stringify(
          { data: rows.map((r) => r.job_id), next_cursor: nextCursor },
          null,
          2,
        )

        // Hydrate the favorited job_ids into full gallery items so the widget
        // can render them. Skips silently if any single fetch fails.
        const jobIds = rows.map((r) => r.job_id as string)
        let items: GalleryItem[] = []
        if (jobIds.length > 0) {
          const { data: jobsData } = await supabase
            .from("jobs")
            .select("id, job_type, input_data, output_data, completed_at, provider")
            .in("id", jobIds)
            // Tenant scope: only hydrate jobs the caller may see (own, or
            // public+completed) — same predicate as get_asset/display_asset.
            // Without this, favoriting another user's job UUID would leak its
            // output_data URLs + input_data prompt.
            .or(`user_id.eq.${session.userId},and(is_public.eq.true,status.eq.completed)`)
          items = ((jobsData ?? []) as GalleryRow[])
            .map(rowToGalleryItem)
            .filter((item): item is GalleryItem => item !== null)
            .map((item) => ({ ...item, favorited: true }))
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            items: items as unknown as Record<string, unknown>[],
            nextCursor,
            totalCount: items.length,
          },
        }
      },
    )

    server.registerTool(
      "get_asset",
      {
        title: "Get Asset",
        description:
          "Fetch metadata for a single asset (job) by id, including its output URL, prompt, and provider. " +
          "Returns the user's OWN jobs (any status) AND any other user's PUBLIC + COMPLETED jobs " +
          "— the same visibility surface as `browse_gallery` so anything the user can see they can also " +
          "fetch and reuse (e.g. the LLM passes the URL into a verb tool as image_url / video_url).",
        inputSchema: {
          job_id: z.string().min(1),
        },
        outputSchema: {
          jobId: z.string(),
          status: z.string(),
          progress: z.number().optional(),
          outputUrl: z.string().nullable().optional(),
          assetKind: z.string().nullable().optional(),
          jobType: z.string().nullable().optional(),
          completedAt: z.string().nullable().optional(),
          outputData: z.record(z.string(), z.unknown()).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        // Visibility: caller's own jobs (any status) OR any user's public +
        // completed jobs. Mirrors browse_gallery's public-scope filter so a
        // user can `get_asset` whatever they can see in the public gallery.
        // PostgREST .or() parses comma at the top level; nested AND uses
        // and(...). user_id stays unquoted since it's a UUID-shaped string.
        const { data, error } = await supabase
          .from("jobs")
          .select(
            // display_cost (USD) excluded — MCP surfaces credits only.
            "id, status, progress, job_type, input_data, output_data, created_at, completed_at, credits, user_id",
          )
          .eq("id", args.job_id)
          .or(
            `user_id.eq.${session.userId},and(is_public.eq.true,status.eq.completed)`,
          )
          .maybeSingle()
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        if (!data) {
          return {
            content: [{ type: "text", text: `Asset ${args.job_id} not found` }],
            isError: true,
          }
        }

        // Extract the public asset URL from output_data (varies by job_type:
        // imageUrl / videoUrl / audioUrl / outputUrl). The widget polls this
        // tool every 2s and reads structuredContent to update its preview.
        const out = (data.output_data ?? {}) as Record<string, unknown>
        const outputUrl =
          (out.imageUrl as string | undefined) ??
          (out.videoUrl as string | undefined) ??
          (out.audioUrl as string | undefined) ??
          (out.outputUrl as string | undefined) ??
          (out.url as string | undefined) ??
          null
        const assetKind = out.imageUrl
          ? "image"
          : out.videoUrl
            ? "video"
            : out.audioUrl
              ? "audio"
              : null

        // Debug: log to Railway when a completed job has no URL we can find,
        // so we can see what shape output_data actually has in production.
        if (data.status === "completed" && !outputUrl) {
          // eslint-disable-next-line no-console
          console.log(
            `[mcp] get_asset ${args.job_id} completed but no URL found. ` +
              `job_type=${data.job_type} output_data keys=${Object.keys(out).join(",")} ` +
              `output_data=${JSON.stringify(out).slice(0, 500)}`,
          )
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }],
          structuredContent: {
            jobId: data.id,
            status: data.status,
            progress: data.progress ?? 0,
            outputUrl,
            assetKind,
            jobType: data.job_type,
            completedAt: data.completed_at,
            // For now also expose the raw output_data so the widget can fall
            // back to alternate field names if our normalization missed one.
            outputData: out,
          },
        }
      },
    )

    // ── display_asset ──
    // Like `get_asset` but renders the asset visually in chat via the
    // single-job widget (so the user actually SEES the image instead of
    // getting a JSON dump). Use when the user asks "show me <id>" or
    // "display this", or after browse_gallery when the user wants to look
    // at a specific item full-size in chat.
    //
    // Visibility mirrors get_asset / browse_gallery: caller's own jobs OR
    // any user's public+completed jobs.
    //
    // The bound widget is the image variant (most gallery assets are
    // images). For video/audio assets, the tool returns text-only with a
    // direct link (no widget) — rendering a video URL through an <img>
    // tag would just show a broken-image icon.
    server.registerTool(
      "display_asset",
      {
        title: "Show / Display Asset",
        description:
          "Render an asset visually in chat (the user sees the image, not JSON). " +
          "Use when the user asks to SEE / SHOW / DISPLAY a specific asset by id, " +
          "or after `browse_gallery` when they want to look at one item full-size. " +
          "Visibility = caller's own jobs (any status) OR any user's public+completed " +
          "jobs (same surface as `browse_gallery` and `get_asset`). " +
          "Best for IMAGE assets — the bound widget renders the image inline with " +
          "metadata badges and Edit / Animate / Use-as-reference buttons. " +
          "For video/audio assets the tool returns a direct link instead (no widget); " +
          "for purely-programmatic metadata (no rendering) prefer `get_asset`.",
        inputSchema: {
          job_id: z.string().min(1),
        },
        // No outputSchema — the SDK enforces "every response must include
        // structuredContent" when one is declared, but our video/audio
        // branch returns text-only (the bound image widget can't render
        // those URLs). Text-only is valid without an outputSchema.
        annotations: { readOnlyHint: true },
        _meta: {
          "ui/resourceUri": "ui://nodaro/widget/v3/job-image",
          ui: {
            resourceUri: "ui://nodaro/widget/v3/job-image",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        // Same OR query as get_asset — caller's own job OR any public+completed.
        const { data, error } = await supabase
          .from("jobs")
          .select(
            "id, status, job_type, input_data, output_data, completed_at, user_id",
          )
          .eq("id", args.job_id)
          .or(
            `user_id.eq.${session.userId},and(is_public.eq.true,status.eq.completed)`,
          )
          .maybeSingle()
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        if (!data) {
          return {
            content: [{ type: "text", text: `Asset ${args.job_id} not found` }],
            isError: true,
          }
        }

        const out = (data.output_data ?? {}) as Record<string, unknown>
        const input = (data.input_data ?? {}) as Record<string, unknown>
        const outputUrl =
          (out.imageUrl as string | undefined) ??
          (out.videoUrl as string | undefined) ??
          (out.audioUrl as string | undefined) ??
          (out.outputUrl as string | undefined) ??
          (out.url as string | undefined) ??
          null
        const assetKind = getKind(data.job_type)

        if (!outputUrl) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Asset ${args.job_id} is not viewable (status=${data.status}` +
                  `${data.job_type ? `, job_type=${data.job_type}` : ""}). No output URL yet.`,
              },
            ],
            isError: true,
          }
        }

        // For non-image kinds, skip the widget — image widget would render
        // a video/audio URL through <img> and break. Text result with the
        // direct URL is more useful.
        if (assetKind !== "image") {
          const label = assetKind ?? "Asset"
          const note = assetKind
            ? `\n(In-chat preview rendering is image-only right now; ` +
              `open the URL above to view this ${assetKind}.)`
            : ""
          return {
            content: [
              {
                type: "text",
                text: `${label} ${args.job_id}: ${outputUrl}${note}`,
              },
            ],
          }
        }

        // Image kind — full widget render. Shape matches the
        // SingleJobStructuredContent the single-job widget consumes.
        const prompt = (input.prompt as string | undefined) ?? undefined
        const model =
          (input.provider as string | undefined) ??
          (input.model as string | undefined) ??
          undefined
        const aspectRatio = (input.aspect_ratio as string | undefined) ?? undefined
        const resolution = (input.resolution as string | undefined) ?? undefined
        return {
          content: [
            {
              type: "text",
              text: `Image ${args.job_id}: ${outputUrl}`,
            },
          ],
          structuredContent: {
            jobId: data.id,
            prompt,
            model,
            aspectRatio,
            resolution,
            outputUrl,
            assetKind,
          },
        }
      },
    )

    // ── get_app_run ──
    // Workflow / app runs live in `workflow_executions` (not `jobs`). The
    // workflow + app-run widgets poll this every 2s to update node-status
    // pill lists and surface output URLs once available, since stateless
    // HTTP MCP can't deliver the orchestrator's executionEvents
    // asynchronously (server tears down after the tool call returns).
    server.registerTool(
      "get_app_run",
      {
        title: "Get App Run",
        description:
          "Fetch status of a workflow / published-app execution by id. " +
          "Returns the execution's status, per-node states, and any output " +
          "URLs (with prompt/model/jobId metadata) the run has produced so " +
          "far. Used by the workflow + app-run widgets to poll progress.",
        inputSchema: {
          execution_id: z.string().min(1),
        },
        outputSchema: {
          executionId: z.string(),
          status: z.string(),
          nodeStates: z
            .array(
              z.object({
                id: z.string(),
                label: z.string().optional(),
                status: z.string(),
              }),
            )
            .optional(),
          // Outputs are enriched with the source job's metadata (jobId,
          // prompt, model, createdAt) so widgets can drive a gallery-style
          // grid + Use-as-reference button without an extra round-trip.
          outputs: z
            .array(
              z.object({
                kind: z.string(),
                url: z.string(),
                jobId: z.string().optional(),
                prompt: z.string().optional(),
                model: z.string().optional(),
                createdAt: z.string().optional(),
              }),
            )
            .optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { data, error } = await supabase
          .from("workflow_executions")
          .select("id, status, node_states, created_at, completed_at, user_id")
          .eq("id", args.execution_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        if (!data) {
          return {
            content: [{ type: "text", text: `Execution ${args.execution_id} not found` }],
            isError: true,
          }
        }

        // node_states is JSONB keyed by node id with at least
        // `{ status, jobId?, output?: { imageUrl?|videoUrl?|audioUrl? }, nodeType? }`.
        // We flatten into the widget-friendly shapes — { id, label, status }
        // for the pill list, plus an enriched { kind, url, jobId?, prompt?,
        // model?, createdAt? } array for gallery-style grid rendering.
        const ns = (data.node_states ?? {}) as Record<
          string,
          {
            status?: string
            jobId?: string
            output?: { imageUrl?: string; videoUrl?: string; audioUrl?: string; outputUrl?: string }
            nodeType?: string
          }
        >
        const nodeStates: Array<{ id: string; label?: string; status: string }> = []
        type RawOutput = { kind: string; url: string; jobId?: string }
        const rawOutputs: RawOutput[] = []
        for (const [nodeId, state] of Object.entries(ns)) {
          nodeStates.push({
            id: nodeId,
            label: state.nodeType ?? nodeId,
            status: state.status ?? "queued",
          })
          if (state.output) {
            const url =
              state.output.imageUrl ??
              state.output.videoUrl ??
              state.output.audioUrl ??
              state.output.outputUrl
            const kind = state.output.imageUrl
              ? "image"
              : state.output.videoUrl
                ? "video"
                : state.output.audioUrl
                  ? "audio"
                  : null
            if (url && kind) rawOutputs.push({ kind, url, jobId: state.jobId })
          }
        }

        // Batch-fetch the source jobs for prompt/model/createdAt enrichment.
        // Skip cleanly if no jobIds (e.g. inline-only nodes produced the
        // outputs); the widget falls back to URL-only tiles in that case.
        const jobIds = rawOutputs
          .map((o) => o.jobId)
          .filter((id): id is string => Boolean(id))
        const jobMeta = new Map<
          string,
          { prompt?: string; provider?: string; createdAt?: string }
        >()
        if (jobIds.length) {
          const { data: jobs } = await supabase
            .from("jobs")
            .select("id, input_data, provider, completed_at, created_at")
            .in("id", jobIds)
          for (const j of jobs ?? []) {
            const input = (j.input_data ?? {}) as Record<string, unknown>
            jobMeta.set(j.id as string, {
              prompt: (input.prompt as string | undefined) ?? undefined,
              provider:
                (j.provider as string | undefined) ??
                (input.provider as string | undefined) ??
                (input.model as string | undefined),
              createdAt:
                (j.completed_at as string | undefined) ??
                (j.created_at as string | undefined),
            })
          }
        }

        const outputs = rawOutputs.map((o) => {
          const meta = o.jobId ? jobMeta.get(o.jobId) : undefined
          return {
            kind: o.kind,
            url: o.url,
            jobId: o.jobId,
            prompt: meta?.prompt,
            model: meta?.provider,
            createdAt: meta?.createdAt,
          }
        })

        return {
          content: [{ type: "text", text: JSON.stringify({ data: { id: data.id, status: data.status, nodeStates, outputs } }, null, 2) }],
          structuredContent: {
            executionId: data.id,
            status: data.status,
            nodeStates,
            outputs,
          },
        }
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "favorite_asset",
      {
        title: "Favorite Asset",
        description:
          "Mark or unmark a gallery asset as a favorite. Set `favorited` to true to add, false to remove.",
        inputSchema: {
          job_id: z.string().min(1),
          favorited: z.boolean(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (args) => {
        if (args.favorited) {
          // Ownership gate: only allow favoriting a job the caller may see
          // (own, or public+completed). Prevents storing favorites for another
          // tenant's private job (defense-in-depth alongside the scoped
          // hydration in list_favorites).
          const { data: visible } = await supabase
            .from("jobs")
            .select("id")
            .eq("id", args.job_id)
            .or(`user_id.eq.${session.userId},and(is_public.eq.true,status.eq.completed)`)
            .maybeSingle()
          if (!visible) {
            return {
              content: [{ type: "text", text: "Error: asset not found" }],
              isError: true,
            }
          }
          // Insert; ignore unique-violation duplicates so the call is idempotent.
          const { error } = await supabase
            .from("gallery_favorites")
            .insert({ user_id: session.userId, job_id: args.job_id })
          if (error && !/duplicate|unique/i.test(error.message)) {
            return {
              content: [{ type: "text", text: `Error: ${error.message}` }],
              isError: true,
            }
          }
          return {
            content: [
              { type: "text", text: `Favorited asset ${args.job_id}` },
            ],
          }
        }
        const { error } = await supabase
          .from("gallery_favorites")
          .delete()
          .eq("user_id", session.userId)
          .eq("job_id", args.job_id)
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        return {
          content: [
            { type: "text", text: `Unfavorited asset ${args.job_id}` },
          ],
        }
      },
    )
  }
}
