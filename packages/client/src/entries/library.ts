/**
 * `@nodaro/sdk/library` — the `library` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { LibraryResource } from "../resources/library.js"

export type {
  LibraryAsset,
  ListLibraryParams,
  ListLibraryResult,
} from "../resources/library.js"
