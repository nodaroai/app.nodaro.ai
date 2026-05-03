import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import type { ComponentMetadata } from "@nodaro/shared"
import {
  extractComponentInputSchema,
  flatInputsToOverrides,
} from "../extract-app-inputs.js"

const readGate: ToolGate = { required: ["workflows:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterComponentsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Components — published workflow snippets that other workflows can call.
 *
 * Same pure-discovery pattern as apps:
 *   1. `list_components({ scope })` — find by intent (public marketplace
 *      or "mine").
 *   2. `get_component_inputs({ slug })` — typed input schema (uses the
 *      already-typed `component_metadata.inputs` directly, no
 *      presentation-layer parsing needed).
 *   3. `run_component({ component_id, inputs })` — flat keyed inputs.
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
          'Browse Nodaro components (reusable workflow snippets). Set `scope: "public"` (default) for the marketplace, or `scope: "mine"` for the caller\'s own components.',
        inputSchema: {
          scope: z
            .enum(["public", "mine"])
            .optional()
            .describe('"public" = marketplace (default); "mine" = caller\'s own components'),
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z.string().optional().describe("Cursor from a prior call"),
          search: z.string().max(100).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        const scope = args.scope ?? "public"
        let query = supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, icon_url, estimated_credits, category, tags, total_run_count, created_at",
          )
          .eq("is_active", true)
          .eq("publish_type", "component")
          .order("created_at", { ascending: false })
          .limit(limit)
        if (scope === "mine") {
          if (!session.userId) {
            return {
              content: [{ type: "text", text: 'scope="mine" requires authentication.' }],
              isError: true,
            }
          }
          query = query.eq("creator_id", session.userId)
        } else {
          query = query.eq("is_listed", true)
        }
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
              text: JSON.stringify(
                { data: rows, scope, next_cursor: nextCursor },
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    server.registerTool(
      "get_component_inputs",
      {
        title: "Get Component Inputs",
        description:
          "Return the typed input schema for a component. Each entry has `key`, `label`, `type`, `required`. Pass these `key`s to `run_component({ component_id, inputs })`.",
        inputSchema: {
          component_id: z
            .string()
            .min(1)
            .describe("Component slug (matches the published_apps.slug)"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { data, error } = await supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, component_metadata, is_listed, creator_id, is_active, publish_type",
          )
          .eq("slug", args.component_id)
          .eq("publish_type", "component")
          .eq("is_active", true)
          .limit(1)
          .single()
        if (error || !data) {
          return {
            content: [
              { type: "text", text: `Component "${args.component_id}" not found.` },
            ],
            isError: true,
          }
        }
        if (
          !data.is_listed &&
          (!session.userId || data.creator_id !== session.userId)
        ) {
          return {
            content: [
              { type: "text", text: `Component "${args.component_id}" not found.` },
            ],
            isError: true,
          }
        }
        const schema = extractComponentInputSchema(
          data.component_metadata as ComponentMetadata | null,
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  slug: data.slug,
                  name: data.name,
                  description: data.description,
                  inputs: schema.fields,
                },
                null,
                2,
              ),
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
          "Execute a published component by slug. `inputs` is a FLAT object keyed by the schema's input keys (call `get_component_inputs` first). Returns a job_id; the wrapper job's output_data carries the component's outputs once complete.",
        inputSchema: {
          component_id: z
            .string()
            .min(1)
            .describe("Component slug (matches the published_apps.slug)"),
          inputs: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Flat input map keyed by schema key (from get_component_inputs). Omit to use defaults.",
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        let inputOverrides:
          | Record<string, Record<string, unknown>>
          | undefined
        if (args.inputs && Object.keys(args.inputs).length) {
          const { data: row } = await supabase
            .from("published_apps")
            .select("component_metadata")
            .eq("slug", args.component_id)
            .eq("publish_type", "component")
            .eq("is_active", true)
            .limit(1)
            .single()
          if (row) {
            const schema = extractComponentInputSchema(
              row.component_metadata as ComponentMetadata | null,
            )
            inputOverrides = flatInputsToOverrides(args.inputs, schema.keyMap)
          }
        }
        const payload = {
          appSlug: args.component_id,
          inputOverrides,
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
