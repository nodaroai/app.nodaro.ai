import { trackEvent } from "./site-analytics"

/**
 * `sign_up` / `login` for the site analytics, reported where a sign-in
 * COMPLETES (the OAuth callback, the SSO landing) — never from the session
 * listener, which also fires on a token refresh and on tab focus and would
 * count every visit as a sign-in.
 *
 * A sign-up is an account's first sign-in: its `last_sign_in_at` within two
 * minutes of its `created_at` (both stamped by the auth server; the browser's
 * clock stands in only when the server sent no sign-in time). Reported once
 * per account on a browser.
 */

/** The parts of the auth server's user this reads. */
export interface SignInUser {
  readonly id: string
  readonly created_at?: string
  readonly last_sign_in_at?: string
  readonly app_metadata?: { readonly provider?: unknown }
}

const FIRST_SIGN_IN_WINDOW_MS = 2 * 60_000
const REPORTED_SIGN_UPS_KEY = "nodaro.analytics.signUps"
const REPORTED_SIGN_UPS_KEPT = 20

/** Is this sign-in the account's first one? */
export function isFirstSignIn(user: SignInUser, now: number = Date.now()): boolean {
  const created = Date.parse(user.created_at ?? "")
  if (!Number.isFinite(created)) return false
  const parsed = Date.parse(user.last_sign_in_at ?? "")
  const signedIn = Number.isFinite(parsed) ? parsed : now
  return Math.abs(signedIn - created) <= FIRST_SIGN_IN_WINDOW_MS
}

/** The identity provider the account signed in with ("google", "email", …), or "other". */
export function signInMethodOf(user: SignInUser): string {
  const provider = user.app_metadata?.provider
  return typeof provider === "string" && /^[a-z0-9_-]{1,32}$/.test(provider) ? provider : "other"
}

/** Report a completed sign-in. Never throws, whatever it is handed. */
export function reportSignIn(user: SignInUser, method?: string): void {
  try {
    const how = method ?? signInMethodOf(user)
    if (isFirstSignIn(user) && rememberSignUp(user.id)) {
      trackEvent("sign_up", { method: how })
      return
    }
    trackEvent("login", { method: how })
  } catch {
    // Analytics never breaks a sign-in.
  }
}

// This page's own note of the sign-ups it reported, for a browser whose
// storage cannot keep one.
const reportedThisPage = new Set<string>()

/** Note the account's sign-up as reported; false when it already was on this browser. */
function rememberSignUp(userId: string): boolean {
  if (reportedThisPage.has(userId)) return false
  reportedThisPage.add(userId)
  let reported: string[] = []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REPORTED_SIGN_UPS_KEY) ?? "[]")
    if (Array.isArray(parsed)) reported = parsed.filter((id): id is string => typeof id === "string")
  } catch {
    reported = []
  }
  if (reported.includes(userId)) return false
  try {
    localStorage.setItem(REPORTED_SIGN_UPS_KEY, JSON.stringify([...reported, userId].slice(-REPORTED_SIGN_UPS_KEPT)))
  } catch {
    // Storage unavailable: the sign-up is still reported, once for this page.
  }
  return true
}
