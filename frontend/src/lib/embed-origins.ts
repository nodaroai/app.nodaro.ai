import { isRecord, type PopupMessageTransport } from "@/lib/popup-message"

/**
 * Trusted parent-frame origins for the cross-origin embed session handoff
 * (see `use-embed-session-handoff`). When app.nodaro.ai is embedded in another
 * Nodaro surface (e.g. studio.nodaro.ai's pricing/billing iframe), localStorage
 * is partitioned per-origin, so the parent must hand us the Supabase session via
 * postMessage. We only accept that handoff from a FIRST-PARTY origin.
 *
 * Allow-listing is domain-driven, not a hardcoded host list: any https
 * `*.nodaro.ai` (and the apex) is first-party and trusted — that covers
 * `studio.nodaro.ai`, future `next.studio.nodaro.ai`, etc. without edits here —
 * except the hosts that serve stored files (`STORED_FILE_HOSTS`).
 *
 * A parent on this page's OWN https origin is trusted too: a product served
 * from the same site as this app — as on a white-label deployment that serves
 * every product from one host — that frames an account page. It grants
 * nothing such a parent does not already have: a page on this origin reads
 * and writes this origin's cookies and storage, the session included. On
 * Nodaro's own hosts the rule above already admits it, so nothing changes
 * there; a stored-file host stays refused even as its own parent.
 *
 * localhost is allowed only in dev. Everything else is rejected.
 */

export interface EmbedParentOptions {
  /** Allow `localhost` / `127.0.0.1` parents. Defaults to dev builds only. */
  readonly allowLocalhost?: boolean
  /** This page's own origin (`window.location.origin`), which a parent may share. Absent: no parent is trusted for sharing it. */
  readonly selfOrigin?: string
}

/** `raw` as a serialized https origin, or undefined. */
function httpsOriginOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === "https:" ? url.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * The hosts under nodaro.ai that serve stored files (uploads and run outputs)
 * rather than a Nodaro surface. A page served from one of them is never a
 * parent that may hand us a session, whatever the domain rule says. The same
 * pair the image transform serves (`TRANSFORMABLE_HOSTS` in `lib/image.ts`,
 * `CDN_TRANSFORM_HOSTS` on the backend). Exact hostnames.
 */
const STORED_FILE_HOSTS: ReadonlySet<string> = new Set(["cdn.nodaro.ai", "assets.nodaro.ai"])

/** Whether `origin` (an exact origin string, e.g. `MessageEvent.origin`) may hand us a session. */
export function isAllowedEmbedParent(
  origin: string,
  { allowLocalhost = import.meta.env.DEV, selfOrigin }: EmbedParentOptions = {},
): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    // `"null"`, `""`, opaque origins, etc.
    return false
  }

  const host = url.hostname

  // First-party: https nodaro.ai or any subdomain of it. Use a hostname check
  // (not substring) so look-alikes like `nodaro.ai.evil.com` or `evil-nodaro.ai`
  // are rejected.
  if (url.protocol === "https:" && (host === "nodaro.ai" || host.endsWith(".nodaro.ai"))) {
    return !STORED_FILE_HOSTS.has(host)
  }

  // This page's own https origin (see the header). Compared as serialized
  // origins, so scheme, host and port must all match.
  const own = httpsOriginOf(selfOrigin)
  if (own !== undefined && url.protocol === "https:" && url.origin === own) {
    return true
  }

  if (allowLocalhost && (host === "localhost" || host === "127.0.0.1")) {
    return true
  }

  return false
}

/** The two messages a parent hands over: the session, or word that it has none. */
export const EMBED_SET_SESSION = "nodaro:setSession"
export const EMBED_NO_SESSION = "nodaro:noSession"

export type EmbedSessionVerdict =
  | { readonly kind: "ignore" }
  | { readonly kind: "session"; readonly accessToken: string; readonly refreshToken: string }
  | { readonly kind: "no-session" }

const IGNORE: EmbedSessionVerdict = { kind: "ignore" }
const NO_SESSION: EmbedSessionVerdict = { kind: "no-session" }

/**
 * The one check every `message` event goes through while this page, framed,
 * waits for its parent's session. It is taken only from `parent` (the caller's
 * `window.parent`, compared by identity), on a first-party origin, in one of the
 * two expected shapes. A sibling frame, a window this page opened, or any other
 * window can be on a first-party origin too, so the origin alone is not enough.
 * Anything else is `ignore`, and the caller then changes nothing.
 */
export function classifyEmbedSessionMessage(
  transport: PopupMessageTransport,
  parent: unknown,
  options?: EmbedParentOptions,
): EmbedSessionVerdict {
  if (parent === null || parent === undefined || transport.source !== parent) return IGNORE
  if (!isAllowedEmbedParent(transport.origin, options)) return IGNORE

  const data = transport.data
  if (!isRecord(data)) return IGNORE
  if (data.type === EMBED_SET_SESSION) {
    const { access_token: accessToken, refresh_token: refreshToken } = data
    if (typeof accessToken !== "string" || accessToken === "") return IGNORE
    if (typeof refreshToken !== "string" || refreshToken === "") return IGNORE
    return { kind: "session", accessToken, refreshToken }
  }
  if (data.type === EMBED_NO_SESSION) return NO_SESSION
  return IGNORE
}
