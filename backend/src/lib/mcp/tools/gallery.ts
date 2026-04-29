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
  "generate-location",
  "generate-location-asset",
])

const VIDEO_JOBS = new Set([
  "image-to-video",
  "text-to-video",
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
  return {
    jobId: row.id,
    kind,
    prompt: (row.input_data?.prompt as string | undefined) ?? "",
    model: (row.input_data?.provider as string | undefined) ?? row.provider ?? "?",
    thumbnailUrl,
    assetUrl,
    createdAt: row.completed_at ?? "",
    favorited: false,
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
export function registerGallery({ server, session }: RegisterGalleryOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "browse_gallery",
      {
        title: "Browse Gallery",
        description:
          "Browse the public Nodaro gallery (most-recent first). Returns one line per item with id, kind, prompt, model, and date.",
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z
            .string()
            .optional()
            .describe("ISO `completed_at` timestamp from a prior result's next_cursor"),
          kind: z.enum(["image", "video", "audio"]).optional(),
        },
        annotations: { readOnlyHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/gallery",
        ui: {
          resourceUri: "ui://nodaro/widget/gallery",
          visibility: ["model", "app"],
        },
      },
      },
      async (args) => {
        const limit = args.limit ?? 20
        let query = supabase
          .from("jobs")
          .select(
            "id, job_type, input_data, output_data, completed_at, provider",
          )
          .eq("is_public", true)
          .eq("status", "completed")
          .not("output_data", "is", null)
          .order("completed_at", { ascending: false })
          .limit(limit)
        if (args.cursor) query = query.lt("completed_at", args.cursor)
        if (args.kind) {
          query = query.in("job_type", jobNamesForKind(args.kind))
        } else {
          query = query.in("job_type", [
            ...IMAGE_JOBS,
            ...VIDEO_JOBS,
            ...AUDIO_JOBS,
          ])
        }
        const { data, error } = await query
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        const rows = (data ?? []) as GalleryRow[]
        const last = rows[rows.length - 1]
        const nextCursor =
          rows.length === limit && last?.completed_at ? last.completed_at : null
        const lines = rows.map(formatRow)
        const cursorLine = nextCursor
          ? `\n(next_cursor: ${nextCursor} — call browse_gallery again with this cursor)`
          : ""
        const text = lines.length > 0 ? lines.join("\n") + cursorLine : "(no items)"

        const items = rows
          .map(rowToGalleryItem)
          .filter((item): item is GalleryItem => item !== null)

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
      "list_favorites",
      {
        title: "List Favorites",
        description:
          "List the authenticated user's favorited gallery items (most-recent first). Returns the favorite job_ids.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional(),
        },
        annotations: { readOnlyHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/gallery",
        ui: {
          resourceUri: "ui://nodaro/widget/gallery",
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
          "Fetch metadata for a single asset (job) by id, including its output URL, prompt, and provider.",
        inputSchema: {
          job_id: z.string().min(1),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { data, error } = await supabase
          .from("jobs")
          .select(
            "id, status, progress, job_type, input_data, output_data, created_at, completed_at, credits, display_cost, user_id",
          )
          .eq("id", args.job_id)
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
          null
        const assetKind = out.imageUrl
          ? "image"
          : out.videoUrl
            ? "video"
            : out.audioUrl
              ? "audio"
              : null

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
