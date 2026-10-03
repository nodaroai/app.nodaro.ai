/**
 * Saved posts — the inspiration wall's wire contract.
 *
 * A person saves a post they found (a Social Search result) with a note and
 * tags, to come back to it or feed it into a workflow. The row keeps a
 * snapshot of the post, because platform links and numbers change, and the
 * post's still is copied into the person's storage so the wall outlives the
 * platform's signed image links.
 *
 * Why public: `SavedPost` is what `GET /v1/saved-posts` returns and the SDK's
 * `savedPosts` resource types.
 */
import type { SocialPlatform, SocialPost } from "./social-search.js"

/** Where a save came from. */
export const SAVED_POST_SOURCES = ["picker", "competitors", "manual", "api"] as const
export type SavedPostSource = (typeof SAVED_POST_SOURCES)[number]

export const SAVED_POST_NOTE_MAX = 2000
export const SAVED_POST_MAX_TAGS = 10
export const SAVED_POST_TAG_MAX = 40
export const SAVED_POSTS_PAGE_MAX = 100
/** How many post ids one lookup may ask about. */
export const SAVED_POSTS_LOOKUP_MAX = 200

export interface SavedPost {
  readonly id: string
  /** The post's own id (`SocialPost.id`); one save per post per person. */
  readonly postId: string
  readonly platform: SocialPlatform
  readonly url: string
  /** The post as it was when saved. */
  readonly post: SocialPost
  /** The still, copied into the person's storage; null when the copy failed
   *  (the post's own `media.thumbnailUrl` is then the only, expiring, link). */
  readonly thumbnailUrl: string | null
  readonly note: string
  readonly tags: readonly string[]
  readonly source: SavedPostSource
  readonly createdAt: string
  readonly updatedAt: string
}

/** The body of `POST /v1/saved-posts`. Saving a post already saved updates
 *  its note and tags (when given) and returns the existing save. */
export type SavePostInput = {
  readonly post: SocialPost
  readonly note?: string
  readonly tags?: readonly string[]
  readonly source?: SavedPostSource
}

/** The body of `PATCH /v1/saved-posts/:id`. */
export type UpdateSavedPostInput = {
  readonly note?: string
  readonly tags?: readonly string[]
}

/** Query of `GET /v1/saved-posts`. */
export type ListSavedPostsParams = {
  readonly platform?: SocialPlatform
  /** Only saves carrying this tag. */
  readonly tag?: string
  /** Words to find in the note or the post's text. */
  readonly q?: string
  /** The `nextCursor` of the previous page. */
  readonly cursor?: string
  /** 1–100, default 40. */
  readonly limit?: number
}

export interface ListSavedPostsResult {
  readonly data: readonly SavedPost[]
  readonly nextCursor: string | null
}

/** The answer of `POST /v1/saved-posts/lookup`: which of the asked posts are saved. */
export interface SavedPostsLookupResult {
  readonly saved: ReadonlyArray<{ readonly postId: string; readonly id: string }>
}

/**
 * Tags as stored: split on commas (`,` `，` `、`, so "hooks, openers" is two
 * tags in any script), trimmed, inner whitespace collapsed, lower-cased, a
 * leading `#` dropped, braces, quotes and backslashes removed (they would
 * change a tag filter's meaning), each at most 40 characters, no repeats, at
 * most 10.
 */
export function normalizeSavedPostTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const clean = tags
    .filter((t): t is string => typeof t === "string")
    .flatMap((t) => t.split(/[,，、]/))
    .map((t) =>
      t
        .replace(/[{}"\\]/g, "")
        .trim()
        .replace(/^#+/, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .slice(0, SAVED_POST_TAG_MAX)
        .trim(),
    )
    .filter((t) => t.length > 0)
  return Array.from(new Set(clean)).slice(0, SAVED_POST_MAX_TAGS)
}
