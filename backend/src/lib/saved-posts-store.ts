import { normalizeSavedPostTags, type SavedPost, type SocialPlatform, type SocialPost } from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"

/**
 * The `saved_posts` table (migration 446) as the server reads it: the columns
 * every read selects and how a row becomes a `SavedPost`. Shared by the
 * saved-posts API (`routes/saved-posts.ts`) and Read Inspiration
 * (`routes/social-post-reads.ts`), so both hand out the same post.
 */

export const SAVED_POSTS_TABLE = "saved_posts"

/** The still's asset rides along, so a copy whose bytes were cleaned up is
 *  never handed out (the asset row survives the cleanup, its url does not). */
export const SAVED_POST_COLUMNS =
  "id, post_id, platform, url, post, thumbnail_asset_id, thumbnail_url, note, tags, source, created_at, updated_at, still:assets!thumbnail_asset_id(r2_url, r2_key)"

export type SavedPostRow = {
  id: string
  post_id: string
  platform: string
  url: string
  post: unknown
  thumbnail_asset_id: string | null
  thumbnail_url: string | null
  note: string
  tags: string[] | null
  source: string
  created_at: string
  updated_at: string
  still?: { r2_url: string | null; r2_key: string | null } | null
}

/** A row as PostgREST returns it: the still is a many-to-one embed (one object
 *  or null), which the untyped client cannot know and types as a list. */
export function asSavedPostRow(data: unknown): SavedPostRow {
  return data as SavedPostRow
}

/** True when the save's copied still still has its bytes. */
export function hasLiveStill(row: SavedPostRow): boolean {
  return Boolean(row.thumbnail_asset_id && row.still?.r2_key && row.still.r2_url)
}

export function toSavedPost(row: SavedPostRow): SavedPost {
  return {
    id: row.id,
    postId: row.post_id,
    platform: row.platform as SavedPost["platform"],
    url: row.url,
    post: row.post as SocialPost,
    thumbnailUrl: hasLiveStill(row) ? row.still!.r2_url : null,
    note: row.note,
    tags: row.tags ?? [],
    source: row.source as SavedPost["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** What Read Inspiration asks of the table: one user's saves in a period, at most one platform and one tag. */
export interface SavedPostsQuery {
  readonly userId: string
  /** ISO instants: saved at or after `from`, and before `to`. */
  readonly from: string
  readonly to: string
  readonly platform?: SocialPlatform
  readonly tag?: string
  readonly order: "newest" | "oldest"
  readonly limit: number
}

/**
 * The user's saves in a period, newest or oldest first. A database that has
 * not created the table yet reads as no saves; any other failure comes back
 * for the caller to report.
 */
export async function readSavedPosts(opts: SavedPostsQuery): Promise<{ posts: SavedPost[]; error: unknown }> {
  let query = supabase.from(SAVED_POSTS_TABLE).select(SAVED_POST_COLUMNS).eq("user_id", opts.userId).gte("created_at", opts.from).lt("created_at", opts.to)
  if (opts.platform) query = query.eq("platform", opts.platform)
  // A normalized tag holds no comma, brace, quote or backslash, so the
  // quoted array literal below cannot be broken out of.
  const tag = opts.tag ? normalizeSavedPostTags([opts.tag])[0] : undefined
  if (tag) query = query.filter("tags", "cs", `{"${tag}"}`)
  const ascending = opts.order === "oldest"
  const { data, error } = await query.order("created_at", { ascending }).order("id", { ascending }).limit(opts.limit)
  if (isMissingTableError(error)) return { posts: [], error: null }
  return { posts: ((data ?? []) as unknown[]).map((row) => toSavedPost(asSavedPostRow(row))), error }
}
