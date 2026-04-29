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
      title: "List Jobs",
      description:
        "List the authenticated user's recent jobs (most recent first). Cursor-based pagination via the returned `next_cursor` field.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z
          .string()
          .optional()
          .describe("ISO `created_at` timestamp from a prior result's `next_cursor`"),
        status: z
          .enum(["pending", "queued", "processing", "completed", "failed", "cancelled"])
          .optional(),
        kind: z
          .enum(["image", "video", "audio"])
          .optional()
          .describe(
            "Filter by media kind. 'image' covers generate-image, image-to-image, etc.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 20
      let query = supabase
        .from("jobs")
        .select(
          "id, status, progress, input_data, output_data, error_message, created_at, completed_at, job_type, credits, display_cost",
        )
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(limit)
      if (args.cursor) query = query.lt("created_at", args.cursor)
      if (args.status) query = query.eq("status", args.status)
      const { data, error } = await query
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      let rows = data ?? []
      if (args.kind) {
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
        const allowed = new Set(setForKind[args.kind] ?? [])
        rows = rows.filter((r) => r.job_type && allowed.has(r.job_type as string))
      }
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
          "id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, job_type, credits, display_cost, user_id",
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
