/**
 * Which sibling site the user came from — so "back to chat" and re-login lead
 * to it rather than to one fixed address.
 *
 * A deployment's sibling (e.g. its chat product) can run as a family of sites
 * under one domain: the shared `example.com` plus per-community subdomains such
 * as `gur.example.com`, each with its own login session and some of them the
 * only one a given user can reach. The studio learns which one the user came
 * from out of `document.referrer` on page load (the chat sites send their
 * origin under `strict-origin-when-cross-origin`), keeps it per studio origin
 * in localStorage, and uses it for:
 *   - the sibling link (`resolveSiblingUrl`), and
 *   - the SSO login entry (`ssoEntryPath`), which passes it to the backend as
 *     `via`; the backend accepts it only inside the host its own config names.
 *
 * Only DEPLOYMENT-PROFILE siblings take part — never the Nodaro code-default
 * family — so a deployment that configures no siblings behaves exactly as
 * before. Remembering is best-effort: a miss (no referrer, the studio itself,
 * an unrelated site, storage blocked) never clears what is stored, and with
 * nothing stored every URL is the configured one.
 */
import { runtimeSurfaceProfile, type SurfaceSibling } from "./surface-profile"

const STORAGE_KEY = "nodaro.siblingOrigin"

function currentHostname(): string {
  return typeof window !== "undefined" ? window.location.hostname : ""
}

/** The configured sibling URL for the hostname the browser is on. */
function configuredUrl(s: SurfaceSibling, host: string): string {
  const byHost = s.urlByHost
  return byHost && Object.prototype.hasOwnProperty.call(byHost, host) ? byHost[host] : s.url
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** `host` is `base` or one of its subdomains — and not the studio itself. */
function withinSibling(host: string, base: string, studioHost: string): boolean {
  if (!host || host === studioHost) return false
  return host === base || host.endsWith(`.${base}`)
}

/** A bare https origin (the shape a referrer origin has), else null. */
function httpsOrigin(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

/** The remembered sibling origin (e.g. `https://gur.example.com`), if any. */
export function rememberedSiblingOrigin(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw && httpsOrigin(raw) ? raw : null
  } catch {
    return null
  }
}

/**
 * On page load: when the referrer is a site inside one of the deployment's
 * siblings, remember its origin. Call once at startup.
 */
export function rememberSiblingOrigin(): void {
  if (typeof document === "undefined" || !document.referrer) return
  const ref = httpsOrigin(document.referrer)
  if (!ref) return
  const studioHost = currentHostname()
  const matches = runtimeSurfaceProfile().siblings.apps.some((s) => {
    const base = hostnameOf(configuredUrl(s, studioHost))
    return base !== null && withinSibling(ref.hostname, base, studioHost)
  })
  if (!matches) return
  try {
    window.localStorage.setItem(STORAGE_KEY, ref.origin)
  } catch {
    // storage blocked — the configured URL still works
  }
}

/**
 * The URL a sibling link opens: the configured one for this hostname, moved
 * onto the remembered origin when that origin is inside it (path kept).
 */
export function resolveSiblingUrl(s: SurfaceSibling): string {
  const studioHost = currentHostname()
  const url = configuredUrl(s, studioHost)
  const remembered = rememberedSiblingOrigin()
  if (!remembered) return url
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return url
  }
  const host = new URL(remembered).hostname
  if (target.protocol !== "https:" || !withinSibling(host, target.hostname, studioHost)) return url
  target.hostname = host
  return target.toString()
}

/** The SSO login entry for a provider, carrying the remembered origin as `via`. */
export function ssoEntryPath(providerId: string): string {
  const path = `/v1/sso/${encodeURIComponent(providerId)}`
  const via = rememberedSiblingOrigin()
  return via ? `${path}?via=${encodeURIComponent(via)}` : path
}
