import { createHash, randomBytes } from "node:crypto"
import { supabase } from "./supabase.js"
import { formatScopeString } from "./scopes.js"

export const ACCESS_TOKEN_TTL_DAYS = 90

export interface MintInput {
  appId: string
  userId: string
  scopes: string[]
}

export type MintResult =
  | { ok: true; accessToken: string; tokenType: "Bearer"; scope: string; expiresIn: number }
  | { ok: false; failed: "authorization" | "token" }

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/**
 * Mints an `ndr_app_` access token for a consented grant: upserts the app↔user
 * authorization (re-consenting revives a revoked one) and stores only the
 * token's hash. Shared by the RFC 6749 token endpoint and the plugin connect
 * handshake, so the two paths cannot drift in what a token is.
 */
export async function mintAppAccessToken(input: MintInput): Promise<MintResult> {
  const { data: auth, error: authErr } = await supabase
    .from("developer_app_authorizations")
    .upsert(
      {
        app_id: input.appId,
        user_id: input.userId,
        scopes_granted: input.scopes,
        revoked_at: null,
      },
      { onConflict: "app_id,user_id" },
    )
    .select("id")
    .single()
  if (authErr || !auth) return { ok: false, failed: "authorization" }

  const plaintext = `ndr_app_${randomBytes(32).toString("hex")}`
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { error: tokErr } = await supabase.from("developer_app_tokens").insert({
    authorization_id: auth.id,
    token_hash: hashToken(plaintext),
    token_prefix: `${plaintext.slice(0, 12)}...`,
    expires_at: expiresAt,
  })
  if (tokErr) return { ok: false, failed: "token" }

  return {
    ok: true,
    accessToken: plaintext,
    tokenType: "Bearer",
    scope: formatScopeString(input.scopes),
    expiresIn: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
  }
}
