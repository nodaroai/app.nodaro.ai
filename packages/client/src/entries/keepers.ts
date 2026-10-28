/**
 * `@nodaro/sdk/keepers` — the `keepers` resource (the shared Nodaro Keepers
 * catalog of characters, creatures, locations and objects) and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { KeepersResource, KEEPER_KINDS } from "../resources/keepers.js"

export type {
  KeeperKind,
  KeeperCatalogItem,
  KeeperCatalogParams,
  KeeperCatalogPage,
  CopyKeeperResult,
  SetKeeperCatalogInput,
  SetKeeperCatalogResult,
} from "../resources/keepers.js"
