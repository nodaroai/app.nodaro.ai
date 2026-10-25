/**
 * `@nodaro/sdk/trash` — the `trash` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { TrashResource } from "../resources/trash.js"

export type { TrashEntry, TrashSession, ListTrashParams, TrashPage } from "../resources/trash.js"
