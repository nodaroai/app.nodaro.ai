import { LOOK_PREVIEW_SETS } from "./look-preview-sets.js"
import { characterArtPath, characterSectionArtPath, soundArtPath } from "./paths.js"

/**
 * How the API pictures picker options. Pass it to the catalog projections
 * (projectPickerCatalog / projectAllCatalogs / summarizePickerCatalogs); leave
 * it out and no option carries an `imageUrl` — the package itself never
 * decides which host an install is reached at.
 */
export interface PickerImageOptions {
  /**
   * The installation's public origin, e.g. "https://app.nodaro.ai" or a
   * self-hosted "http://localhost:3000". Self-hosted pictures are served from
   * it, so an external app gets absolute URLs on the install it asked.
   */
  readonly baseUrl: string
  /** Include the rendered look previews, which live on the Nodaro CDN (Cloud only). */
  readonly lookPreviews?: boolean
}

/** Hosts whose Cloudflare zone resizes on the fly (`/cdn-cgi/image/`, `/cdn-cgi/media/`). */
const TRANSFORM_HOSTS: ReadonlySet<string> = new Set(["cdn.nodaro.ai", "assets.nodaro.ai"])
const STILL_WIDTH = 480

function originOf(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

/**
 * A still, 480px-wide picture of a rendered look preview: the image resized by
 * the CDN, or — for a clip (camera motion) — a frame taken 1s in. The same
 * transforms the editor's tiles use. A URL off the transforming CDN is kept
 * as is for an image, and dropped for a clip (no still to offer).
 */
export function lookPreviewStillUrl(url: string, width = STILL_WIDTH): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const clip = /\.(mp4|webm|mov)$/i.test(parsed.pathname)
  if (!TRANSFORM_HOSTS.has(parsed.hostname)) return clip ? undefined : url
  return clip
    ? `${parsed.origin}/cdn-cgi/media/mode=frame,time=1s,width=${width}${parsed.pathname}`
    : `${parsed.origin}/cdn-cgi/image/width=${width},format=auto,quality=80${parsed.pathname}`
}

/**
 * The absolute picture URL of one picker option, or undefined when it has
 * none. Self-hosted art (the character photos, the music / voice art) wins;
 * otherwise, when allowed, the option's rendered look preview.
 *
 * @param catalog  the catalog's node type (look previews are keyed by it) and catalog id (the self-hosted maps are)
 * @param field    the dimension field the option belongs to (music / voice art is keyed by it)
 */
export function pickerOptionImageUrl(
  catalog: { readonly nodeType: string; readonly catalogId: string },
  field: string | undefined,
  id: string,
  images: PickerImageOptions,
): string | undefined {
  const origin = originOf(images.baseUrl)
  const own = characterArtPath(catalog.catalogId, id) ?? (field ? soundArtPath(catalog.catalogId, field, id) : undefined)
  if (own) return origin ? origin + own : undefined
  if (!images.lookPreviews) return undefined
  const look = LOOK_PREVIEW_SETS[catalog.nodeType as keyof typeof LOOK_PREVIEW_SETS] as Readonly<Record<string, string>> | undefined
  const render = look?.[id]
  return render ? lookPreviewStillUrl(render) : undefined
}

/** The absolute URL of a Person / Styling topic's round picture, or undefined. */
export function pickerSectionImageUrl(sectionLabel: string, images: PickerImageOptions): string | undefined {
  const origin = originOf(images.baseUrl)
  const path = characterSectionArtPath(sectionLabel)
  return origin && path ? origin + path : undefined
}
