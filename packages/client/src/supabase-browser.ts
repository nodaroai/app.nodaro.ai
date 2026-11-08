import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Browser Supabase client with session storage in cookies instead of
 * localStorage, so several apps on sibling subdomains (e.g. app/studio/voice
 * on *.nodaro.ai) share one login: sign in on any of them, signed in on all;
 * sign out anywhere, signed out everywhere (supabase-js signOut defaults to
 * the global scope).
 */
export interface SharedSupabaseOptions {
  /** Supabase project URL (https://<ref>.supabase.co). */
  url: string
  anonKey: string
  /**
   * Cookie Domain for cross-subdomain sharing (e.g. ".nodaro.ai"). Applied
   * only when the page's hostname is that domain or a subdomain of it; on any
   * other host (localhost, preview URLs) cookies stay host-only, which keeps
   * local dev on per-origin sessions.
   */
  cookieDomain?: string
  /**
   * Supabase project URLs this deployment no longer uses, such as a project
   * it moved away from. Creating the client in a browser deletes the cookies
   * such a project left behind: every cookie named `sb-<project-ref>-…` (the
   * session and its chunks, the PKCE code verifiers, the stored user), both
   * on `cookieDomain` and host-only. Nothing reads them any more, yet the
   * browser sends them with every request to every host they cover until
   * they expire, a year after their last write. The current project (`url`)
   * is never cleared, even when it is listed.
   */
  retiredSupabaseUrls?: readonly string[]
}

/** Where the client's cookies live; a delete has to match it to take effect. */
interface CookieScope {
  domain?: string
  path: string
  sameSite: "lax"
  secure: boolean
}

/** First label of a project URL's host: the `<project-ref>` of supabase-js's storage key. */
function projectLabel(url: string): string {
  return new URL(url).hostname.split(".")[0]
}

/** supabase-js's default localStorage key: `sb-<project-ref>-auth-token`. */
function legacyStorageKey(url: string): string {
  return `sb-${projectLabel(url)}-auth-token`
}

function domainApplies(hostname: string, cookieDomain: string): boolean {
  const bare = cookieDomain.replace(/^\./, "")
  return hostname === bare || hostname.endsWith(`.${bare}`)
}

/**
 * Deletes the cookies the retired projects left in this browser: every name
 * starting `sb-<project-ref>-`, at both places one can live, on the cookie
 * domain (when it applies here) and host-only, written with `Max-Age=0` and
 * the client's own Path/SameSite/Secure.
 *
 * The current project is never touched. Its label is skipped even when
 * listed, and a name under its own prefix is kept even when a retired prefix
 * also matches it (a retired `auth` beside a current `auth-eu`).
 *
 * Deliberately an explicit list, not "every project but this one": two
 * projects in use at once (production and a staging project on the same
 * parent domain, say) can share one cookie domain, and that rule would have
 * each of them delete the other's sessions.
 *
 * Best effort: a page that cannot touch its cookies (a sandboxed frame)
 * simply keeps them.
 */
function clearRetiredProjectCookies(
  retiredUrls: readonly string[] | undefined,
  currentUrl: string,
  scope: CookieScope
): void {
  if (!retiredUrls?.length || typeof document === "undefined") return
  try {
    const current = projectLabel(currentUrl)
    const prefixes: string[] = []
    for (const url of retiredUrls) {
      let label: string
      try {
        label = projectLabel(url)
      } catch {
        continue // not a URL
      }
      if (label && label !== current) prefixes.push(`sb-${label}-`)
    }
    if (prefixes.length === 0) return

    const own = `sb-${current}-`
    const names = new Set<string>()
    for (const pair of document.cookie.split(";")) {
      const name = pair.split("=")[0].trim()
      if (!name.startsWith(own) && prefixes.some((p) => name.startsWith(p))) {
        names.add(name)
      }
    }
    const attributes = `; Path=${scope.path}; Max-Age=0; SameSite=${scope.sameSite}${scope.secure ? "; Secure" : ""}`
    for (const name of names) {
      if (scope.domain) document.cookie = `${name}=; Domain=${scope.domain}${attributes}`
      document.cookie = `${name}=${attributes}`
    }
  } catch {
    // Cookies are not available on this page; there is nothing to clear.
  }
}

/**
 * One-time adoption of a pre-cookie session this origin left in localStorage,
 * so already-signed-in users survive the storage switch. setSession persists
 * through the client's (cookie) storage; dead tokens reject and the user is
 * simply signed out. The legacy key is removed in every outcome.
 * Returns null when there is nothing to migrate.
 */
function migrateLegacySession(
  client: SupabaseClient<any>,
  url: string
): Promise<void> | null {
  if (typeof localStorage === "undefined") return null
  const key = legacyStorageKey(url)
  const raw = localStorage.getItem(key)
  if (!raw) return null
  return (async () => {
    try {
      const parsed = JSON.parse(raw) as {
        access_token?: string
        refresh_token?: string
      }
      if (parsed.access_token && parsed.refresh_token) {
        await client.auth.setSession({
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
        })
      }
    } catch {
      // Unparseable or dead legacy session — discard; the user logs in again.
    } finally {
      localStorage.removeItem(key)
    }
  })()
}

export function createSharedSupabaseClient<Db = any>(
  opts: SharedSupabaseOptions
): SupabaseClient<Db> {
  const hostname = typeof location !== "undefined" ? location.hostname : ""
  const domain =
    opts.cookieDomain && domainApplies(hostname, opts.cookieDomain)
      ? opts.cookieDomain
      : undefined
  // One scope for the cookies the client writes and the ones it deletes.
  const scope: CookieScope = {
    ...(domain ? { domain } : {}),
    path: "/",
    sameSite: "lax",
    secure: typeof location !== "undefined" && location.protocol === "https:",
  }

  const client = createBrowserClient<Db>(opts.url, opts.anonKey, {
    // Each app keeps its own module-level singleton; per-call instances keep
    // tests deterministic.
    isSingleton: false,
    cookieOptions: {
      ...scope,
      // Long-lived cookie; real session validity is governed by refresh-token
      // rotation, not cookie lifetime.
      maxAge: 60 * 60 * 24 * 365,
    },
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      // Bypass Navigator Lock API: prevents AbortError from
      // @supabase/auth-js/locks.ts during session synchronization; cross-tab
      // coordination is non-critical for these apps.
      lock: async <R>(
        _name: string,
        _acquireTimeout: number,
        fn: () => Promise<R>
      ): Promise<R> => fn(),
    },
  })

  clearRetiredProjectCookies(opts.retiredSupabaseUrls, opts.url, scope)

  const migration = migrateLegacySession(client as SupabaseClient<any>, opts.url)
  if (migration) {
    // Gate reads on the one-time migration so the first getSession() after the
    // storage switch can't race it — keeps call sites unchanged in the apps.
    const orig = client.auth.getSession.bind(client.auth)
    client.auth.getSession = async () => {
      await migration
      return orig()
    }
  }

  return client
}
