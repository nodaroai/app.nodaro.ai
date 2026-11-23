/**
 * One read for a "Favorites" screen (`GET /v1/favorites`): every kind of
 * favorite a person keeps, newest first, one cursor.
 *
 *   job      a generation (`gallery_favorites`): their own, or a public one.
 *   asset    a library file no job made — an upload (`asset_favorites`, 688).
 *            A file a job made is starred on its job, so it lists as `job`.
 *   voice    a voice (`voice_favorites`, 608), with the name it was starred by.
 *   preset   a node preset, factory or their own (`node_preset_favorites`, 209).
 *   catalog  a picker option (`catalog_favorites`, 688).
 *
 * Each table is read once per page, for the rows after the cursor
 * (lib/favorites-cursor.ts), and the pages merged. A table that is not in
 * this database yet (staging before a promotion) gives nothing.
 *
 * What an item carries is enough to render it: a job's media and status, a
 * file's address, a voice's snapshot, a preset's ids, an option's label. A
 * job the caller may no longer see (another person's job made private, a
 * child job) or a file that is gone is left out of its page; the cursor still
 * moves past it.
 */
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { RESTRICTED_ASSET_COLUMN } from "./content-restrictions-column.js"
import { onlyAssetFiles } from "./asset-file-column.js"
import { favoritesTablesPresent, noteFavoritesTableError } from "./favorites-tables.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { readableJobsFilter } from "./public-job-read.js"
import { OWNER_ONLY_RENDER_JOBS } from "./render-listing.js"
import { catalogOptionLabel } from "./catalog-favorite-ids.js"
import {
  compareFavorites,
  encodeFavoritesCursor,
  keysetFilter,
  type FavoriteKind,
  type FavoritesCursor,
  type OrderedFavorite,
} from "./favorites-cursor.js"

/** A row of one table, in the combined order, with what it points at. */
interface SourceRow extends OrderedFavorite {
  /** What the favorite points at: a job id, an asset id, a voice id, a preset id, `<catalog>/<optionId>`. */
  readonly targetId: string
  readonly raw: Record<string, unknown>
}

interface Source {
  readonly kind: FavoriteKind
  readonly table: string
  readonly select: string
  /** Is the table in this database? (the 688 tables until a probe has seen them) */
  readonly present: () => boolean
  readonly target: (row: Record<string, unknown>) => string
  /** Extra filters on the read (the job source's Trash rule). */
  readonly narrow?: <Q extends { is(column: string, value: null): Q }>(query: Q) => Q
}

const SOURCES: Record<FavoriteKind, Source> = {
  job: {
    kind: "job",
    table: "gallery_favorites",
    // A favorite of a job in the Trash is left out, as the job is (`!inner`).
    select: "id, job_id, created_at, job:jobs!gallery_favorites_job_id_fkey!inner(id)",
    present: () => true,
    target: (row) => String(row.job_id),
    narrow: (query) => query.is(`job.${TRASHED_JOB_COLUMN}`, null),
  },
  asset: {
    kind: "asset",
    table: "asset_favorites",
    select: "id, asset_id, created_at",
    present: favoritesTablesPresent,
    target: (row) => String(row.asset_id),
  },
  voice: {
    kind: "voice",
    table: "voice_favorites",
    select: "id, voice_id, voice_type, name, preview_url, created_at",
    present: () => true,
    target: (row) => String(row.voice_id),
  },
  preset: {
    kind: "preset",
    table: "node_preset_favorites",
    select: "id, node_type, preset_id, created_at",
    present: () => true,
    target: (row) => String(row.preset_id),
  },
  catalog: {
    kind: "catalog",
    table: "catalog_favorites",
    select: "id, catalog, option_id, created_at",
    present: favoritesTablesPresent,
    target: (row) => `${String(row.catalog)}/${String(row.option_id)}`,
  },
}

/** One table's rows after the cursor, `limit + 1` of them (the +1 says whether more remain). */
async function readSource(source: Source, userId: string, limit: number, cursor: FavoritesCursor | null): Promise<SourceRow[]> {
  if (!source.present()) return []
  let query = supabase
    .from(source.table)
    .select(source.select)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1)
  if (source.narrow) query = source.narrow(query)
  if (cursor) query = query.or(keysetFilter(source.kind, cursor))
  const { data, error } = await query
  if (error) {
    if (source.present === favoritesTablesPresent && noteFavoritesTableError(error)) return []
    if (isMissingTableError(error)) return []
    throw error
  }
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((raw) => ({
    kind: source.kind,
    rowId: String(raw.id),
    createdAt: String(raw.created_at),
    targetId: source.target(raw),
    raw,
  }))
}

/** A favorite as the combined list answers it. */
export interface FavoriteItem {
  readonly kind: FavoriteKind
  /** What it points at: the job id, the asset id, the voice id, the preset id, or `<catalog>/<optionId>`. */
  readonly id: string
  /** When it was starred. */
  readonly favoritedAt: string
  readonly job?: {
    readonly id: string
    readonly type: string | null
    readonly status: string | null
    readonly mediaType: "image" | "video" | "audio" | null
    readonly url: string | null
    readonly thumbnailUrl: string | null
    readonly createdAt: string | null
  }
  readonly asset?: {
    readonly id: string
    readonly type: string
    readonly filename: string | null
    readonly url: string
    readonly thumbnailUrl: string | null
    readonly createdAt: string
  }
  readonly voice?: {
    readonly voiceId: string
    readonly voiceType: string
    readonly name: string
    readonly previewUrl: string | null
  }
  readonly preset?: { readonly nodeType: string; readonly presetId: string }
  readonly catalog?: { readonly catalog: string; readonly optionId: string; readonly label: string | null }
}

export interface FavoritesPage {
  readonly data: FavoriteItem[]
  readonly nextCursor: string | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)

function jobMedia(out: Record<string, unknown> | null): { mediaType: "image" | "video" | "audio" | null; url: string | null; thumbnailUrl: string | null } {
  const o = out ?? {}
  const mediaType = o.imageUrl ? "image" : o.videoUrl ? "video" : o.audioUrl ? "audio" : null
  const url = str(o.imageUrl) ?? str(o.videoUrl) ?? str(o.audioUrl) ?? str(o.outputUrl) ?? str(o.url)
  return { mediaType, url, thumbnailUrl: str(o.thumbnailUrl) ?? (mediaType === "image" ? url : null) }
}

/** The page's jobs the caller may see, by id. */
async function hydrateJobs(userId: string, ids: string[]): Promise<Map<string, FavoriteItem["job"]>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, job_type, status, output_data, created_at")
    .is(TRASHED_JOB_COLUMN, null)
    .in("id", ids)
    // Only jobs the caller may see (own, or public and completed) — the
    // predicate list_favorites and get_asset apply.
    .or(readableJobsFilter(userId))
    // Never a child job (CHILD_JOB_COLUMN), favorited by its id or not.
    .is(CHILD_JOB_COLUMN, null)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; user_id: string | null; job_type: string | null; status: string | null; output_data: Record<string, unknown> | null; created_at: string | null }>
  return new Map(
    rows
      // A render that lists in its owner's views only (an Apply EDL final) is the
      // caller's own or nothing, public or not — the rule list_favorites applies.
      .filter((r) => !(r.job_type && OWNER_ONLY_RENDER_JOBS.has(r.job_type) && r.user_id !== userId))
      .map((r) => [r.id, { id: r.id, type: r.job_type ?? null, status: r.status ?? null, ...jobMedia(r.output_data), createdAt: r.created_at ?? null }]),
  )
}

/** The page's files the caller may see (their own, or shared), by id. */
async function hydrateAssets(userId: string, ids: string[]): Promise<Map<string, FavoriteItem["asset"]>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await onlyAssetFiles(
    supabase
      .from("assets") // tenant-scope-ignore: the or() below is the caller's own file or a shared library item
      .select("id, type, filename, r2_url, metadata, created_at")
      .in("id", ids)
      .is(RESTRICTED_ASSET_COLUMN, null)
      .or(`user_id.eq.${userId},is_library_item.eq.true`),
  )
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; type: string; filename: string | null; r2_url: string; metadata: Record<string, unknown> | null; created_at: string }>
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, type: r.type, filename: r.filename ?? null, url: r.r2_url, thumbnailUrl: str(r.metadata?.thumbnail_url), createdAt: r.created_at },
    ]),
  )
}

function toItem(row: SourceRow, jobs: Map<string, FavoriteItem["job"]>, assets: Map<string, FavoriteItem["asset"]>): FavoriteItem | null {
  const base = { kind: row.kind, id: row.targetId, favoritedAt: row.createdAt }
  const r = row.raw
  switch (row.kind) {
    case "job": {
      const job = jobs.get(row.targetId)
      return job ? { ...base, job } : null
    }
    case "asset": {
      const asset = assets.get(row.targetId)
      return asset ? { ...base, asset } : null
    }
    case "voice":
      return { ...base, voice: { voiceId: String(r.voice_id), voiceType: String(r.voice_type), name: String(r.name), previewUrl: str(r.preview_url) } }
    case "preset":
      return { ...base, preset: { nodeType: String(r.node_type), presetId: String(r.preset_id) } }
    case "catalog": {
      const catalog = String(r.catalog)
      const optionId = String(r.option_id)
      return { ...base, catalog: { catalog, optionId, label: catalogOptionLabel(catalog, optionId) } }
    }
  }
}

/**
 * A page of the caller's favorites of `kinds`, newest first. Throws on a
 * database failure.
 */
export async function readFavoritesPage(
  userId: string,
  kinds: readonly FavoriteKind[],
  limit: number,
  cursor: FavoritesCursor | null,
): Promise<FavoritesPage> {
  const fetched = (await Promise.all(kinds.map((kind) => readSource(SOURCES[kind], userId, limit, cursor)))).flat()
  const ordered = [...fetched].sort(compareFavorites)
  const page = ordered.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = ordered.length > limit && last ? encodeFavoritesCursor({ createdAt: last.createdAt, kind: last.kind, rowId: last.rowId }) : null

  const idsOf = (kind: FavoriteKind) => page.filter((r) => r.kind === kind).map((r) => r.targetId)
  const [jobs, assets] = await Promise.all([hydrateJobs(userId, idsOf("job")), hydrateAssets(userId, idsOf("asset"))])
  const data = page.map((row) => toItem(row, jobs, assets)).filter((item): item is FavoriteItem => item !== null)
  return { data, nextCursor }
}
