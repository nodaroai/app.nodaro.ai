import { safeFetch, type SafeFetchInit } from "./safe-fetch.js"
import { isOurCdnUrl } from "./cdn-host.js"
import { isConfiguredStorageUrl } from "./own-storage-url.js"
import { sleep } from "./sleep.js"

/**
 * `safeFetch`, plus a bounded retry when OUR OWN media host answers a request
 * for an object we believe exists with a 404 or a 5xx.
 *
 * WHY (app-reports lane G, 2026-09-04): two seedance-2-5 image-to-video jobs
 * died in `ensureImageForProvider` with `Failed to download image: HTTP 404`
 * on a `cdn.nodaro.ai/images/…` object we had written ourselves. Both runs had
 * already reserved credits, so a single unlucky GET took the whole job down.
 * The object serves 200 today.
 *
 * SCOPE, and why it is this narrow:
 *  - OUR host only. A 404 from a provider or a user-supplied third-party URL
 *    is an answer ("that object is not there"), and re-asking would spend the
 *    caller's deadline learning the same thing. A 404 from a host WE write to,
 *    for a key WE just minted, is a contradiction — the only honest readings
 *    are read-after-write lag or a momentary edge blip, both of which a short
 *    pause resolves.
 *  - 404 and 5xx only. 401/403/410/413 are decisions, not blips.
 *  - Bounded by {@link OWN_MEDIA_RETRY_DELAYS_MS}, and the response that is
 *    finally returned is a REAL response — the caller's own error text and
 *    status are unchanged, so nothing downstream learns a new failure shape.
 *
 * WHY EACH RETRY BUSTS THE CACHE: the CDN's media paths (`images/`,
 * `videos/`, `audios/`, `uploads/`) currently cache a 404 at the edge with the
 * same one-year immutable header a real object gets. A GET that reaches the
 * edge before the object lands (or during a read-after-write gap) therefore
 * poisons that URL at that colo, and a plain retry just re-reads the cached
 * 404. Only a URL the edge has never seen reaches R2, so every RETRY appends a
 * unique cache-busting query parameter ({@link cacheBustedUrl}). The FIRST
 * attempt keeps the plain URL so the normal path still gets cache hits. (An
 * earlier probe reported `cf-cache-status: DYNAMIC` here; that is what a HEAD
 * always shows — a GET under these paths is MISS then HIT, 404s included.)
 *
 * WHAT IT DOES NOT COVER: a failure that outlives the ~6 s ladder is not a
 * blip, and a URL already poisoned for OTHER readers stays poisoned until its
 * edge entry is purged — this only lets THIS caller read past it.
 */

/**
 * Pauses before each EXTRA attempt (so 3 entries = 4 attempts in all), ~6 s of
 * added wait in the worst case against a 30 s per-attempt download budget.
 * Short on purpose: this rides in front of a provider call the user is
 * waiting on, and a failure that outlives this ladder is not a blip.
 */
export const OWN_MEDIA_RETRY_DELAYS_MS: readonly number[] = [500, 1_500, 4_000]

/**
 * True when `url` is served by THIS install: the configured CDN origin or
 * fallback host (cloud), or the configured public-storage subtree (self-host
 * MinIO behind the app origin, which `isOurCdnUrl` cannot match because it is
 * http and path-scoped).
 *
 * Reads `process.env` rather than `../lib/config.js` for exactly the reason
 * `own-storage-url.ts` documents: neither variable carries a Zod transform, so
 * the env string IS the config value, and this module is imported by provider
 * code whose test suites partially `doMock` the config module (vitest throws
 * on an export a mock factory did not define). An env read has no mock
 * surface, so a retry gate can never be the thing that breaks an unrelated
 * suite.
 */
export function isOwnMediaUrl(url: string): boolean {
  return (
    isOurCdnUrl(url, process.env.R2_PUBLIC_URL ?? "", process.env.R2_PUBLIC_FALLBACK_DOMAIN ?? "") ||
    isConfiguredStorageUrl(url)
  )
}

/** A status from our own host that contradicts "we wrote this object". */
function isTransientOwnMediaStatus(status: number): boolean {
  return status === 404 || status >= 500
}

/** Free the socket before asking again; an undici body left unread holds it. */
function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => {})
  } catch {
    /* already consumed or not cancellable — nothing to free */
  }
}

/** Query parameter a retry adds so the edge cannot answer from its cache. */
export const OWN_MEDIA_CACHE_BUST_PARAM = "cb"

/**
 * `url` with a unique cache-busting query parameter for retry `attempt`,
 * appended after any query it already carries. A pre-signed URL (SigV4
 * `X-Amz-Signature`) is returned unchanged: an added parameter would break its
 * signature, and a signed request is not served from a shared edge cache.
 */
export function cacheBustedUrl(url: string, attempt: number): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.searchParams.has("X-Amz-Signature")) return url
  const token = `${attempt}-${Math.random().toString(36).slice(2, 10)}`
  // String-append rather than `searchParams.append`: re-serializing through
  // URLSearchParams would re-encode the query already there.
  const hashAt = url.indexOf("#")
  const base = hashAt === -1 ? url : url.slice(0, hashAt)
  const fragment = hashAt === -1 ? "" : url.slice(hashAt)
  const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?"
  return `${base}${sep}${OWN_MEDIA_CACHE_BUST_PARAM}=${token}${fragment}`
}

/**
 * Fetch `url` through `safeFetch`, retrying a 404/5xx from our own media host.
 *
 * The first attempt uses `url` as given; each retry uses a fresh
 * {@link cacheBustedUrl} so a negatively cached 404 cannot defeat the ladder.
 *
 * Returns the last response either way — callers keep their own `res.ok`
 * handling and their own error text. A thrown transport error is NOT retried
 * here: that is the connection ladder's job, and no caller of this helper has
 * reported one.
 */
export async function fetchOwnMedia(url: string, init: SafeFetchInit = {}): Promise<Response> {
  let res = await safeFetch(url, init)
  if (res.ok || !isTransientOwnMediaStatus(res.status) || !isOwnMediaUrl(url)) return res

  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return "<unparsable>"
    }
  })()
  const total = OWN_MEDIA_RETRY_DELAYS_MS.length + 1
  for (let i = 0; i < OWN_MEDIA_RETRY_DELAYS_MS.length; i++) {
    const pause = OWN_MEDIA_RETRY_DELAYS_MS[i]
    // Host only, never the path: object keys can carry signed query values.
    console.warn(
      `[own-media-retry] ${host} answered HTTP ${res.status} for an object we wrote — ` +
        `attempt ${i + 2}/${total} in ${pause} ms`,
    )
    discard(res)
    await sleep(pause)
    res = await safeFetch(cacheBustedUrl(url, i + 2), init)
    if (res.ok || !isTransientOwnMediaStatus(res.status)) return res
  }
  console.warn(`[own-media-retry] ${host} still HTTP ${res.status} after ${total} attempts`)
  return res
}
