import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { mcpInject } from "../internal-request.js"
import { errorResult } from "./_verb-helpers.js"
import { FAVORITE_KINDS, type FavoriteKind } from "../../favorites-cursor.js"
import type { FavoriteItem, FavoritesPage } from "../../favorites-feed.js"
import type { GalleryItem } from "../widgets/gallery.js"
import { isUuid } from "./_id-guard.js"
import { supabase } from "../../supabase.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "../../public-job-data.js"
import { readableJobsFilter } from "../../public-job-read.js"
import { addGalleryFavorite, removeGalleryFavorite } from "../../gallery-favorites.js"
import { favoriteStateOfFiles } from "../../asset-favorites.js"

/**
 * Favorites for everything a person keeps, the agent face of the REST routes
 * (routes/favorites.ts, routes/library-favorite.ts, routes/gallery.ts):
 *
 *  - `favorite_catalog_option` (below): star or unstar a picker option —
 *    a style, a mood, a camera move, a music genre, a Person setting, a shot
 *    shape. `assets:write`, like `favorite_asset` and `favorite_voice`.
 *  - `favorite_asset` (`registerFavoriteAsset`, registered by tools/gallery.ts
 *    in its place among the gallery tools) stars a generation by its job id,
 *    or a library file by its asset id through `setLibraryFileFavorite`.
 *  - `list_favorites` (`registerListFavorites`, likewise) reads the favorite
 *    generations, or every kind with `kinds` through `readFavoritesFeed`.
 *
 * An injected request carries no app authorization, so the session's grant is
 * applied here: a kind the session may not read is never asked for.
 */

const writeGate: ToolGate = { required: ["assets:write"] }

/** The scopes that read each kind through its own route (any one of them) — the REST route's table. */
const KIND_GATES: Record<FavoriteKind, readonly ToolGate[]> = {
  job: [{ required: ["assets:read"] }, { required: ["jobs:read"] }],
  asset: [{ required: ["assets:read"] }],
  voice: [{ required: ["assets:read"] }],
  preset: [{ required: ["presets:read"] }],
  catalog: [{ required: ["assets:read"] }],
}

/** The kinds this session may read. */
export function readableFavoriteKinds(session: McpSession): FavoriteKind[] {
  return FAVORITE_KINDS.filter((kind) => KIND_GATES[kind].some((gate) => passesGate(session, gate)))
}

export type FeedResult =
  | { readonly ok: true; readonly page: FavoritesPage }
  | { readonly ok: false; readonly error: ReturnType<typeof errorResult> }

/** One page of `GET /v1/favorites` for the kinds asked (those the session may read). */
export async function readFavoritesFeed(
  fastify: FastifyInstance,
  session: McpSession,
  args: { kinds: readonly FavoriteKind[]; limit?: number; cursor?: string },
): Promise<FeedResult> {
  const readable = new Set(readableFavoriteKinds(session))
  const refused = args.kinds.filter((k) => !readable.has(k))
  if (refused.length > 0) {
    return {
      ok: false,
      error: errorResult(403, JSON.stringify({ error: { code: "insufficient_scope", message: `This connection may not read ${refused.join(", ")} favorites.` } })),
    }
  }
  const query: Record<string, string> = { kinds: args.kinds.join(",") }
  if (args.limit !== undefined) query.limit = String(args.limit)
  if (args.cursor) query.cursor = args.cursor
  const res = await mcpInject(fastify, session, { method: "GET", url: "/v1/favorites", query })
  if (res.statusCode >= 400) return { ok: false, error: errorResult(res.statusCode, res.body) }
  return { ok: true, page: JSON.parse(res.body) as FavoritesPage }
}

/** The gallery widget's tile for a favorite with media (a generation or an upload); null for the rest. */
export function favoriteWidgetItem(item: FavoriteItem): GalleryItem | null {
  if (item.job?.mediaType && item.job.url) {
    return {
      jobId: item.job.id,
      kind: item.job.mediaType,
      prompt: "",
      model: item.job.type ?? "",
      thumbnailUrl: item.job.thumbnailUrl ?? item.job.url,
      assetUrl: item.job.url,
      createdAt: item.job.createdAt ?? item.favoritedAt,
      favorited: true,
    }
  }
  if (item.asset && (item.asset.type === "image" || item.asset.type === "video" || item.asset.type === "audio")) {
    return {
      jobId: item.asset.id,
      kind: item.asset.type,
      prompt: item.asset.filename ?? "",
      model: "upload",
      thumbnailUrl: item.asset.thumbnailUrl ?? item.asset.url,
      assetUrl: item.asset.url,
      createdAt: item.asset.createdAt,
      favorited: true,
    }
  }
  return null
}

/**
 * Star (`favorited: true`) or unstar a library file by its asset id —
 * `POST /v1/library/:id/favorite`. A file a job made shares its job's favorite.
 * `ok: false` with the route's status: 404 for no such file of the caller's.
 */
export async function setLibraryFileFavorite(
  fastify: FastifyInstance,
  session: McpSession,
  assetId: string,
  favorited: boolean,
): Promise<{ ok: true; favorited: boolean } | { ok: false; statusCode: number; body: string }> {
  const res = await mcpInject(fastify, session, {
    method: "POST",
    url: `/v1/library/${encodeURIComponent(assetId)}/favorite`,
    payload: { favorited },
  })
  if (res.statusCode >= 400) return { ok: false, statusCode: res.statusCode, body: res.body }
  return { ok: true, favorited: (JSON.parse(res.body) as { favorited: boolean }).favorited }
}

/**
 * `browse_uploads`' favorite flag for each file of its page, or null when it
 * could not be read: the tool then leaves the flag out, as GET /v1/library
 * does — never `false` for a starred file, which a client's next toggle would
 * then remove.
 */
export async function uploadsFavoriteState(
  userId: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<Map<string, boolean> | null> {
  try {
    return await favoriteStateOfFiles(
      userId,
      rows.map((a) => ({ id: a.id as string, job_id: (a.job_id as string | null) ?? null })),
    )
  } catch {
    return null
  }
}

// ── list_favorites ──────────────────────────────────────────────────────────

/** A `jobs` row as `list_favorites` hydrates it, made a widget tile by the gallery tools (`toGalleryItem`). */
export type FavoriteJobRow = Record<string, unknown>

export interface RegisterListFavoritesOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
  /** The gallery's tile for a job row, or null when the viewer may not see it as one (tools/gallery.ts). */
  toGalleryItem: (row: FavoriteJobRow) => GalleryItem | null
}

const LIST_FAVORITES_DESCRIPTION =
  "List the authenticated user's favorited gallery items (most-recent first). Returns the favorite job_ids. " +
  "With `kinds`, lists every kind of favorite in one list instead, newest first: generations (job), uploads " +
  "(asset), voices (voice), node presets (preset) and picker options (catalog — styles, moods, camera moves, " +
  "music genres, shot shapes...), each with what it points at; page with the returned next_cursor until it is null. " +
  "A page can hold fewer items than `limit`, even none, while next_cursor is set: a favorite the user can no longer " +
  "see (a job made private, a file deleted) is left out of its page. No total count is given with `kinds`."

/** `list_favorites` with `kinds`: one page of the combined list (GET /v1/favorites). */
async function listFavoritesFeed(
  fastify: FastifyInstance,
  session: McpSession,
  args: { kinds: readonly FavoriteKind[]; limit: number; cursor?: string },
) {
  const feed = await readFavoritesFeed(fastify, session, args)
  if (!feed.ok) return feed.error
  const items = feed.page.data.map(favoriteWidgetItem).filter((item): item is GalleryItem => item !== null)
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ data: feed.page.data, next_cursor: feed.page.nextCursor }, null, 2) }],
    // No `totalCount`: the combined list is not counted, and a page's length is
    // not the list's (the widget then counts what it shows).
    structuredContent: {
      items: items as unknown as Record<string, unknown>[],
      favorites: feed.page.data as unknown as Record<string, unknown>[],
      nextCursor: feed.page.nextCursor,
    },
  }
}

/** The page's favorite jobs the caller may see, as widget tiles (skipped silently when the read fails). */
async function hydrateFavoriteJobs(session: McpSession, jobIds: string[], toGalleryItem: RegisterListFavoritesOpts["toGalleryItem"]) {
  if (jobIds.length === 0) return []
  const { data } = await supabase
    .from("jobs")
    .select("id, user_id, job_type, input_data, output_data, completed_at, provider")
    .is(TRASHED_JOB_COLUMN, null)
    // At most one page of ids (`limit` ≤ 100): a bounded request.
    .in("id", jobIds)
    // Tenant scope: only hydrate jobs the caller may see (own, or
    // public+completed) — same predicate as get_asset/display_asset. Without
    // this, favoriting another user's job UUID would leak its output_data URLs
    // + input_data prompt.
    .or(readableJobsFilter(session.userId))
    // Never a child job (CHILD_JOB_COLUMN), favorited by its id or not.
    .is(CHILD_JOB_COLUMN, null)
  return ((data ?? []) as FavoriteJobRow[])
    .map(toGalleryItem)
    .filter((item): item is GalleryItem => item !== null)
    .map((item) => ({ ...item, favorited: true }))
}

/** `list_favorites` without `kinds`: the favorite generations' job ids, a page by `created_at`. */
async function listFavoriteJobIdsPage(
  session: McpSession,
  args: { limit: number; cursor?: string },
  toGalleryItem: RegisterListFavoritesOpts["toGalleryItem"],
) {
  let query = supabase
    .from("gallery_favorites")
    .select("job_id, created_at")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(args.limit)
  if (args.cursor) query = query.lt("created_at", args.cursor)
  const { data, error } = await query
  if (error) return { content: [{ type: "text" as const, text: "Error: could not read your favorites" }], isError: true as const }
  const rows = (data ?? []) as Array<{ job_id: string; created_at: string }>
  const last = rows[rows.length - 1]
  const nextCursor = rows.length === args.limit && last?.created_at ? last.created_at : null
  const text = JSON.stringify({ data: rows.map((r) => r.job_id), next_cursor: nextCursor }, null, 2)
  const items = await hydrateFavoriteJobs(session, rows.map((r) => r.job_id), toGalleryItem)
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { items: items as unknown as Record<string, unknown>[], nextCursor, totalCount: items.length },
  }
}

/** `list_favorites` (`assets:read`, registered by the gallery tools in their order). */
export function registerListFavorites({ server, session, fastify, toGalleryItem }: RegisterListFavoritesOpts): void {
  server.registerTool(
    "list_favorites",
    {
      title: "List Favorites",
      description: LIST_FAVORITES_DESCRIPTION,
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
        kinds: z
          .array(z.enum(FAVORITE_KINDS))
          .min(1)
          .max(FAVORITE_KINDS.length)
          .optional()
          .describe("Which kinds to list, in one list (e.g. [\"job\", \"asset\"] for every media favorite). Omit for the favorite generations' job_ids."),
      },
      outputSchema: {
        items: z.array(z.object({}).passthrough()).optional(),
        nextCursor: z.string().nullable().optional(),
        totalCount: z.number().optional(),
        favorites: z.array(z.object({}).passthrough()).optional(),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v5/gallery",
        ui: {
          resourceUri: "ui://nodaro/widget/v5/gallery",
          visibility: ["model", "app"],
        },
      },
    },
    async (args) => {
      const limit = args.limit ?? 50
      if (args.kinds) return listFavoritesFeed(fastify, session, { kinds: args.kinds, limit, cursor: args.cursor })
      return listFavoriteJobIdsPage(session, { limit, cursor: args.cursor }, toGalleryItem)
    },
  )
}

// ── favorite_asset ──────────────────────────────────────────────────────────

type ToolText = { content: Array<{ type: "text"; text: string }>; isError?: true }

const toolText = (text: string): ToolText => ({ content: [{ type: "text", text }] })
const toolError = (text: string): ToolText => ({ content: [{ type: "text", text }], isError: true })

/**
 * The library's star (POST /v1/library/:id/favorite) for an asset id. `null`
 * when no such file is the caller's and `missingIsError` is false.
 */
async function starViaLibrary(
  fastify: FastifyInstance,
  session: McpSession,
  id: string,
  favorited: boolean,
  missingIsError: boolean,
): Promise<ToolText | ReturnType<typeof errorResult> | null> {
  const res = await setLibraryFileFavorite(fastify, session, id, favorited)
  if (res.ok) return toolText(`${res.favorited ? "Favorited" : "Unfavorited"} asset ${id}`)
  if (res.statusCode === 404) return missingIsError ? toolError("Error: asset not found") : null
  return errorResult(res.statusCode, res.body)
}

/**
 * Set the favorite of `id` — a job id, or a library file's asset id handed as
 * one. Idempotent both ways (`addGalleryFavorite` / `removeGalleryFavorite`):
 * two calls for the same state at once both end in it.
 */
async function setAssetFavorite(fastify: FastifyInstance, session: McpSession, id: string, favorited: boolean) {
  try {
    if (favorited) {
      const added = await addGalleryFavorite(session.userId, id)
      if (added.kind === "added") return toolText(`Favorited asset ${id}`)
      // Not a job the caller may star: an asset id handed as job_id (browse_uploads tiles carry one).
      return (await starViaLibrary(fastify, session, id, true, true))!
    }
    await removeGalleryFavorite(session.userId, id)
  } catch {
    return toolError("Error: could not update the favorite")
  }
  // The id may be an asset's (an upload's own star): clear that too; no such file is fine.
  const cleared = await starViaLibrary(fastify, session, id, false, false)
  if (cleared && "isError" in cleared && cleared.isError) return cleared
  return toolText(`Unfavorited asset ${id}`)
}

/** `favorite_asset` (`assets:write`, registered by the gallery tools in their order). */
export function registerFavoriteAsset({ server, session, fastify }: RegisterFavoriteToolsOpts): void {
  server.registerTool(
    "favorite_asset",
    {
      title: "Favorite Asset",
      description:
        "Mark or unmark a gallery asset as a favorite. Set `favorited` to true to add, false to remove. " +
        "Pass a generation's job_id, or a library file's asset_id (an upload from browse_uploads too): a file a " +
        "job made shares that job's favorite, an upload has its own.",
      inputSchema: {
        job_id: z.string().min(1).optional().describe("The generation's job id (an asset id from browse_uploads works too)."),
        asset_id: z.string().min(1).optional().describe("A library file's asset id: an upload, or a saved generation."),
        favorited: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      const id = args.asset_id ?? args.job_id
      if (!id) return toolError("Error: send job_id or asset_id")
      // Guard the uuid PK before any query — a non-UUID id would leak the raw
      // `invalid input syntax for type uuid` Postgres error.
      if (!isUuid(id)) return toolError(`Asset ${id} not found (expected a job or asset UUID)`)
      // A library file by its asset id (POST /v1/library/:id/favorite).
      if (args.asset_id) return (await starViaLibrary(fastify, session, id, args.favorited, true))!
      return setAssetFavorite(fastify, session, id, args.favorited)
    },
  )
}

export interface RegisterFavoriteToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

export function registerFavoriteTools({ server, session, fastify }: RegisterFavoriteToolsOpts): void {
  if (!passesGate(session, writeGate)) return
  server.registerTool(
    "favorite_catalog_option",
    {
      title: "Favorite Picker Option",
      description:
        "Star a picker option for the user — an art style or look, a mood, a camera move, a lens, a music genre / mood / " +
        "instrument, a voice character or delivery, a Person setting, a shot shape, a Style Gallery look — or unstar it with " +
        "favorite: false. `catalog` is the catalog's id as get_picker_catalog names it (catalogId; its node type works too), " +
        "`shot-shapes` (list_shot_shapes) or `style-presets`; `option_id` is the option's id, as `<field>:<id>` for a per-field " +
        "option of a multi-field catalog (`genre:jazz`). Both are checked against the real catalogs. Idempotent. " +
        "List them with list_favorites kinds: [\"catalog\"].",
      inputSchema: {
        catalog: z.string().min(1).max(64).describe("The catalog's id, e.g. style, color-look, camera-motions, music-genre, person, shot-shapes."),
        option_id: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[^/\\]+$/, "option_id holds no slash")
          .describe("The option's id; `<field>:<id>` for a per-field option (a bare id that names one option is accepted)."),
        favorite: z.boolean().optional().describe("false removes the star (default true)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if (/[/\\]/.test(args.catalog)) {
        return errorResult(400, JSON.stringify({ error: { code: "validation_error", message: `Unknown catalog "${args.catalog}"` } }))
      }
      const url = `/v1/favorites/catalog/${encodeURIComponent(args.catalog)}/${encodeURIComponent(args.option_id)}`
      const res = await mcpInject(fastify, session, { method: args.favorite === false ? "DELETE" : "PUT", url })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const { data } = JSON.parse(res.body) as { data: { catalog: string; optionId: string; label?: string } }
      const text =
        args.favorite === false
          ? `Unstarred ${data.catalog} / ${data.optionId}.`
          : `Starred ${data.label ? `${data.label} (${data.catalog} / ${data.optionId})` : `${data.catalog} / ${data.optionId}`}.`
      return { content: [{ type: "text" as const, text }] }
    },
  )
}
