import type { PickerImageOptions, PickerOwnPicture } from "@nodaro/prompts/picker-art"
import { isCloud } from "./config.js"
import { appBaseUrl } from "./deployment-urls.js"
import { hasRegisteredPickerPictures, registeredPickerPicture } from "./picker-pictures.js"
import { surfaceCatalogImages } from "./surface-profile.js"

/**
 * How the API pictures picker options (the `imageUrl` / `imageSrcSet` /
 * `imageLargeUrl` of every catalog option, the Person / Styling topic
 * pictures, the directory's `imageCount`), or undefined when it pictures none.
 * The ONE place on the server that decides it: every catalog projection takes
 * its `images` from here, and only this file reads the platform's picture maps
 * and the deployment's registered pictures for serving
 * (picker-images-totality.test.ts).
 *
 * The deployment's `catalogs.images` (surface profile) decides first:
 *
 * - `"default"` (or no setting): the platform's pictures, as below. Pictures a
 *   deployment registered are ignored;
 * - `"none"`: no picture at all — undefined, so no option carries an
 *   `imageUrl` or `imageSrcSet`, no topic carries an `imageUrl`, and every
 *   `imageCount` is 0. Pictures a deployment registered are not shown either;
 * - `"own"`: the deployment's own pictures (lib/picker-pictures.ts), never the
 *   platform's. An option it registered none for has no picture, and no topic
 *   has one. With none registered at all it is exactly `"none"` (undefined).
 *   Its enlarged picture rides as `imageLargeUrl` when `srcSet` is asked for —
 *   the same request that gets a CDN render's widths — so the REST routes carry
 *   it and the MCP tools do not.
 *
 * The platform's pictures:
 *
 * - self-hosted pictures on THIS installation's public origin — PUBLIC_URL,
 *   the same base every other generated link uses (the community stack sets
 *   it; Nodaro Cloud's app host when unset), so an external app always gets
 *   absolute URLs on the install it asked, never on Nodaro's servers;
 * - the rendered previews (the look pickers' and the music / voice pickers'), which
 *   live on the Nodaro CDN, on Nodaro Cloud only — the same rule the editor
 *   follows (look-previews-bootstrap.ts);
 * - with `srcSet`, each CDN picture's widths as `imageSrcSet`: the REST routes
 *   ask for it (an app draws the picture), the MCP tools do not.
 */
export function pickerImageOptions(opts: { readonly srcSet?: boolean } = {}): PickerImageOptions | undefined {
  const pictures = shownPictures()
  if (pictures === "platform") return { baseUrl: appBaseUrl(), lookPreviews: isCloud(), srcSet: opts.srcSet === true }
  if (pictures === "own") return { baseUrl: appBaseUrl(), srcSet: opts.srcSet === true, own: ownPicture }
  return undefined
}

/**
 * Whether the catalog replies carry the deployment's own pictures: its
 * `catalogs.images` is `"own"` and at least one picture is registered. The
 * editor reads them from `GET /v1/catalogs`, so that route sends its body
 * whenever this is true, even with no catalog pack registered.
 */
export function ownPickerPicturesShown(): boolean {
  return shownPictures() === "own"
}

/** Which pictures the replies carry. The one read of the setting. */
function shownPictures(): "platform" | "own" | "none" {
  const setting = surfaceCatalogImages()
  // Exactly "default": a value this reader does not know shows nothing.
  if (setting === "default") return "platform"
  return setting === "own" && hasRegisteredPickerPictures() ? "own" : "none"
}

function ownPicture(catalogId: string, optionId: string): PickerOwnPicture | undefined {
  const entry = registeredPickerPicture(catalogId, optionId)
  if (!entry) return undefined
  return entry.enlargedPictureUrl ? { url: entry.pictureUrl, largeUrl: entry.enlargedPictureUrl } : { url: entry.pictureUrl }
}

/**
 * A still of a picture on the transforming CDN, resized (a frame, for a clip):
 * a URL transform only, applied to whatever picture the caller holds. It never
 * names one of the platform's picker pictures, so the setting above does not
 * apply to it. Re-exported here so this file stays the backend's one importer
 * of the picture maps' module.
 */
export { lookPreviewStillUrl } from "@nodaro/prompts/picker-art"
