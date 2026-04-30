import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"

const appsReadGate: ToolGate = { required: ["apps:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterAppsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Apps tools.
 *
 * `list_apps` browses the marketplace (public). `run_app` runs a published
 * app by slug via `/v1/app/:slug/run` — the runner pays for credits, and
 * the route returns 202 + executionId.
 */
export function registerApps({ server, session, fastify }: RegisterAppsOpts): void {
  if (passesGate(session, appsReadGate)) {
    server.registerTool(
      "list_apps",
      {
        title: "List Apps",
        description:
          "Browse published apps on the Nodaro marketplace. Apps are end-user workflows that can be run by anyone with credits.",
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z.string().optional(),
          search: z.string().max(100).optional(),
          category: z.string().max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        let query = supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, icon_url, estimated_credits, category, output_types, tags, total_run_count, favorite_count, created_at",
          )
          .eq("is_listed", true)
          .eq("is_active", true)
          .eq("publish_type", "app")
          .order("created_at", { ascending: false })
          .limit(limit)
        if (args.cursor) query = query.lt("created_at", args.cursor)
        if (args.category) query = query.eq("category", args.category)
        if (args.search) {
          const tsQuery = args.search.trim().split(/\s+/).join(" & ")
          query = query.textSearch("search_vector", tsQuery)
        }
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
  }

  if (passesGate(session, executeGate)) {
    server.registerTool(
      "run_app",
      {
        title: "Run App",
        description:
          "Run a published app by slug. The caller pays for credits. Returns an execution_id; poll via tasks/get.",
        inputSchema: {
          slug: z.string().min(1).describe("App slug, e.g. 'photo-restoration'"),
          inputs: z
            .record(z.string(), z.record(z.string(), z.unknown()))
            .optional()
            .describe("Per-node input overrides keyed by node id"),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        const payload = {
          inputOverrides: args.inputs,
          mcp_client: session.clientName,
          userId: session.userId,
        }
        const res = await fastify.inject({
          method: "POST",
          url: `/v1/app/${encodeURIComponent(args.slug)}/run`,
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          payload,
        })
        if (res.statusCode >= 400) {
          return {
            content: [
              { type: "text", text: `Error from Nodaro: ${res.statusCode} ${res.body}` },
            ],
            isError: true,
          }
        }
        let executionId: string | undefined
        try {
          const body = JSON.parse(res.body) as { executionId?: string }
          executionId = body.executionId
        } catch {
          /* fall through */
        }
        if (!executionId) {
          return {
            content: [
              {
                type: "text",
                text: `Submitted but couldn't parse execution_id: ${res.body}`,
              },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Started app '${args.slug}' (id ${executionId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/library`,
            },
          ],
          structuredContent: { executionId, slug: args.slug },
        }
      },
    )
  }
}
