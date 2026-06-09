import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { getFactoryPresets } from "@nodaro/shared"

const presetsReadGate: ToolGate = { required: ["presets:read"] }

export interface RegisterPresetsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

type CustomRow = { id: string; node_type: string; name: string; description: string | null }

/**
 * `list_node_presets` — discovery for saved node presets (presets:read). Lists the
 * user's own custom presets and/or the built-in factory catalog by node type. Names
 * + ids only (discovery); the full config `data` is available via the REST API / SDK
 * (`GET /v1/node-presets`, `GET /v1/node-presets/factory`). Omitted entirely when the
 * session lacks `presets:read`.
 */
export function registerPresets({ server, session }: RegisterPresetsOpts): void {
  if (!passesGate(session, presetsReadGate)) return

  server.registerTool(
    "list_node_presets",
    {
      title: "List Node Presets",
      description:
        "List saved node presets — reusable named node configurations. `source` picks your own " +
        "custom presets ('custom', default), the built-in factory catalog ('factory'), or both ('all'). " +
        "Pass `nodeType` (e.g. 'generate-image') to filter; it is REQUIRED for factory presets. " +
        "Returns names/ids/descriptions for discovery — fetch the full config via the REST API/SDK.",
      inputSchema: {
        nodeType: z
          .string()
          .optional()
          .describe("Filter to one node type, e.g. 'generate-image'. Required when source includes factory."),
        source: z
          .enum(["custom", "factory", "all"])
          .optional()
          .describe("Which presets to return. Default 'custom' (your saved presets)."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const source = args.source ?? "custom"
        const out: Record<string, unknown> = {}

        if (source === "custom" || source === "all") {
          let q = supabase
            .from("node_presets")
            .select("id,node_type,name,description")
            .eq("user_id", session.userId)
          if (args.nodeType) q = q.eq("node_type", args.nodeType)
          const { data, error } = await q.order("created_at", { ascending: false })
          if (error) throw new Error(error.message)
          out.custom = ((data ?? []) as CustomRow[]).map((r) => ({
            id: r.id,
            nodeType: r.node_type,
            name: r.name,
            description: r.description ?? undefined,
          }))
        }

        if (source === "factory" || source === "all") {
          if (!args.nodeType) {
            return {
              content: [{ type: "text", text: "nodeType is required to list factory presets." }],
              isError: true,
            }
          }
          out.factory = getFactoryPresets(args.nodeType).map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            group: p.group,
          }))
        }

        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : "unknown"}` }],
          isError: true,
        }
      }
    },
  )
}
