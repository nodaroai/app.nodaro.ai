/**
 * `@nodaro/sdk/saved-posts` — the `saved-posts` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  // Saved posts (`client.savedPosts`): the inspiration wall.
  SavedPost,
  SavedPostSource,
  SavePostInput,
  UpdateSavedPostInput,
  ListSavedPostsParams,
  ListSavedPostsResult,
  SavedPostsLookupResult,
} from "@nodaro/shared/social"

export { SavedPostsResource } from "../resources/saved-posts.js"
