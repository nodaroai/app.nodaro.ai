import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"

const jobsReadGate: ToolGate = { required: ["jobs:read"] }

export interface RegisterJobsOpts {
  server: McpServer
  session: McpSession
  /**
   * Kept on the opts shape for symmetry with other registrars and so a
   * future v1.2 tool can hop to `app.inject()` if a route grows MCP-specific
   * shaping. The current handlers query Supabase directly because the GET
   * endpoints' Fastify auth path requires `req.userId` set from a request
   * body, and GETs have no body.
   */
  fastify: FastifyInstance
}

/**
 * Job-discovery tools.
 *
 * v1.1 only ships single-shot reads (`list_jobs`, `get_job`); v1.2 will add
 * `tasks/get` long-poll for in-flight jobs. We query Supabase directly,
 * filtered by `session.userId`, because:
 *  1. The OAuth scope (`jobs:read`) is already gated at the MCP layer.
 *  2. The HTTP routes' user resolution path doesn't apply for GETs over
 *     `fastify.inject()` (no body to carry `userId`).
 */
export function registerJobs({ server, session }: RegisterJobsOpts): void {
  if (!passesGate(session, jobsReadGate)) return

  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs (raw data)",
      description:
        "Raw structured listing of the user's jobs. Returns JSON only — " +
        "no widget, no thumbnails. Use `browse_gallery` instead when the " +
        "user wants to SEE their gallery / library (renders a clickable " +
        "image grid). Use this tool only when the agent needs structured " +
        "fields (status, error_message, credits, timestamps) for " +
        "programmatic logic — e.g. \"how many failed yesterday\", \"how " +
        "many credits did I burn this week\".",
      inputSchema: {
        scope: z
          .enum(["mine", "public"])
          .optional()
          .describe(
            "`mine` (default) returns the authenticated user's own " +
            "library. `public` returns recent public outputs from " +
            "OTHER users (excludes the caller's own items, mirroring " +
            "the web app's public gallery) — only use when the user " +
            "explicitly asks for the public gallery / trending / what " +
            "others are making.",
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
          .describe("ISO `created_at` timestamp from a prior result's `next_cursor`"),
        status: z
          .enum(["pending", "queued", "processing", "completed", "failed", "cancelled"])
          .optional(),
        kinds: z
          .array(z.enum(["image", "video", "audio"]))
          .min(1)
          .optional()
          .describe(
            "Media kinds to include. Default: `[\"image\", \"video\"]` " +
            "— skips audio because most users browse visual generations. " +
            "Pass any combination explicitly: `[\"audio\"]` for music / " +
            "TTS only, `[\"image\", \"video\", \"audio\"]` for " +
            "everything, etc.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 50
      const scope = args.scope ?? "mine"
      // display_cost (USD) intentionally excluded — MCP surfaces only the
      // credits abstraction; raw $ pricing is internal/admin and distracts
      ***REDACTED-OSS-SCRUB***
      // every job before this was stripped).
      const baseSelect =
        "id, status, progress, input_data, output_data, error_message, created_at, completed_at, job_type, credits"
      // Build the filter chain BEFORE order/limit so the supabase mock
      // chain in tests (.from().select().eq().order().limit()) matches.
      // For the public gallery, force is_public=true, status=completed,
      // AND user_id != caller — same as the web app's public gallery
      // which never shows the caller their own items.
      let filtered =
        scope === "mine"
          ? supabase.from("jobs").select(baseSelect).eq("user_id", session.userId)
          : supabase
              .from("jobs")
              .select(baseSelect)
              .eq("is_public", true)
              .eq("status", "completed")
              .neq("user_id", session.userId)
      if (args.cursor) filtered = filtered.lt("created_at", args.cursor)
      if (scope === "mine" && args.status) filtered = filtered.eq("status", args.status)
      const query = filtered.order("created_at", { ascending: false }).limit(limit)
      const { data, error } = await query
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      let rows = data ?? []
      // Map of media kind → set of job_type strings that produce that
      // media. Filtering happens in JS rather than in the SQL query so a
      // multi-kind selection (e.g. ["image", "video"]) is just a set
      // union — keeps the query simple and avoids a giant `.in(...)`.
      const setForKind: Record<string, string[]> = {
        image: [
          "generate-image",
          "image-to-image",
          "edit-image",
          "generate-character",
          "generate-character-asset",
          "generate-location",
          "generate-location-asset",
          "generate-object",
          "generate-object-asset",
        ],
        video: [
          "image-to-video",
          "text-to-video",
          "video-to-video",
          "lip-sync",
          "motion-transfer",
          "extend-video",
          "combine-videos",
          "add-captions",
          "extract-frame",
        ],
        audio: [
          "text-to-speech",
          "generate-music",
          "text-to-audio",
          "extract-youtube-audio",
        ],
      }
      // Default kinds: image + video. Audio is opt-in because most users
      // browse for visual generations; surfacing TTS / music outputs by
      // default clutters the gallery view. Caller can pass `["audio"]`
      // or `["image","video","audio"]` etc. for any combination.
      const kinds = args.kinds ?? ["image", "video"]
      const allowed = new Set(kinds.flatMap((k) => setForKind[k] ?? []))
      rows = rows.filter((r) => r.job_type && allowed.has(r.job_type as string))
      const last = rows[rows.length - 1]
      const nextCursor =
        rows.length === limit && last?.created_at ? (last.created_at as string) : null
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: rows, next_cursor: nextCursor }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    "get_job",
    {
      title: "Get Job",
      description:
        "Fetch a single job by id. Returns its status, output_data (when complete), credits used, and timestamps.",
      inputSchema: {
        job_id: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          // display_cost (USD) excluded — see list_jobs comment above.
          "id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, job_type, credits, user_id",
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
          content: [{ type: "text", text: `Job ${args.job_id} not found` }],
          isError: true,
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }],
      }
    },
  )
}
