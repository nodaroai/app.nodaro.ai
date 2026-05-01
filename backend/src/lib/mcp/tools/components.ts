import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"

const readGate: ToolGate = { required: ["workflows:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterComponentsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Components — published workflow snippets that other workflows can call.
 * `list_components` browses the marketplace (public, no auth needed —
 * `published_apps` rows are world-readable when `is_listed=true`).
 * `run_component` calls `/v1/component/execute`, which creates a wrapper
 * job and runs the inner workflow asynchronously (returns 202 + jobId).
 */
export function registerComponents({
  server,
  session,
  fastify,
}: RegisterComponentsOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_components",
      {
        title: "List Components",
        description:
          "Browse published components (reusable workflow snippets) on the Nodaro marketplace.",
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z.string().optional().describe("Cursor from a prior call"),
          search: z.string().max(100).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        let query = supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, icon_url, estimated_credits, category, tags, total_run_count, created_at",
          )
          .eq("is_listed", true)
          .eq("is_active", true)
          .eq("publish_type", "component")
          .order("created_at", { ascending: false })
          .limit(limit)
        if (args.cursor) query = query.lt("created_at", args.cursor)
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
      "run_component",
      {
        title: "Run Component",
        description:
          "Execute a published component by slug. Returns a job_id; the wrapper job's output_data carries the component's outputs once complete.",
        inputSchema: {
          component_id: z
            .string()
            .min(1)
            .describe("Component slug (matches the published_apps.slug)"),
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
          appSlug: args.component_id,
          inputOverrides: args.inputs,
          mcp_client: session.clientName,
          userId: session.userId,
        }
        const res = await fastify.inject({
          method: "POST",
          url: "/v1/component/execute",
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
        let jobId: string | undefined
        try {
          const body = JSON.parse(res.body) as {
            jobId?: string
            job_id?: string
            id?: string
          }
          jobId = body.jobId ?? body.job_id ?? body.id
        } catch {
          /* fall through */
        }
        if (!jobId) {
          return {
            content: [
              {
                type: "text",
                text: `Submitted but couldn't parse job_id: ${res.body}`,
              },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Started component '${args.component_id}' (job ${jobId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/gallery`,
            },
          ],
          structuredContent: { jobId, componentId: args.component_id },
        }
      },
    )
  }
}
