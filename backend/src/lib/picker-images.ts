import type { PickerImageOptions } from "@nodaro/prompts/picker-art"
import { isCloud } from "./config.js"
import { appBaseUrl } from "./deployment-urls.js"
import { surfaceCatalogImages } from "./surface-profile.js"

/**
 * How the API pictures picker options (the `imageUrl` / `imageSrcSet` of every
 * catalog option, the Person / Styling topic pictures, the directory's
 * `imageCount`), or undefined when it pictures none. The ONE place on the
 * server that decides it: every catalog projection takes its `images` from
 * here, and only this file reads the platform's picture maps
 * (picker-images-totality.test.ts).
 *
 * The deployment's `catalogs.images` (surface profile) decides first:
 *
 * - `"default"` (or no setting): the platform's pictures, as below;
 * - `"none"`: no picture at all — undefined, so no option carries an
 *   `imageUrl` or `imageSrcSet`, no topic carries an `imageUrl`, and every
 *   `imageCount` is 0;
 * - `"own"`: the deployment's own pictures. There is no registry of them yet,
 *   so it shows none, exactly like `"none"`: never the platform's.
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
  // Exactly "default": a value this reader does not know shows nothing.
  if (surfaceCatalogImages() !== "default") return undefined
  return { baseUrl: appBaseUrl(), lookPreviews: isCloud(), srcSet: opts.srcSet === true }
}

/**
 * A still of a picture on the transforming CDN, resized (a frame, for a clip):
 * a URL transform only, applied to whatever picture the caller holds. It never
 * names one of the platform's picker pictures, so the setting above does not
 * apply to it. Re-exported here so this file stays the backend's one importer
 * of the picture maps' module.
 */
export { lookPreviewStillUrl } from "@nodaro/prompts/picker-art"
