import { randomBytes } from "node:crypto"

const CODE_TTL_MS = 10 * 60_000

interface CodeEntry {
  appId: string
  userId: string
  scopes: string[]
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: "S256"
  expiresAt: number
}

export interface IssueInput {
  appId: string
  userId: string
  scopes: string[]
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: "S256"
}

export interface RedeemedGrant {
  appId: string
  userId: string
  scopes: string[]
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: "S256"
}

const store = new Map<string, CodeEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [code, entry] of store) {
    if (entry.expiresAt <= now) store.delete(code)
  }
}, 60_000).unref()

export function issueCode(input: IssueInput): string {
  const code = `ndr_code_${randomBytes(24).toString("hex")}`
  store.set(code, {
    ...input,
    expiresAt: Date.now() + CODE_TTL_MS,
  })
  return code
}

/**
 * Redeems a code. Returns null if the code is missing, expired, already used,
 * or the redirectUri doesn't match. Returns the stored PKCE challenge so the
 * caller can verify code_verifier.
 */
export function redeemCode(code: string, redirectUri: string): RedeemedGrant | null {
  const entry = store.get(code)
  if (!entry) return null
  store.delete(code)
  if (Date.now() > entry.expiresAt) return null
  if (entry.redirectUri !== redirectUri) return null
  return {
    appId: entry.appId,
    userId: entry.userId,
    scopes: entry.scopes,
    redirectUri: entry.redirectUri,
    codeChallenge: entry.codeChallenge,
    codeChallengeMethod: entry.codeChallengeMethod,
  }
}

export function _resetForTest(): void {
  store.clear()
}
