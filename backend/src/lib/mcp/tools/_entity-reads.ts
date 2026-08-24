/**
 * The list/get read pair for a saved-entity kind.
 *
 * Objects and creatures are the same tool twice over — same scoping, same
 * search, same summary/detail split — differing only in table name, one or two
 * columns, and which variant buckets they carry. Written once here so the two
 * cannot drift, which is precisely what happened to the four kinds already:
 * characters and locations grew read tools, objects and creatures never did,
 * and their MCP files still say the reads are "DEFERRED".
 *
 * Why not the REST routes: `GET /v1/objects` returns every row with every
 * media URL inline, unpaginated and unsearchable. A model asking "which props
 * do I have?" would get tens of kilobytes of R2 addresses and blow the
 * tool-result cap. The list here returns COUNTS; the urls live behind `get_*`,
 * one entity at a time, which is the shape `list_characters` settled on.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { supabase } from "../../supabase.js"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { escapeLikeArgument } from "./_like-escape.js"
import { entityOwnerFilter } from "./_entity-scope.js"

const readGate: ToolGate = { required: ["assets:read"] }

/** `{name, url}[]` buckets are summarized as counts; `get_*` returns them whole. */
type AssetEntry = { name?: string; url?: string }

export interface EntityReadConfig {
  /** Postgres table, and the `list_<table>` / `get_<singular>` tool names. */
  readonly table: "objects" | "creatures"
  readonly singular: "object" | "creature"
  /** Title-cased, for tool titles and the not-found message. */
  readonly Label: "Object" | "Creature"
  /** Human words for the tool description — what this kind IS to a user. */
  readonly blurb: string
  readonly summaryColumns: string
  readonly fullColumns: string
  /** Snake-case columns holding `{name,url}[]`, counted in the summary. */
  readonly buckets: readonly string[]
  /** Snake-case scalar columns that ride along in the summary (e.g. species). */
  readonly summaryExtras: readonly string[]
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] }
}
function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function summarize(row: Record<string, unknown>, cfg: EntityReadConfig) {
  const counts: Record<string, number> = {}
  for (const bucket of cfg.buckets) {
    const value = row[bucket]
    counts[camel(bucket)] = Array.isArray(value) ? (value as AssetEntry[]).length : 0
  }
  const extras: Record<string, unknown> = {}
  for (const column of cfg.summaryExtras) extras[camel(column)] = row[column] ?? null
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    canonicalDescription: row.canonical_description ?? null,
    category: row.category ?? null,
    style: row.style ?? null,
    // The one URL a summary carries — enough to recognise the thing.
    imageUrl: row.source_image_url ?? null,
    ...extras,
    assetCounts: counts,
    updatedAt: row.updated_at,
  }
}

/** Every selected column, camel-cased. The column list IS the projection. */
function detail(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    // Never hand the model the owner id or the tombstone — neither is its business.
    if (key === "user_id" || key === "deleted_at") continue
    out[camel(key)] = value
  }
  return out
}

export function registerEntityReadTools(server: McpServer, session: McpSession, cfg: EntityReadConfig): void {
  if (!passesGate(session, readGate)) return

  server.registerTool(
    `list_${cfg.table}`,
    {
      title: `List ${cfg.Label}s`,
      description:
        `List the ${cfg.singular}s the caller has saved — ${cfg.blurb} Returns a ` +
        `summary per row (name, description, main image, and how many variant ` +
        `assets it has), newest first. Use \`search\` when the user named one; ` +
        `call \`get_${cfg.singular}\` for its individual asset URLs.`,
      inputSchema: {
        search: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe(
            `Case-insensitive substring of the ${cfg.singular}'s name. Use this when the user named one — do not page through the list hoping to find it.`,
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(`Max ${cfg.singular}s to return (default 50, max 100).`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let query = entityOwnerFilter(
        supabase.from(cfg.table).select(cfg.summaryColumns),
        session.userId,
      )
      // `%` and `_` are ILIKE wildcards and `,`/`)` would break out of
      // PostgREST's filter grammar. The rows are already this user's, so the
      // worst a crafted string does is widen the caller's own search — but a
      // filter that parses is not something to leave to chance.
      if (args.search) query = query.ilike("name", `%${escapeLikeArgument(args.search)}%`)
      const { data, error } = await query.order("updated_at", { ascending: false }).limit(args.limit ?? 50)
      if (error) return err(`Error: ${error.message}`)
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
      return ok({ data: rows.map((row) => summarize(row, cfg)) })
    },
  )

  server.registerTool(
    `get_${cfg.singular}`,
    {
      title: `Get ${cfg.Label}`,
      description:
        `Get full detail for one ${cfg.singular} by ID — every variant asset with ` +
        `its name and URL, plus reference photos. Call this after ` +
        `\`list_${cfg.table}\` to find the right asset URL. Returns an error if ` +
        `the ${cfg.singular} is not found or not owned by the caller.`,
      inputSchema: {
        id: z.string().uuid().describe(`The ${cfg.singular}'s UUID (from list_${cfg.table}).`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { data, error } = await entityOwnerFilter(
        supabase.from(cfg.table).select(cfg.fullColumns).eq("id", args.id),
        session.userId,
      ).maybeSingle()
      if (error) return err(`Error: ${error.message}`)
      // One wording for "not yours" and "no such row": the filter is applied to
      // the QUERY, so a foreign id comes back as zero rows and this message
      // cannot be used to probe for ids that exist.
      if (!data) return err(`${cfg.Label} not found`)
      // Through `unknown`: PostgREST's inferred row type for an explicit
      // column projection is a generic-error union it cannot narrow. The
      // column list above IS the shape, and `detail` reads it structurally.
      return ok({ data: detail(data as unknown as Record<string, unknown>) })
    },
  )
}

/** Objects: props and accessories. `materials` is its second bucket. */
export const OBJECT_READ_CONFIG: EntityReadConfig = {
  table: "objects",
  singular: "object",
  Label: "Object",
  blurb: "props, accessories and physical items reused across shots.",
  summaryColumns:
    "id, name, description, canonical_description, category, style, source_image_url, " +
    "angles, materials, variations, motion_clips, boards, detail_closeups, updated_at",
  fullColumns:
    "id, name, description, canonical_description, category, style, source_image_url, image_provider, " +
    "angles, materials, variations, motion_clips, boards, reference_photos, style_lock, sheets, detail_closeups, created_at, updated_at",
  buckets: ["angles", "materials", "variations", "motion_clips", "boards", "detail_closeups"],
  summaryExtras: [],
}

/** Creatures: animals and beings. Carries `species` and `poses`. */
export const CREATURE_READ_CONFIG: EntityReadConfig = {
  table: "creatures",
  singular: "creature",
  Label: "Creature",
  blurb: "animals and non-human beings with a locked look.",
  summaryColumns:
    "id, name, description, canonical_description, species, category, style, source_image_url, " +
    "angles, poses, variations, motion_clips, boards, detail_closeups, updated_at",
  fullColumns:
    "id, name, description, canonical_description, species, category, style, source_image_url, image_provider, " +
    "angles, poses, variations, motion_clips, boards, reference_photos, style_lock, sheets, detail_closeups, voice, created_at, updated_at",
  buckets: ["angles", "poses", "variations", "motion_clips", "boards", "detail_closeups"],
  summaryExtras: ["species"],
}
