import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { getFactoryPresets } from "@nodaro/shared"
import { resolvePreset } from "../../presets/resolve-preset.js"

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
        "Discover the presets / templates / starting configurations available for a node type — " +
        "e.g. what presets exist for `generate-image`. Returns the built-in FACTORY catalog (named " +
        "templates like 'Character Board', 'Cinematic Portrait') AND the user's saved CUSTOM presets. " +
        "`source`: 'all' (default) returns both, 'factory' built-ins only, 'custom' the user's only. " +
        "Pass `nodeType` (e.g. 'generate-image') — REQUIRED to include factory presets. Returns " +
        "names/ids/descriptions for discovery; fetch a preset's full config via the REST API/SDK.",
      inputSchema: {
        nodeType: z
          .string()
          .optional()
          .describe(
            "Node type to list presets for, e.g. 'generate-image'. REQUIRED to include factory presets " +
              "(omitted under the 'all' default just skips factory and returns a hint).",
          ),
        source: z
          .enum(["custom", "factory", "all"])
          .optional()
          .describe("Which presets to return: 'all' (default — factory + your saved), 'factory', or 'custom'."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const source = args.source ?? "all"
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
            // Explicit factory-only request needs a nodeType — hard-error
            // (back-compat). Under the "all" default we instead skip factory
            // and hint the caller, so a bare call still succeeds.
            if (source === "factory") {
              return {
                content: [
                  {
                    type: "text",
                    text: 'Pass nodeType to list factory presets, e.g. { nodeType: "generate-image" }.',
                  },
                ],
                isError: true,
              }
            }
            out.factoryNote =
              'Pass nodeType (e.g. "generate-image") to also list built-in factory presets.'
          } else {
            out.factory = getFactoryPresets(args.nodeType).map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              group: p.group,
            }))
          }
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

  // `get_node_preset` — READ one preset's full config by id (presets:read, same
  // gate as list_node_presets above). Wraps `resolvePreset`: factory catalog
  // first, then the caller's own custom presets (owner-scoped via session.userId
  // — never returns another user's preset). The returned `data` is already
  // `extractPresetData`-stripped, so a caller can apply it to a node directly.
  server.registerTool(
    "get_node_preset",
    {
      title: "Get Node Preset",
      description:
        "Fetch ONE preset's full saved configuration by id — the provider/model, prompt, " +
        "aspect ratio, resolution, quality, and negative prompt it ships. Use this to APPLY a " +
        "preset faithfully: get the id from list_node_presets, then either read these fields and " +
        "pass them to the matching generate_* tool, or pass `presetId` directly to generate_image. " +
        "Works for built-in (factory) and your own custom presets.",
      inputSchema: {
        nodeType: z.string().min(1).max(120).describe("e.g. 'generate-image'"),
        presetId: z
          .string()
          .min(1)
          .max(200)
          .describe("Preset id from list_node_presets (factory slug or custom uuid)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args: { nodeType: string; presetId: string }) => {
      const preset = await resolvePreset({
        nodeType: args.nodeType,
        presetId: args.presetId,
        userId: session.userId,
      })
      if (!preset) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Preset not found: ${args.presetId} (nodeType=${args.nodeType}). List ids with list_node_presets.`,
            },
          ],
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(preset, null, 2) }] }
    },
  )
}
