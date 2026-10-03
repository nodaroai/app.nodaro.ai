import type { NodaroClient } from "../client.js"
import type {
  ListSavedPostsParams,
  ListSavedPostsResult,
  SavePostInput,
  SavedPost,
  SavedPostsLookupResult,
  UpdateSavedPostInput,
} from "@nodaro/shared"

/**
 * Saved posts — the inspiration wall.
 *
 * Save a post you found (a Social Search result, `nodes.run("social-search")`)
 * with a note and tags, list and filter your saves, and change or remove them.
 * A save keeps a snapshot of the post and a copy of its still in your storage.
 * OAuth app tokens need `assets:read` for reads and `assets:write` for writes.
 */
export class SavedPostsResource {
  constructor(private client: NodaroClient) {}

  /** `GET /v1/saved-posts` → your saves, newest first. Page with `nextCursor`. */
  list(params: ListSavedPostsParams = {}): Promise<ListSavedPostsResult> {
    return this.client.request<ListSavedPostsResult>("GET", "/v1/saved-posts", {
      query: {
        platform: params.platform,
        tag: params.tag,
        q: params.q,
        cursor: params.cursor,
        limit: params.limit,
      },
    })
  }

  /**
   * `POST /v1/saved-posts` → save a post. Saving a post that is already saved
   * updates its note and tags (when given) and returns the existing save.
   */
  save(input: SavePostInput): Promise<SavedPost> {
    return this.client.request<SavedPost>("POST", "/v1/saved-posts", { body: input })
  }

  /** `POST /v1/saved-posts/lookup` → which of these post ids (`SocialPost.id`) you saved. */
  lookup(postIds: readonly string[]): Promise<SavedPostsLookupResult> {
    return this.client.request<SavedPostsLookupResult>("POST", "/v1/saved-posts/lookup", { body: { postIds } })
  }

  /** `PATCH /v1/saved-posts/:id` → change a save's note or tags. */
  update(id: string, input: UpdateSavedPostInput): Promise<SavedPost> {
    return this.client.request<SavedPost>("PATCH", `/v1/saved-posts/${encodeURIComponent(id)}`, { body: input })
  }

  /** `DELETE /v1/saved-posts/:id` → remove a save and its copied still. */
  async delete(id: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/saved-posts/${encodeURIComponent(id)}`)
  }
}
