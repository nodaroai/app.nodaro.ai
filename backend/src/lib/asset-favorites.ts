/**
 * Favorites on library files: one list for uploads and generations.
 *
 * A generation's favorite has always lived on its JOB (`gallery_favorites`,
 * migration 055: `POST /v1/gallery/favorite`, `Job.favorited`). An upload has
 * no job, so it could not be starred at all; migration 688 gives it its own
 * row (`asset_favorites`). A library file is favorited when EITHER says so —
 * its job's favorite, or its own star — so a file a job made reports the
 * job's favorite, an upload its own, and the two read back as one list.
 *
 * A job's favorite counts only while the job is out of the Trash: the Trash
 * hides a job from every favorites list (`GET /v1/favorites`,
 * `GET /v1/gallery/favorites`), so the library reads its star the same way,
 * and restoring the job brings it back. A file whose job is in the Trash can
 * still be starred: it gets its own star, which lists as an `asset` favorite.
 *
 * The predicate lives in the database (migration 688:
 * `library_file_is_favorite`, read through `library_assets_by_favorite` for
 * the library's `favorited` filter — lib/library-listing.ts — and through
 * `library_favorite_asset_ids` for each listed file's flag), so a request
 * names only the person, never their favorites.
 *
 * Until migration 688 reaches the database (lib/favorites-tables.ts) only the
 * job side exists: each listed file's flag is read from its job's favorite (an
 * upload reads as not favorited), the `favorited` filter answers 503
 * not_available, and starring an upload answers not_available.
 */
import { supabase } from "./supabase.js"
import { RESTRICTED_ASSET_COLUMN } from "./content-restrictions-column.js"
import { favoritesTablesPresent, noteFavoritesTableError } from "./favorites-tables.js"
import { addGalleryFavorite, removeGalleryFavorite } from "./gallery-favorites.js"
import { isMissingFunctionError } from "./postgrest-errors.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"

/** A listed file's two keys: its own id and the job that made it (null for an upload). */
export interface LibraryFileKeys {
  readonly id: string
  readonly job_id: string | null
}

/**
 * True when `error` says migration 688's tables or functions are not in this
 * database (the tables are then forgotten until the next probe sees them).
 */
export function isMissingFavoritesSchema(error: { readonly code?: string | null; readonly message?: string } | null | undefined): boolean {
  if (!error) return false
  return noteFavoritesTableError(error) || isMissingFunctionError(error)
}

/**
 * Whether each file of a page is favorited, by the database's one predicate
 * (`library_favorite_asset_ids`): one call for the page, its ids in the body.
 * Before migration 688, by the job side alone. Throws on a database failure
 * (the caller leaves the flag out rather than say `false` for a starred file).
 */
export async function favoriteStateOfFiles(userId: string, files: readonly LibraryFileKeys[]): Promise<Map<string, boolean>> {
  if (files.length === 0) return new Map()
  if (favoritesTablesPresent()) {
    const { data, error } = await supabase.rpc("library_favorite_asset_ids", {
      p_user_id: userId,
      p_asset_ids: files.map((f) => f.id),
    })
    if (!error) {
      const starred = new Set((data ?? []) as string[])
      return new Map(files.map((f) => [f.id, starred.has(f.id)]))
    }
    if (!isMissingFavoritesSchema(error)) throw error
  }
  return jobSideState(userId, files)
}

/** The job side of the predicate alone (before 688): the file's job favorited, and out of the Trash. */
async function jobSideState(userId: string, files: readonly LibraryFileKeys[]): Promise<Map<string, boolean>> {
  const jobIds = [...new Set(files.map((f) => f.job_id).filter((id): id is string => Boolean(id)))]
  if (jobIds.length === 0) return new Map(files.map((f) => [f.id, false]))
  // One page's job ids (at most the page size) in each read: bounded requests.
  const { data, error } = await supabase.from("gallery_favorites").select("job_id").eq("user_id", userId).in("job_id", jobIds)
  if (error) throw error
  const favorited = [...new Set(((data ?? []) as Array<{ job_id: string }>).map((r) => r.job_id))]
  const starred = new Set(await jobsOutOfTrash(favorited))
  return new Map(files.map((f) => [f.id, f.job_id !== null && starred.has(f.job_id)]))
}

/** Which of these jobs are out of the Trash: a favorite of a job in the Trash does not count, as the job is not listed. */
async function jobsOutOfTrash(jobIds: readonly string[]): Promise<string[]> {
  if (jobIds.length === 0) return []
  const { data, error } = await supabase.from("jobs").select("id").in("id", [...jobIds]).is(TRASHED_JOB_COLUMN, null)
  if (error) throw error
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

export type SetFileFavoriteOutcome =
  | { readonly kind: "ok"; readonly favorited: boolean; readonly jobId: string | null }
  /** No file the caller may see by that id — the same answer for another person's private file. */
  | { readonly kind: "not_found" }
  /** An upload, before migration 688 reaches this database. */
  | { readonly kind: "not_available" }

/** The file by id, when the caller may see it: their own, or a shared library item. */
async function readVisibleFile(userId: string, assetId: string): Promise<LibraryFileKeys | null> {
  // restricted-read: a star's own lookup, answering only whether the file is starred
  const { data: file, error } = await supabase
    .from("assets") // tenant-scope-ignore: the or() below is the caller's own file or a shared library item
    .select("id, job_id")
    .eq("id", assetId)
    .is(RESTRICTED_ASSET_COLUMN, null)
    .or(`user_id.eq.${userId},is_library_item.eq.true`)
    .maybeSingle()
  if (error) throw error
  return (file as LibraryFileKeys | null) ?? null
}

/**
 * Star or unstar a library file the caller may see (their own, or a shared
 * library item): `favorited` sets it — idempotent, with no read of the current
 * state, so two calls for the same state at once both end in it — and omitted
 * toggles it. Starring favorites the file's job when the caller may star it,
 * else (an upload, a job in the Trash or not theirs to see) gives the file its
 * own star. Unstarring clears both. Throws on a database failure.
 */
export async function setFileFavorite(
  userId: string,
  assetId: string,
  favorited: boolean | undefined,
  opts: { isAdmin?: boolean } = {},
): Promise<SetFileFavoriteOutcome> {
  const file = await readVisibleFile(userId, assetId)
  if (!file) return { kind: "not_found" }
  const target = favorited ?? !((await favoriteStateOfFiles(userId, [file])).get(file.id) ?? false)
  return target ? starFile(userId, file, opts) : unstarFile(userId, file)
}

/** Add the file's star (idempotent): on its job when the caller may star it, else its own. */
async function starFile(userId: string, file: LibraryFileKeys, opts: { isAdmin?: boolean }): Promise<SetFileFavoriteOutcome> {
  if (file.job_id) {
    const added = await addGalleryFavorite(userId, file.job_id, opts)
    if (added.kind === "added") return { kind: "ok", favorited: true, jobId: file.job_id }
  }
  if (!favoritesTablesPresent()) return { kind: "not_available" }
  const { error } = await supabase.from("asset_favorites").insert({ user_id: userId, asset_id: file.id })
  // Already starred (an earlier call, or a concurrent one): starred either way.
  if (!error || error.code === "23505") return { kind: "ok", favorited: true, jobId: file.job_id }
  // The file was deleted between the read and the write.
  if (error.code === "23503") return { kind: "not_found" }
  if (noteFavoritesTableError(error)) return { kind: "not_available" }
  throw error
}

/** Remove both stars of the file (idempotent: one that is not there is already removed). */
async function unstarFile(userId: string, file: LibraryFileKeys): Promise<SetFileFavoriteOutcome> {
  if (file.job_id) await removeGalleryFavorite(userId, file.job_id)
  if (favoritesTablesPresent()) {
    const { error } = await supabase.from("asset_favorites").delete().eq("user_id", userId).eq("asset_id", file.id)
    if (error && !noteFavoritesTableError(error)) throw error
  }
  return { kind: "ok", favorited: false, jobId: file.job_id }
}
