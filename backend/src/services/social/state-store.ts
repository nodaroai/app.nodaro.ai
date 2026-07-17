import { redis } from "../../lib/queue.js"

/**
 * Redis-backed one-time stores for the social connect flow. Replaces the old
 * in-memory `Map` in oauth.ts, which broke OAuth on multi-instance Railway
 * deploys (the callback could land on a different instance than the one that
 * issued the state).
 *
 * Two key families, both 10-minute TTL, both consumed exactly once:
 * - `social:state:{state}`   — CSRF state + PKCE verifier between
 *                              auth-url issue and OAuth callback.
 * - `social:pending:{token}` — between-steps selection: encrypted tokens +
 *                              the account list, held server-side while the
 *                              popup shows the picker. Tokens NEVER reach the
 *                              browser; the random token is the only secret
 *                              the popup holds, and it authorizes exactly one
 *                              finalize call.
 */

const TTL_SECONDS = 600

export interface OAuthStateData {
  providerId: string
  userId: string
  codeVerifier?: string
}

export interface PendingSelectionData {
  providerId: string
  userId: string
  /** Encrypted with services/social/encryption.ts before storage. */
  accessTokenEncrypted: string
  refreshTokenEncrypted?: string
  expiresIn?: number
  scopes?: string[]
  accounts: Array<{ id: string; name: string; avatarUrl?: string; rootId?: string }>
}

const stateKey = (state: string) => `social:state:${state}`
const pendingKey = (token: string) => `social:pending:${token}`

export async function saveOAuthState(state: string, data: OAuthStateData): Promise<void> {
  await redis.set(stateKey(state), JSON.stringify(data), "EX", TTL_SECONDS)
}

/** One-time consume: read + delete atomically (MULTI), TTL enforced by Redis. */
export async function consumeOAuthState(state: string): Promise<OAuthStateData | null> {
  const [[, raw]] = (await redis.multi().get(stateKey(state)).del(stateKey(state)).exec()) ?? [[null, null]]
  if (typeof raw !== "string") return null
  try {
    return JSON.parse(raw) as OAuthStateData
  } catch {
    return null
  }
}

export async function savePendingSelection(token: string, data: PendingSelectionData): Promise<void> {
  await redis.set(pendingKey(token), JSON.stringify(data), "EX", TTL_SECONDS)
}

export async function consumePendingSelection(token: string): Promise<PendingSelectionData | null> {
  const [[, raw]] = (await redis.multi().get(pendingKey(token)).del(pendingKey(token)).exec()) ?? [[null, null]]
  if (typeof raw !== "string") return null
  try {
    return JSON.parse(raw) as PendingSelectionData
  } catch {
    return null
  }
}
