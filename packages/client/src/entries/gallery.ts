/**
 * `@nodaro/sdk/gallery` — the `gallery` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { GalleryResource } from "../resources/gallery.js"

export type {
  GalleryItem,
  GalleryMediaType,
  BrowseGalleryParams,
  GalleryPage,
  ToggleFavoriteResult,
} from "../resources/gallery.js"
