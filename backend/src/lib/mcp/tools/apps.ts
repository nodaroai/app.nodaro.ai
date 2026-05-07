import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import {
  extractAppInputSchema,
  flatInputsToOverrides,
} from "../extract-app-inputs.js"

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
 * The pure-discovery model:
 *   1. `list_apps({ scope: "public" | "mine" })` — find apps by intent.
 *   2. `get_app_inputs({ slug })` — read the typed input schema before
 *      planning the call.
 *   3. `run_app({ slug, inputs })` — execute. `inputs` is FLAT keyed by
 *      the schema keys (not node-id) — server translates back via the
 *      schema's keyMap before sending to /v1/app/:slug/run.
 *
 * Per-user dynamic `app_<slug>` tools were dropped: they didn't scale,
 * they competed with the verb tools, and the prefer-verbs nudge in
 * their descriptions was a sign they didn't belong as first-class
 * tools.
 */
export function registerApps({ server, session, fastify }: RegisterAppsOpts): void {
  if (passesGate(session, appsReadGate)) {
    server.registerTool(
      "list_apps",
      {
        title: "List Apps",
        description:
          'Browse Nodaro apps — user-published workflows that do things the verb ' +
          'tools (generate_image / modify_image / etc.) don\'t cover on their own. ' +
          'Examples of apps live on the marketplace: "zebrify" (dress a subject as ' +
          'a zebra), "draw-me" (turn a photo into a sketch), "photo-shoot" ' +
          '(studio-lit portrait), "tidy-up" (clean up a room), "traveler" (place ' +
          'subject in a new location), "storyboard", "hair-styler", "jump", ' +
          '"dance", "material-letters". The full list grows over time — search by ' +
          'topic to find more.\n\n' +
          '**When to call this tool:** if the user asks for ANYTHING that doesn\'t ' +
          'match a direct verb tool — especially novel transformations, themed ' +
          'edits, or composite pipelines — search apps first with the relevant ' +
          'term before answering "I can\'t do that". Then call `get_app_inputs` ' +
          'on the chosen slug to learn what it needs, and `run_app` to execute.\n\n' +
          'Set `scope: "public"` (default) for the marketplace, or `scope: "mine"` ' +
          'for the caller\'s own published apps.',
        inputSchema: {
          scope: z
            .enum(["public", "mine"])
            .optional()
            .describe('"public" = marketplace (default); "mine" = caller\'s own apps'),
          limit: z.number().int().min(1).max(50).optional(),
          cursor: z.string().optional(),
          search: z.string().max(100).optional(),
          category: z.string().max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        const scope = args.scope ?? "public"
        let query = supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, icon_url, estimated_credits, category, output_types, tags, total_run_count, favorite_count, created_at",
          )
          .eq("is_active", true)
          .eq("publish_type", "app")
          .is("deleted_at", null)
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
      "get_app_inputs",
      {
        title: "Get App Inputs",
        description:
          "Return the typed input schema for an app. Each entry has a `key`, `label`, `type` (image / video / audio / text / select / number / boolean / list), `required`, and optional `options` for selects. Pass these `key`s to `run_app({ slug, inputs })`.",
        inputSchema: {
          slug: z.string().min(1).describe("App slug, e.g. 'photo-restoration'"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const { data, error } = await supabase
          .from("published_apps")
          .select(
            "id, slug, name, description, snapshot_settings, snapshot_nodes, is_listed, creator_id, is_active, publish_type",
          )
          .eq("slug", args.slug)
          .eq("publish_type", "app")
          .eq("is_active", true)
          .is("deleted_at", null)
          .limit(1)
          .single()
        if (error || !data) {
          return {
            content: [{ type: "text", text: `App "${args.slug}" not found.` }],
            isError: true,
          }
        }
        // Auth check: public apps are world-readable; private apps only the creator.
        if (
          !data.is_listed &&
          (!session.userId || data.creator_id !== session.userId)
        ) {
          return {
            content: [{ type: "text", text: `App "${args.slug}" not found.` }],
            isError: true,
          }
        }
        const schema = extractAppInputSchema({
          snapshotSettings: data.snapshot_settings as Record<string, unknown> | null,
          snapshotNodes: data.snapshot_nodes as
            | Array<{ id: string; type?: string; data?: Record<string, unknown> }>
            | null,
        })
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  slug: data.slug,
                  name: data.name,
                  description: data.description,
                  // Don't leak the keyMap (internal node-id mapping).
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
      "run_app",
      {
        title: "Run App",
        description:
          "Run a published app by slug. The caller pays for credits. `inputs` is a FLAT object keyed by the schema's input keys (call `get_app_inputs` first to learn them). Returns an execution_id.",
        inputSchema: {
          slug: z.string().min(1).describe("App slug, e.g. 'photo-restoration'"),
          inputs: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Flat input map keyed by schema key (from get_app_inputs). Omit to use defaults.",
            ),
        },
        outputSchema: {
          executionId: z.string(),
          slug: z.string().optional(),
          name: z.string().optional(),
          status: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: {
          "ui/resourceUri": "ui://nodaro/widget/v3/app-run",
          ui: {
            resourceUri: "ui://nodaro/widget/v3/app-run",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        // Single DB read for the app row covers BOTH the input-translation
        // schema (when args.inputs is provided) AND the widget header's
        // app name. Cheaper than two reads, and the widget's name is
        // important enough to justify always fetching it.
        const { data: appRow } = await supabase
          .from("published_apps")
          .select("name, snapshot_settings, snapshot_nodes")
          .eq("slug", args.slug)
          .eq("publish_type", "app")
          .eq("is_active", true)
          .is("deleted_at", null)
          .limit(1)
          .single()

        let inputOverrides: Record<string, Record<string, unknown>> | undefined
        if (appRow && args.inputs && Object.keys(args.inputs).length) {
          const schema = extractAppInputSchema({
            snapshotSettings: appRow.snapshot_settings as Record<string, unknown> | null,
            snapshotNodes: appRow.snapshot_nodes as
              | Array<{ id: string; type?: string; data?: Record<string, unknown> }>
              | null,
          })
          inputOverrides = flatInputsToOverrides(args.inputs, schema.keyMap)
        }

        const payload = {
          inputOverrides,
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
        const appName = (appRow?.name as string | undefined) ?? args.slug
        return {
          content: [
            {
              type: "text" as const,
              text: `Started app '${args.slug}' (id ${executionId}). It will appear at the top of your Nodaro library when ready: https://app.nodaro.ai/gallery`,
            },
          ],
          structuredContent: {
            executionId,
            slug: args.slug,
            name: appName,
            status: "queued",
          },
        }
      },
    )

    // ── delete_app_run ──
    // Soft-deletes (archives) a run. Restoration and permanent deletion are
    // intentionally only available from the Nodaro web UI — this protects
    // users from MCP tools accidentally destroying their data.
    server.registerTool(
      "delete_app_run",
      {
        title: "Archive App Run",
        description:
          "Move a published-app run to the user's archive. The run is removed from the active list but can be restored or permanently deleted from https://app.nodaro.ai/archived-runs. Use when the user asks to delete or remove a run by ID.",
        inputSchema: {
          slug: z.string().min(1).describe("The published app's slug (last path segment of the app URL)."),
          runId: z.string().uuid().describe("The run's UUID."),
        },
      },
      async (args) => {
        const res = await fastify.inject({
          method: "DELETE",
          url: `/v1/app/${encodeURIComponent(args.slug)}/runs/${encodeURIComponent(args.runId)}`,
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          payload: { userId: session.userId },
        })
        if (res.statusCode >= 400) {
          return {
            content: [
              { type: "text", text: `Failed to archive run: ${res.statusCode} ${res.body}` },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Archived run ${args.runId}. Restore or permanently delete from https://app.nodaro.ai/archived-runs.`,
            },
          ],
          structuredContent: {
            slug: args.slug,
            runId: args.runId,
            archived: true,
          },
        }
      },
    )
  }
}
