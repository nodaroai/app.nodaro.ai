/**
 * A person's favorite picker options (`catalog_favorites`, migration 688):
 * star, unstar, list. The ids are validated and put in their one stored
 * spelling by lib/catalog-favorite-ids.ts before anything here runs.
 *
 * Until the table reaches the database (lib/favorites-tables.ts) a list is
 * empty and a write answers `not_available`.
 */
import { supabase } from "./supabase.js"
import { favoritesTablesPresent, noteFavoritesTableError } from "./favorites-tables.js"
import { catalogOptionLabel, type CatalogFavoriteKey } from "./catalog-favorite-ids.js"

/** Enough for any real use; a stop against a runaway client, not a product limit. */
export const MAX_CATALOG_FAVORITES_PER_USER = 1000

export interface CatalogFavorite {
  readonly catalog: string
  readonly optionId: string
  /** The option's label now; null when its catalog no longer has it. */
  readonly label: string | null
  readonly createdAt: string
}

interface CatalogFavoriteRow {
  readonly catalog: string
  readonly option_id: string
  readonly created_at: string
}

/** A row as the list reads it: with its id, which pages the read and breaks a tie in the order. */
interface ListedCatalogFavoriteRow extends CatalogFavoriteRow {
  readonly id: string
}

export function toCatalogFavorite(row: CatalogFavoriteRow): CatalogFavorite {
  return {
    catalog: row.catalog,
    optionId: row.option_id,
    label: catalogOptionLabel(row.catalog, row.option_id),
    createdAt: row.created_at,
  }
}

export type CatalogFavoriteWrite =
  | { readonly kind: "ok"; readonly favorite: CatalogFavorite | null }
  | { readonly kind: "not_available" }
  | { readonly kind: "limit_reached" }

/** Rows per read: the API answers at most this many (`max_rows`), so a longer list is read in pages. */
export const CATALOG_FAVORITES_PAGE = 1000

/** Newest first, the id breaking a tie (the order the combined favorites list uses). */
function newestFirst(a: ListedCatalogFavoriteRow, b: ListedCatalogFavoriteRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * The caller's favorite options, newest first; one catalog's when `catalog` is
 * given. Read in pages by row id until a short page, so the list is whole
 * whatever the API's row limit; then put in order. Throws on a database failure.
 */
export async function listCatalogFavorites(userId: string, catalog?: string): Promise<CatalogFavorite[]> {
  if (!favoritesTablesPresent()) return []
  const rows: ListedCatalogFavoriteRow[] = []
  let after: string | null = null
  for (;;) {
    let query = supabase
      .from("catalog_favorites")
      .select("id, catalog, option_id, created_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(CATALOG_FAVORITES_PAGE)
    if (catalog) query = query.eq("catalog", catalog)
    if (after) query = query.gt("id", after)
    const { data, error } = await query
    if (noteFavoritesTableError(error)) return []
    if (error) throw error
    const page = (data ?? []) as ListedCatalogFavoriteRow[]
    rows.push(...page)
    if (page.length < CATALOG_FAVORITES_PAGE) break
    after = page[page.length - 1]!.id
  }
  return [...rows].sort(newestFirst).map(toCatalogFavorite)
}

/** The database's refusal of a star over the per-person cap (migration 688's trigger). */
export function isCatalogCapError(error: { readonly code?: string | null; readonly message?: string } | null | undefined): boolean {
  return error?.code === "23514" && (error.message ?? "").includes("catalog_favorites_per_user_cap")
}

/**
 * Star an option (idempotent: starring it again keeps its first star). The
 * cap of MAX_CATALOG_FAVORITES_PER_USER is the database's (a trigger that
 * counts under a per-person lock, so two stars at once cannot both pass it);
 * one already starred is let through at the cap. Throws on a database failure.
 */
export async function addCatalogFavorite(userId: string, key: CatalogFavoriteKey): Promise<CatalogFavoriteWrite> {
  if (!favoritesTablesPresent()) return { kind: "not_available" }
  const { error } = await supabase
    .from("catalog_favorites")
    .upsert(
      { user_id: userId, catalog: key.catalog, option_id: key.optionId },
      { onConflict: "user_id,catalog,option_id", ignoreDuplicates: true },
    )
  if (isCatalogCapError(error)) return { kind: "limit_reached" }
  if (noteFavoritesTableError(error)) return { kind: "not_available" }
  if (error) throw error
  return { kind: "ok", favorite: await readOne(userId, key) }
}

/** Unstar an option (idempotent: removing one that is not there succeeds). Throws on a database failure. */
export async function removeCatalogFavorite(userId: string, catalog: string, optionId: string): Promise<CatalogFavoriteWrite> {
  if (!favoritesTablesPresent()) return { kind: "not_available" }
  const { error } = await supabase
    .from("catalog_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("catalog", catalog)
    .eq("option_id", optionId)
  if (noteFavoritesTableError(error)) return { kind: "not_available" }
  if (error) throw error
  return { kind: "ok", favorite: null }
}

async function readOne(userId: string, key: CatalogFavoriteKey): Promise<CatalogFavorite | null> {
  const { data, error } = await supabase
    .from("catalog_favorites")
    .select("catalog, option_id, created_at")
    .eq("user_id", userId)
    .eq("catalog", key.catalog)
    .eq("option_id", key.optionId)
    .maybeSingle()
  if (error) throw error
  return data ? toCatalogFavorite(data as CatalogFavoriteRow) : null
}
