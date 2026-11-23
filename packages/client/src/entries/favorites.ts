/**
 * `@nodaro/sdk/favorites` — the `favorites` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { FavoritesResource } from "../resources/favorites.js"

export type {
  FavoriteKind,
  FavoriteItem,
  ListFavoritesParams,
  ListFavoritesResult,
  CatalogFavorite,
  AddCatalogFavoriteResult,
  RemoveCatalogFavoriteResult,
} from "../resources/favorites.js"
