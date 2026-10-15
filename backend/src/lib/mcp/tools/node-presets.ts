import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { mcpInject } from "../internal-request.js"
import { supabase } from "../../supabase.js"
import { portablePresetData, presetCatalog } from "../../presets/app-presets.js"
import { factoryPresetView, referenceFields } from "../../presets/preset-view.js"
import { resolvePreset } from "../../presets/resolve-preset.js"
import { errorResult } from "./_verb-helpers.js"

const presetsReadGate: ToolGate = { required: ["presets:read"] }
// The scope the REST write routes ask an OAuth app for (lib/presets/write-access.ts).
const presetsWriteGate: ToolGate = { required: ["assets:write"] }

export interface RegisterPresetsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

type CustomRow = {
  id: string
  node_type: string
  name: string
  description: string | null
  data: Record<string, unknown> | null
  preview_url?: string | null
}

type ToolText = { content: Array<{ type: "text"; text: string }>; isError?: true }

const text = (value: string): ToolText => ({ content: [{ type: "text" as const, text: value }] })
const json = (value: unknown): ToolText => text(JSON.stringify(value, null, 2))

/**
 * What a listed preset says beyond its name, sparsely (a field appears only
 * when it says something): `needsImage` + `minReferences` for a preset that
 * works from connected photos, `favorite: true`, and `previewUrl` when it has
 * an example picture. An in-app (first-party) session never gets `previewUrl`:
 * its model is never handed a media address (ee/copilot allowlist-urls test).
 */
function sparseMeta(
  session: McpSession,
  meta: { minReferences: number; previewUrl: string | null },
  favorite: boolean,
): Record<string, unknown> {
  return {
    ...(meta.minReferences > 0 ? { needsImage: true, minReferences: meta.minReferences } : {}),
    ...(favorite ? { favorite: true } : {}),
    ...(meta.previewUrl && !session.firstParty ? { previewUrl: meta.previewUrl } : {}),
  }
}

/** The caller's favorites as `<nodeType>::<presetId>` keys (one node type, or all). */
async function favoriteKeys(userId: string, nodeType?: string): Promise<Set<string>> {
  let q = supabase.from("node_preset_favorites").select("node_type,preset_id").eq("user_id", userId)
  if (nodeType) q = q.eq("node_type", nodeType)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as Array<{ node_type: string; preset_id: string }>).map((r) => `${r.node_type}::${r.preset_id}`))
}

/**
 * Node presets over MCP. Reads under `presets:read` (as the REST reads), writes
 * under `assets:write` (as the REST writes) — each write is a call to its
 * route, so validation, ownership and the preview check are the route's own.
 * Preset folders, reorder and bulk import are left to REST / SDK / CLI: they
 * organise the editor's lists, which an agent has no use for.
 */
export function registerPresets({ server, session, fastify }: RegisterPresetsOpts): void {
  if (passesGate(session, presetsReadGate)) registerReads(server, session)
  if (passesGate(session, presetsWriteGate)) registerWrites(server, session, fastify)
}

function registerReads(server: McpServer, session: McpSession): void {
  /**
   * `list_node_presets` — discovery for saved node presets (presets:read). Lists the
   * user's own custom presets and/or the built-in factory catalog by node type. Names
   * + ids (+ the sparse metadata above); the full config via get_node_preset.
   */
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
        "names/ids/descriptions; `needsImage` marks presets that work from connected photos " +
        "(`minReferences` of them), `favorite` the user's favorites. Full config: get_node_preset.",
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
        const favorites = await favoriteKeys(session.userId, args.nodeType)

        if (source === "custom" || source === "all") {
          let q = supabase.from("node_presets").select("*").eq("user_id", session.userId)
          if (args.nodeType) q = q.eq("node_type", args.nodeType)
          const { data, error } = await q.order("created_at", { ascending: false })
          if (error) throw new Error(error.message)
          out.custom = ((data ?? []) as CustomRow[]).map((r) => {
            const portable = portablePresetData(r.node_type, r.data ?? {}) ?? {}
            return {
              id: r.id,
              nodeType: r.node_type,
              name: r.name,
              description: r.description ?? undefined,
              ...sparseMeta(
                session,
                { ...referenceFields(r.node_type, portable), previewUrl: r.preview_url ?? null },
                favorites.has(`${r.node_type}::${r.id}`),
              ),
            }
          })
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
            const nodeType = args.nodeType
            out.factory = presetCatalog(nodeType).map((p) => {
              const view = factoryPresetView(nodeType, p)
              return {
                id: p.id,
                name: p.name,
                description: p.description,
                group: p.group,
                ...sparseMeta(session, view, favorites.has(`${nodeType}::${p.id}`)),
              }
            })
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
        "aspect ratio, resolution, quality, negative prompt, and pre/post text (`promptPrefix` / " +
        "`promptSuffix` — wrapped around the prompt at run time) it ships. Use this to APPLY a " +
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
      const favorite = (await favoriteKeys(session.userId, args.nodeType)).has(`${args.nodeType}::${preset.id}`)
      const { previewUrl, ...rest } = preset
      return json({ ...rest, favorite, ...(session.firstParty ? {} : { previewUrl }) })
    },
  )
}

function registerWrites(server: McpServer, session: McpSession, fastify: FastifyInstance): void {
  server.registerTool(
    "save_node_preset",
    {
      title: "Save Node Preset",
      description:
        "Save one of the user's node presets. Without presetId it creates one (nodeType, name, data — a " +
        "node's config, e.g. what get_node_preset returns); with presetId it updates the name, description, " +
        "data or previewUrl. previewUrl: an image already stored on Nodaro (an upload or a finished " +
        "result); null removes it. Returns the saved preset.",
      inputSchema: {
        presetId: z.string().uuid().optional().describe("One of the user's preset ids (from list_node_presets)."),
        nodeType: z.string().min(1).max(120).optional().describe("Required to create, e.g. 'generate-image'."),
        name: z.string().min(1).max(120).optional().describe("Required to create; unique per node type."),
        description: z.string().max(500).optional(),
        data: z.record(z.string(), z.unknown()).optional().describe("The node config. Required to create."),
        previewUrl: z.string().url().max(2048).nullable().optional(),
        expectedUpdatedAt: z.string().max(64).optional().describe("The preset's updatedAt as you read it: refuse if it changed since."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const fields = {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.data !== undefined ? { data: args.data } : {}),
        ...(args.previewUrl !== undefined ? { previewUrl: args.previewUrl } : {}),
      }
      const creating = args.presetId === undefined
      if (creating && (args.nodeType === undefined || args.name === undefined || args.data === undefined)) {
        return { ...text("To create a preset pass nodeType, name and data (or presetId to update one)."), isError: true as const }
      }
      if (!creating && Object.keys(fields).length === 0) {
        return { ...text("Nothing to change — pass name, description, data or previewUrl."), isError: true as const }
      }
      const res = creating
        ? await mcpInject(fastify, session, { method: "POST", url: "/v1/node-presets", payload: { nodeType: args.nodeType, ...fields } })
        : await mcpInject(fastify, session, {
            method: "PATCH",
            url: `/v1/node-presets/${encodeURIComponent(args.presetId!)}`,
            payload: { ...fields, ...(args.expectedUpdatedAt ? { expectedUpdatedAt: args.expectedUpdatedAt } : {}) },
          })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const p = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
      return json({
        saved: creating ? "created" : "updated",
        id: p.id,
        nodeType: p.nodeType,
        name: p.name,
        description: p.description,
        needsImage: p.needsImage,
        minReferences: p.minReferences,
        ...(session.firstParty ? {} : { previewUrl: p.previewUrl }),
        updatedAt: p.updatedAt,
      })
    },
  )

  server.registerTool(
    "delete_node_preset",
    {
      title: "Delete Node Preset",
      description: "Delete one of the user's node presets (factory presets cannot be deleted).",
      inputSchema: {
        presetId: z.string().uuid().describe("One of the user's preset ids (from list_node_presets)."),
        expectedUpdatedAt: z.string().max(64).optional().describe("The preset's updatedAt as you read it: refuse if it changed since."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      const res = await mcpInject(fastify, session, {
        method: "DELETE",
        url: `/v1/node-presets/${encodeURIComponent(args.presetId)}`,
        ...(args.expectedUpdatedAt ? { query: { expectedUpdatedAt: args.expectedUpdatedAt } } : {}),
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      return text(`Deleted preset ${args.presetId}.`)
    },
  )

  server.registerTool(
    "favorite_node_preset",
    {
      title: "Favorite Node Preset",
      description:
        "Add a preset (a factory id like 'generate-image/character-board', or one of the user's) to the " +
        "user's favorites — or remove it with favorite: false. Favorites lead the editor's preset list.",
      inputSchema: {
        nodeType: z.string().min(1).max(120).describe("e.g. 'generate-image'"),
        presetId: z.string().min(1).max(200).describe("Preset id from list_node_presets."),
        favorite: z.boolean().optional().describe("false removes it (default true)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const res =
        args.favorite === false
          ? await mcpInject(fastify, session, {
              method: "DELETE",
              url: "/v1/node-presets/favorites",
              query: { nodeType: args.nodeType, presetId: args.presetId },
            })
          : await mcpInject(fastify, session, {
              method: "POST",
              url: "/v1/node-presets/favorites",
              payload: { nodeType: args.nodeType, presetId: args.presetId },
            })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      return text(args.favorite === false ? `Removed ${args.presetId} from favorites.` : `Added ${args.presetId} to favorites.`)
    },
  )
}
