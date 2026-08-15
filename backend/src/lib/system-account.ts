/**
 * Identity of the accounts the server creates for ITSELF — today only the
 * tutorial-seed owner. Nothing in `profiles` marks them (no column, no flag),
 * so the email domain is the single source of truth: anything that reasons
 * about "does this install have users yet" must exclude it, and any future
 * server-owned account must be minted under the same domain.
 *
 * Why this exists: once the tutorial seed actually ran on the community stack
 * (2026-08-16), its system account counted as the first user — the setup
 * screen told a brand-new self-hoster their server login was already DONE.
 */
export const SYSTEM_ACCOUNT_DOMAIN = "system.nodaro.local"

export const TUTORIAL_SYSTEM_EMAIL = `tutorials@${SYSTEM_ACCOUNT_DOMAIN}`

/** PostgREST `like` pattern matching every server-owned account. */
export const SYSTEM_ACCOUNT_EMAIL_PATTERN = `%@${SYSTEM_ACCOUNT_DOMAIN}`

export function isSystemAccountEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${SYSTEM_ACCOUNT_DOMAIN}`)
}
