/**
 * The queries of `GET /v1/library`: one page, and its exact count, built from
 * ONE set of filters so `totalCount` describes the same list the pages walk.
 *
 * Every filter of the listing — whose files (`owned`), the medium, the word
 * search, the origin — is applied by `narrow` to whichever source the rows
 * come from:
 *   - the `assets` table itself, or
 *   - with `favorited`, the database function `library_assets_by_favorite`
 *     (migration 688), which returns the `assets` rows that are (or are not)
 *     the caller's favorites — the predicate of lib/asset-favorites.ts, held in
 *     the database, so the request names the caller and never their favorites
 *     (a list of favorite ids in the request line outgrew the gateway's URL
 *     limit at a few hundred).
 * Both keep only rows that are files (`onlyAssetFiles`) and leave a restricted
 * file out, page and count alike.
 *
 * The function's rows are filtered AFTER they are projected, so a filter can
 * only name a column the select carries: its page selects every column (`*`),
 * which keeps any filter `narrow` adds valid on both sources.
 */
import { supabase } from "./supabase.js"
import { RESTRICTED_ASSET_COLUMN } from "./content-restrictions-column.js"
import { onlyAssetFiles } from "./asset-file-column.js"
import { libraryJobEmbedSelect } from "./job-cover/library-embed.js"

/** What one listing asks for. */
export interface LibraryListing {
  readonly userId: string
  /** The storage page's view: every file of the caller's. Else the library's: saved to it, or shared. */
  readonly owned: boolean
  readonly type: "all" | "image" | "video" | "audio"
  /** `or=` filters of the word search (lib/text-search.ts), one per word, ANDed. */
  readonly searchFilters: readonly string[]
  readonly source?: string
  /** Only the caller's favorites (true), only the rest (false); undefined: every file. */
  readonly favorited?: boolean
}

/** Where the next page starts: the row a page ended on (`ORDER BY created_at DESC, id DESC`). */
export interface LibraryCursor {
  readonly id: string
  readonly createdAt: string
}

/** The filter methods `narrow` uses, on either source's builder. */
interface Narrowable<Q> {
  eq(column: string, value: unknown): Q
  or(filters: string): Q
}

/** The listing's filters, the same for the page and the count, on either source. */
function narrow<Q extends Narrowable<Q>>(query: Q, listing: LibraryListing): Q {
  // Storage page: ALL the caller's files. Workflow modal: saved to the library, plus shared items.
  let q = listing.owned
    ? query.eq("user_id", listing.userId)
    : query.or(`and(user_id.eq.${listing.userId},in_library.eq.true),is_library_item.eq.true`)
  if (listing.type !== "all") q = q.eq("type", listing.type)
  for (const filter of listing.searchFilters) q = q.or(filter)
  if (listing.source) q = q.eq("source", listing.source)
  return q
}

/** The function's arguments: the caller, and which side of the favorites predicate. */
function favoriteArgs(listing: LibraryListing): { p_user_id: string; p_favorited: boolean } {
  return { p_user_id: listing.userId, p_favorited: listing.favorited === true }
}

/** The exact count of the listing (the first page's `totalCount`). */
export function libraryCountQuery(listing: LibraryListing) {
  if (listing.favorited === undefined) {
    return narrow(
      onlyAssetFiles(
        supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .is(RESTRICTED_ASSET_COLUMN, null),
      ),
      listing,
    )
  }
  return narrow(
    onlyAssetFiles(
      supabase
        .rpc("library_assets_by_favorite", favoriteArgs(listing), { count: "exact", head: true })
        .is(RESTRICTED_ASSET_COLUMN, null),
    ),
    listing,
  )
}

/** The rows of the listing, newest first, from the source the listing reads. */
function pageSource(listing: LibraryListing) {
  if (listing.favorited === undefined) {
    return onlyAssetFiles(
      supabase
        .from("assets")
        // `job`: the file's job, for the name its owner gave it (`title`, migration
        // 609) and its picture (`coverUrl`) — a to-one embed on `assets.job_id`,
        // each column once this database has it (lib/job-cover/library-embed.ts);
        // null for an upload, or once that job's history is deleted.
        // trash-read: a file kept in the library outlives its deleted job by design
        // (like its render label), and so does the name its owner gave that job.
        .select("id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, metadata, is_library_item, upload_source, source, source_detail" + libraryJobEmbedSelect() + ", created_at, job_id")
        .is(RESTRICTED_ASSET_COLUMN, null),
    )
  }
  return onlyAssetFiles(
    supabase
      .rpc("library_assets_by_favorite", favoriteArgs(listing))
      // Every column (see the header: a filter can only name a selected column), and the same job embed.
      // trash-read: as above — the file outlives its deleted job, and so does its job's name.
      .select("*" + libraryJobEmbedSelect())
      .is(RESTRICTED_ASSET_COLUMN, null),
  )
}

/**
 * One page of the listing: `limit + 1` rows (the extra one says whether more
 * remain), after `cursor` when one is given.
 */
export function libraryPageQuery(listing: LibraryListing, limit: number, cursor: LibraryCursor | null) {
  let query = narrow(pageSource(listing), listing)
    .order("created_at", { ascending: false })
    // The tie-break that makes the ordering TOTAL. `created_at` defaults to
    // `NOW()`, the TRANSACTION timestamp — every asset written by one
    // multi-file upload shares a value to the microsecond. Without `id` the
    // page boundary has no defined place among the tied rows.
    .order("id", { ascending: false })
    .limit(limit + 1)
  if (cursor) {
    // Everything strictly AFTER the cursor row under `ORDER BY created_at DESC,
    // id DESC` (the predicate of lib/keyset-cursor.ts): a bare `created_at.lt`
    // would skip every row tied with the cursor row. Both values are trusted:
    // the id is a validated uuid, the timestamp read back out of the database.
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  }
  return query
}
