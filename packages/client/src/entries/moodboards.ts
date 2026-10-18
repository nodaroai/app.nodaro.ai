/**
 * `@nodaro/sdk/moodboards` — the `moodboards` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { MoodboardsResource } from "../resources/moodboards.js"

export type {
  Moodboard,
  MoodboardImage,
  CreateMoodboardInput,
  UpdateMoodboardInput,
  ListMoodboardsParams,
  MoodboardPage,
} from "../resources/moodboards.js"

export { MOODBOARD_DIRECTION_PREFIX, moodboardDirectionId } from "../resources/moodboards.js"
