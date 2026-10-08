import { importPKCS8, SignJWT } from "jose"
import { googleErrorMessage, googleErrorReason, GoogleApiError, type FetchLike } from "./google-api.js"
import type { ServiceAccount } from "./setup.js"

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

/** Read-only, both: the account can look at Analytics and Search Console and change nothing. */
export const SITE_ANALYTICS_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
].join(" ")

/** A token is replaced this long before Google says it lapses, so no request starts with one about to expire. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000

const ASSERTION_LIFETIME_S = 3600
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
const TOKEN_TIMEOUT_MS = 15_000

/** The key file's private key would not load or sign — nothing Google said; the key itself is unusable. */
export class KeyFileError extends Error {
  constructor() {
    super("The service account's private key could not be read. Create a new JSON key in Google Cloud and paste it unchanged.")
    this.name = "KeyFileError"
  }
}

async function signedAssertion(account: ServiceAccount, nowMs: number): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000)
  try {
    const key = await importPKCS8(account.privateKey, "RS256")
    return await new SignJWT({ scope: SITE_ANALYTICS_SCOPES })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.clientEmail)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ASSERTION_LIFETIME_S)
      .sign(key)
  } catch {
    // jose's own error names the key's shape, never its bytes; it is replaced, not logged.
    throw new KeyFileError()
  }
}

/**
 * The service account's access token, signed for and traded with Google
 * (the OAuth "JWT bearer" grant) — reused until it is about to lapse; two
 * callers at once share one trade. A refusal is never remembered.
 */
export function createTokenSource(
  account: ServiceAccount,
  deps: { fetch?: FetchLike; now?: () => number } = {},
): () => Promise<string> {
  const fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = deps.now ?? Date.now
  let current: { token: string; expiresAt: number } | null = null
  let inflight: Promise<string> | null = null

  async function trade(): Promise<string> {
    const startedAt = now()
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER, assertion: await signedAssertion(account, startedAt) }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null
    if (!res.ok || typeof body?.access_token !== "string") {
      throw new GoogleApiError(res.status, googleErrorMessage(body, res.status), googleErrorReason(body))
    }
    const lifetimeS = Number(body.expires_in) > 0 ? Number(body.expires_in) : ASSERTION_LIFETIME_S
    current = { token: body.access_token, expiresAt: startedAt + lifetimeS * 1000 }
    return body.access_token
  }

  return async () => {
    if (current && current.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return current.token
    if (inflight) return inflight
    inflight = trade()
    try {
      return await inflight
    } finally {
      inflight = null
    }
  }
}
