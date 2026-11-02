/**
 * The address decoder of the content restrictions (migration 581): the
 * storage key an address of ours names. A light module on purpose (the
 * config and two pure helpers): the job gate, the proxies and the
 * restriction module all decode through it, and none of them has to load
 * the storage client to do so.
 */
import { config } from "./config.js"
import { isOurCdnUrl } from "./cdn-host.js"
import { originalCdnImageUrl } from "./cdn-original-url.js"
import { r2KeyFromPublicUrl } from "./r2-public-key.js"

/** The path prefix of Cloudflare's image and media transforms (a rendition of one of our files, on any host of ours). */
const CDN_TRANSFORM = /^\/cdn-cgi\/(?:image|media)\/[^/]+\//

/** A transform whose source is a whole address of ours is followed, this many times at most. */
const MAX_NESTED_TRANSFORMS = 2

/**
 * The storage key an address of ours names, as stored: a display rendition's
 * original, a media transform's source (a whole address of ours included),
 * the fallback host's path, an http address as the https one, with every
 * percent-escape decoded (the storage decodes them too, so `%61` and `a` name
 * the same object). Null for an address that is not ours.
 */
export function restrictedKeyOfAddress(url: string): string | null {
  return keyOfAddress(url, 0)
}

function keyOfAddress(url: string, depth: number): string | null {
  let parsed: URL
  try {
    parsed = new URL(originalCdnImageUrl(url))
  } catch {
    return null
  }
  // The network serves our files on http as on https (an upgrade, or the
  // bytes): the scheme is not what makes an address ours.
  if (parsed.protocol === "http:") parsed.protocol = "https:"
  const bases = publicBases()
  if (!isOurCdnUrl(parsed.toString(), bases.publicUrl, bases.fallbackDomain)) return null
  parsed.search = ""
  parsed.hash = ""
  const path = parsed.pathname.replace(CDN_TRANSFORM, "/")
  // A transform's source may be a whole address (`/cdn-cgi/image/<opts>/https://<host>/<key>`):
  // the key is that address's.
  const rest = path.replace(/^\/+/, "")
  if (/^https?:\/\//i.test(decodeSafely(rest))) {
    return depth < MAX_NESTED_TRANSFORMS ? keyOfAddress(decodeSafely(rest), depth + 1) : null
  }
  parsed.pathname = path
  const key = r2KeyFromPublicUrl(parsed.toString(), bases.publicUrl) ?? rest
  if (!key) return null
  return decodeSafely(key)
}

/**
 * The deployment's public base and fallback host. A deployment with neither
 * (a process whose config has no storage at all) has no addresses of its own,
 * so nothing it is asked about is restricted.
 */
function publicBases(): { publicUrl: string; fallbackDomain: string } {
  try {
    return { publicUrl: config.R2_PUBLIC_URL ?? "", fallbackDomain: config.R2_PUBLIC_FALLBACK_DOMAIN ?? "" }
  } catch {
    return { publicUrl: "", fallbackDomain: "" }
  }
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
