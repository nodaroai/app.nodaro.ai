/**
 * Trusted parent-frame origins for the cross-origin embed session handoff
 * (see `use-embed-session-handoff`). When app.nodaro.ai is embedded in another
 * Nodaro surface (e.g. studio.nodaro.ai's pricing/billing iframe), localStorage
 * is partitioned per-origin, so the parent must hand us the Supabase session via
 * postMessage. We only accept that handoff from a FIRST-PARTY origin.
 *
 * Allow-listing is domain-driven, not a hardcoded host list: any https
 * `*.nodaro.ai` (and the apex) is first-party and trusted — that covers
 * `studio.nodaro.ai`, future `next.studio.nodaro.ai`, etc. without edits here.
 * localhost is allowed only in dev. Everything else is rejected.
 */

export interface EmbedParentOptions {
  /** Allow `localhost` / `127.0.0.1` parents. Defaults to dev builds only. */
  readonly allowLocalhost?: boolean
}

/** Whether `origin` (an exact origin string, e.g. `MessageEvent.origin`) may hand us a session. */
export function isAllowedEmbedParent(
  origin: string,
  { allowLocalhost = import.meta.env.DEV }: EmbedParentOptions = {},
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
    return true
  }

  if (allowLocalhost && (host === "localhost" || host === "127.0.0.1")) {
    return true
  }

  return false
}
