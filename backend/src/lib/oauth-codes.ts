import { randomBytes } from "node:crypto"

const CODE_TTL_MS = 10 * 60_000

interface CodeEntry {
  appId: string
  userId: string
  scopes: string[]
  redirectUri: string
  expiresAt: number
}

interface IssueInput {
  appId: string
  userId: string
  scopes: string[]
  redirectUri: string
}

const store = new Map<string, CodeEntry>()

/** Periodic eviction of expired codes (every 60s). */
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
 * or the redirectUri doesn't match.
 */
export function redeemCode(code: string, redirectUri: string): IssueInput | null {
  const entry = store.get(code)
  if (!entry) return null
  store.delete(code)  // one-shot — delete before checks
  if (Date.now() > entry.expiresAt) return null
  if (entry.redirectUri !== redirectUri) return null
  return {
    appId: entry.appId,
    userId: entry.userId,
    scopes: entry.scopes,
    redirectUri: entry.redirectUri,
  }
}

/** Test-only: clear the store. */
export function _resetForTest(): void {
  store.clear()
}
