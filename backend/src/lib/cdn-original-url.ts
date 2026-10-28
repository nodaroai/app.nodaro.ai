/**
 * The ORIGINAL file behind a display rendition of one of our CDN images.
 *
 * Every client shows pictures through Cloudflare's image transform
 * (`https://cdn.nodaro.ai/cdn-cgi/image/<options>/<path>`): smaller, resized,
 * and with `format=auto` re-encoded to whatever the browser takes (often
 * AVIF). That rendition is for DISPLAY. Sent as a generation input it hands
 * the model a downscaled copy in a format our own image preparation may not
 * decode, and every download of it makes the edge transform the full-size
 * original again. When one reaches a job anyway (a copied image address, a
 * client that forwarded what it rendered), the input is rewritten to the
 * file itself: `/<path>` on the same host.
 *
 * Only `/cdn-cgi/image/`: a `/cdn-cgi/media/` URL (a frame of a VIDEO, or a
 * resized clip) has no image original to fall back to. Only our own hosts:
 * another site's `/cdn-cgi/` is its own business. Cloudflare's remote-source
 * form (`/cdn-cgi/image/<options>/https://elsewhere/…`) is left as it is, so
 * a rewrite can never move a URL to another host.
 */

/** The path prefix of Cloudflare's image transform. */
export const CDN_IMAGE_TRANSFORM_PREFIX = "/cdn-cgi/image/"

/**
 * The hosts whose Cloudflare zone serves the image transform: the same set as
 * the editor's `TRANSFORMABLE_HOSTS` (`frontend/src/lib/image.ts`). Exact
 * hostnames, never a suffix match.
 */
export const CDN_TRANSFORM_HOSTS: ReadonlySet<string> = new Set(["cdn.nodaro.ai", "assets.nodaro.ai"])

/** `url` with a display rendition of our CDN rewritten to its original file; any other URL unchanged. */
export function originalCdnImageUrl(url: string): string {
  if (!url.includes(CDN_IMAGE_TRANSFORM_PREFIX)) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== "https:" || !CDN_TRANSFORM_HOSTS.has(parsed.hostname)) return url
  if (!parsed.pathname.startsWith(CDN_IMAGE_TRANSFORM_PREFIX)) return url
  const rest = parsed.pathname.slice(CDN_IMAGE_TRANSFORM_PREFIX.length)
  const slash = rest.indexOf("/")
  // No options, or nothing after them: not a rendition we can read.
  if (slash <= 0) return url
  const source = rest.slice(slash + 1)
  // Empty, protocol-relative or a remote source (`https:/…`, `https%3A…`): left alone.
  if (!source || source.startsWith("/") || /^https?(:|%3a)/i.test(source)) return url
  return `${parsed.origin}/${source}${parsed.search}${parsed.hash}`
}

/** {@link originalCdnImageUrl} over a list, as a new array. */
export function originalCdnImageUrls(urls: readonly string[]): string[] {
  return urls.map(originalCdnImageUrl)
}

const rewriteString = (v: unknown): unknown => (typeof v === "string" ? originalCdnImageUrl(v) : v)
const rewriteList = (v: unknown): unknown => (Array.isArray(v) ? v.map(rewriteString) : v)

/** The image-URL fields of a video request body, each with how it is rewritten. */
const VIDEO_BODY_IMAGE_FIELDS: Readonly<Record<string, (v: unknown) => unknown>> = {
  imageUrl: rewriteString,
  endFrameUrl: rewriteString,
  last_frame_image: rewriteString,
  referenceImageUrls: rewriteList,
  connectedReferences: (v) =>
    Array.isArray(v)
      ? v.map((r) => (r && typeof r === "object" && "url" in r ? { ...r, url: rewriteString((r as { url: unknown }).url) } : r))
      : v,
  characterReferences: (v) =>
    Array.isArray(v)
      ? v.map((c) => {
          if (!c || typeof c !== "object") return c
          const ref = c as Record<string, unknown>
          return {
            ...ref,
            ...("imageUrl" in ref ? { imageUrl: rewriteString(ref.imageUrl) } : {}),
            ...("bodyImageUrl" in ref ? { bodyImageUrl: rewriteString(ref.bodyImageUrl) } : {}),
            ...("extraImageUrls" in ref ? { extraImageUrls: rewriteList(ref.extraImageUrls) } : {}),
          }
        })
      : v,
}

/**
 * A video request body (`/v1/generate-video`, `/v1/text-to-video`) with every
 * image input (frames, reference images, connected and character references)
 * on its original file. A copy; the body itself is not changed. Anything
 * that is not a plain object is returned as it is, for the route's own
 * validation to answer.
 */
export function withOriginalVideoImageUrls<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }
  for (const [field, rewrite] of Object.entries(VIDEO_BODY_IMAGE_FIELDS)) {
    if (Object.hasOwn(src, field)) out[field] = rewrite(src[field])
  }
  return out as T
}
