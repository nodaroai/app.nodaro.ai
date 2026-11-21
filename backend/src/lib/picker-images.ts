import { RESTYLE_PREVIEWS, restylePreviewStillUrl, type PickerImageOptions, type PickerOwnPicture } from "@nodaro/prompts/picker-art"
import { isCloud } from "./config.js"
import { appBaseUrl } from "./deployment-urls.js"
import { hasRegisteredPickerPictures, registeredPickerPicture } from "./picker-pictures.js"
import { sitePictureAddress } from "./site-picture-path.js"
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
 *   it and the MCP tools do not. A picture registered as a path on the site
 *   stays that path on the REST replies (`onSite`) and is absolute on the
 *   reader's base on the MCP tools.
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
export function pickerImageOptions(
  opts: { readonly srcSet?: boolean; readonly baseUrl?: string; readonly onSite?: boolean } = {},
): PickerImageOptions | undefined {
  const pictures = shownPictures()
  // The MCP tools pass their session's pictures host (lib/mcp-lane-addresses.ts:
  // on a deployment that serves MCP by path, the host the client connected
  // through); every other caller gets the install's own public origin.
  const baseUrl = opts.baseUrl ?? appBaseUrl()
  if (pictures === "platform") return { baseUrl, lookPreviews: isCloud(), srcSet: opts.srcSet === true }
  if (pictures === "own") {
    // A deployment's picture that is a path on its site (lib/site-picture-path.ts):
    // as registered on a reply a browser reads on the site that served it
    // (`onSite`, the REST routes — it resolves on whichever of the deployment's
    // hosts the person is on, and the reply is the same on every host); absolute
    // on `baseUrl` for every other reader (the MCP tools, off the site).
    const reader = { onSite: opts.onSite === true, base: baseUrl }
    return { baseUrl, srcSet: opts.srcSet === true, own: (catalogId, optionId) => ownPicture(catalogId, optionId, reader) }
  }
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

/**
 * Whether this deployment shows the platform's rendered previews (the look
 * previews, the restyle previews, Video Remake's previews): its
 * `catalogs.images` is exactly `"default"`, on Nodaro Cloud, whose CDN they
 * live on.
 */
export function platformPicturesShown(): boolean {
  return shownPictures() === "platform" && isCloud()
}

/** An art style's restyle preview as a reply carries it: the clip and a still cut from it, both absolute. */
export interface ShownRestylePreview {
  readonly clipUrl: string
  readonly stillUrl: string
}

/**
 * The platform's restyle previews (an approved clip of real footage wiping
 * into an art style, with its still), by `style` catalog option id — or
 * undefined where this deployment does not show the platform's rendered
 * previews: the same rule as every look preview above (`catalogs.images`
 * exactly `"default"`, on Nodaro Cloud). A style with no approved clip, or
 * whose clip has no still, has no entry.
 */
export function shownRestylePreviews(): ReadonlyMap<string, ShownRestylePreview> | undefined {
  if (!platformPicturesShown()) return undefined
  const shown = new Map<string, ShownRestylePreview>()
  for (const [styleId, preview] of Object.entries(RESTYLE_PREVIEWS)) {
    const stillUrl = restylePreviewStillUrl(preview)
    if (stillUrl) shown.set(styleId, { clipUrl: preview.url, stillUrl })
  }
  return shown
}

function ownPicture(catalogId: string, optionId: string, reader: Parameters<typeof sitePictureAddress>[1]): PickerOwnPicture | undefined {
  const entry = registeredPickerPicture(catalogId, optionId)
  if (!entry) return undefined
  const url = sitePictureAddress(entry.pictureUrl, reader)
  return entry.enlargedPictureUrl ? { url, largeUrl: sitePictureAddress(entry.enlargedPictureUrl, reader) } : { url }
}

/**
 * A still of a picture on the transforming CDN, resized (a frame, for a clip):
 * a URL transform only, applied to whatever picture the caller holds. It never
 * names one of the platform's picker pictures, so the setting above does not
 * apply to it. Re-exported here so this file stays the backend's one importer
 * of the picture maps' module.
 */
export { lookPreviewStillUrl } from "@nodaro/prompts/picker-art"
