/**
 * Personal API token resolver — shared between the auth middleware
 * (for use across all authenticated routes) and the legacy
 * /v1/api/* route handlers (which need direct access for workflow
 * scope enforcement and rate limiting).
 *
 * Token format: ndr_<64hex>. The middleware in auth.ts strips out the
 * `ndr_app_*` OAuth variant before delegating here, so this resolver
 * only sees personal-token candidates.
 */

import { createHash } from "node:crypto"
import { supabase } from "./supabase.js"

export interface ResolvedToken {
  id: string
  userId: string
  workflowIds: string[]
  rateLimit: number
  tokenHash: string
  /**
   * Workspace this token is bound to, if any.
   *
   * A bound token acts as an implicit workspace header, so every request it
   * makes runs inside that workspace whether or not the client says so. An
   * explicit header on the same request must agree; the context hook refuses
   * the disagreement rather than guessing which was meant.
   */
  workspaceId: string | null
}

declare module "fastify" {
  interface FastifyRequest {
    apiToken?: ResolvedToken
  }
}

const TOKEN_CACHE_TTL_MS = 60_000
const tokenCache = new Map<string, { token: ResolvedToken; expiresAt: number }>()
/** token id → its hash, so a change to a token can find its cache entry. */
const hashById = new Map<string, string>()
const lastUsedUpdates = new Map<string, number>()

/**
 * Forget a token, so the next request re-reads it.
 *
 * The cache is keyed by hash and the plaintext is never stored, so a token
 * cannot be found by id without this index. Without it an edit takes up to a
 * minute to matter — which for the workspace binding means requests running
 * in the workspace the token used to be bound to.
 */
export function invalidateApiTokenCache(tokenId: string): void {
  const hash = hashById.get(tokenId)
  if (!hash) return
  tokenCache.delete(hash)
  hashById.delete(tokenId)
}

export function hashApiToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

export async function resolveApiToken(token: string): Promise<ResolvedToken | null> {
  const hash = hashApiToken(token)

  const cached = tokenCache.get(hash)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token
  }

  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, user_id, workflow_ids, rate_limit, token_hash, is_active, workspace_id")
    .eq("token_hash", hash)
    .single()

  if (error || !data) return null
  if (!data.is_active) return null

  const resolved: ResolvedToken = {
    id: data.id,
    userId: data.user_id as string,
    workflowIds: (data.workflow_ids ?? []) as string[],
    rateLimit: (data.rate_limit as number) ?? 30,
    tokenHash: data.token_hash as string,
    workspaceId: (data.workspace_id as string | null) ?? null,
  }

  tokenCache.set(hash, { token: resolved, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS })
  hashById.set(resolved.id, hash)

  const lastUpdated = lastUsedUpdates.get(data.id) ?? 0
  if (Date.now() - lastUpdated > 300_000) {
    lastUsedUpdates.set(data.id, Date.now())
    supabase
      .from("api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {})
  }

  return resolved
}
