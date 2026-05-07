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
}

declare module "fastify" {
  interface FastifyRequest {
    apiToken?: ResolvedToken
  }
}

const TOKEN_CACHE_TTL_MS = 60_000
const tokenCache = new Map<string, { token: ResolvedToken; expiresAt: number }>()
const lastUsedUpdates = new Map<string, number>()

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
    .select("id, user_id, workflow_ids, rate_limit, token_hash, is_active")
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
  }

  tokenCache.set(hash, { token: resolved, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS })

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
