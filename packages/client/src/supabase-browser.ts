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
}

/** supabase-js's default localStorage key: `sb-<project-ref>-auth-token`. */
function legacyStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
}

function domainApplies(hostname: string, cookieDomain: string): boolean {
  const bare = cookieDomain.replace(/^\./, "")
  return hostname === bare || hostname.endsWith(`.${bare}`)
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

  const client = createBrowserClient<Db>(opts.url, opts.anonKey, {
    // Each app keeps its own module-level singleton; per-call instances keep
    // tests deterministic.
    isSingleton: false,
    cookieOptions: {
      ...(domain ? { domain } : {}),
      path: "/",
      sameSite: "lax",
      secure: typeof location !== "undefined" && location.protocol === "https:",
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
