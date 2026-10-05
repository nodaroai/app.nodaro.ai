/**
 * How a sign-in tells us the account is blocked.
 *
 * An admin's block bans the account in GoTrue, which then refuses it with the
 * error code `user_banned`: on the AuthError of a password or SSO sign-in, and
 * as `error_code` on the URL an OAuth sign-in returns to (query or fragment,
 * depending on the flow). One place reads both, so every sign-in path shows
 * the same sentence.
 */

const BANNED = "user_banned"

/** A sign-in call failed because the account is blocked. */
export function isBlockedSignIn(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === BANNED
}

/** The OAuth callback URL says the account is blocked. */
export function isBlockedCallback(search: string, hash: string): boolean {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ""))
  return query.get("error_code") === BANNED || fragment.get("error_code") === BANNED
}
