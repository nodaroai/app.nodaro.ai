import { createHash, randomBytes } from "node:crypto"
import { supabase } from "./supabase.js"
import { formatScopeString } from "./scopes.js"
import { isMissingColumnError } from "./postgrest-errors.js"

export const ACCESS_TOKEN_TTL_DAYS = 90

/**
 * `developer_app_tokens.grant_type` of a token the MCP assertion exchange
 * issued (RFC 7523's grant type; migration 651, decided 2026-11-11). Every
 * other token — a consent's, a plugin connection's, every token from before
 * the column — carries null there.
 */
export const ASSERTION_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer"

/** An exchanged token that expired longer ago than this is pruned at the grant's next exchange (the connected-apps view reads a grant's tokens). */
const EXCHANGED_TOKEN_KEEP_MS = 24 * 60 * 60 * 1000

export interface MintInput {
  appId: string
  userId: string
  scopes: string[]
  /**
   * Set ONLY by the MCP assertion exchange (`routes/oauth-assertion-exchange.ts`):
   * the token lives `ttlSeconds` instead of 90 days, carries the exchange's
   * grant type, and a grant the person revoked is never revived (they revoked
   * it; only a consent of their own brings it back). Absent: exactly the
   * writes a consent has always made.
   */
  assertionExchange?: { ttlSeconds: number }
}

export type MintResult =
  | { ok: true; accessToken: string; tokenType: "Bearer"; scope: string; expiresIn: number }
  /** `revoked` and `not_migrated` (the database lacks the grant-type column) only for an exchange. */
  | { ok: false; failed: "authorization" | "token" | "revoked" | "not_migrated" }

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

function newPlaintext(): string {
  return `ndr_app_${randomBytes(32).toString("hex")}`
}

/**
 * Mints an `ndr_app_` access token for a consented grant: upserts the app↔user
 * authorization (re-consenting revives a revoked one) and stores only the
 * token's hash. Shared by the RFC 6749 token endpoint, the plugin connect
 * handshake and the MCP assertion exchange, so the paths cannot drift in what
 * a token is.
 */
export async function mintAppAccessToken(input: MintInput): Promise<MintResult> {
  if (input.assertionExchange) return mintExchangedAccessToken(input, input.assertionExchange.ttlSeconds)

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

  const plaintext = newPlaintext()
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

/**
 * The exchange's grant row: the person's existing (app, person) authorization
 * with its scopes set to the ones asked — the latest grant decides, as a
 * consent's upsert does — or a new one. A REVOKED row is never revived; the
 * write is conditional on `revoked_at is null`, so a revoke landing between
 * the read and the write still wins.
 */
async function exchangeAuthorization(input: MintInput, retried = false): Promise<{ id: string } | "revoked" | "error"> {
  const { data: existing, error: readErr } = await supabase
    .from("developer_app_authorizations")
    .select("id, revoked_at")
    .eq("app_id", input.appId)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (readErr) return "error"
  if (existing) {
    const row = existing as { id: string; revoked_at: string | null }
    if (row.revoked_at) return "revoked"
    const { data: updated, error: updateErr } = await supabase
      .from("developer_app_authorizations")
      .update({ scopes_granted: input.scopes })
      .eq("id", row.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle()
    if (updateErr) return "error"
    return updated ? { id: (updated as { id: string }).id } : "revoked"
  }
  const { data: created, error: insertErr } = await supabase
    .from("developer_app_authorizations")
    .insert({ app_id: input.appId, user_id: input.userId, scopes_granted: input.scopes })
    .select("id")
    .single()
  if (!insertErr && created) return { id: (created as { id: string }).id }
  // A concurrent first exchange for the same person made the row first: read it once more.
  if (insertErr?.code === "23505" && !retried) return exchangeAuthorization(input, true)
  return "error"
}

let grantTypeColumnSeen = false

/** Tests only: forget that the column was seen. */
export function __resetGrantTypeColumnProbeForTests(): void {
  grantTypeColumnSeen = false
}

/**
 * Whether the database has migration 651's `grant_type` column, asked BEFORE
 * the exchange writes anything: on a database without it the exchange must
 * neither issue a token nor create the person's grant (which their Connected
 * apps would then list). Remembered once seen, never while absent.
 */
async function grantTypeColumnPresent(): Promise<boolean | "error"> {
  if (grantTypeColumnSeen) return true
  const { error } = await supabase.from("developer_app_tokens").select("grant_type").limit(0)
  if (error) return isMissingColumnError(error) ? false : "error"
  grantTypeColumnSeen = true
  return true
}

async function mintExchangedAccessToken(input: MintInput, ttlSeconds: number): Promise<MintResult> {
  const column = await grantTypeColumnPresent()
  if (column === "error") return { ok: false, failed: "token" }
  if (!column) return { ok: false, failed: "not_migrated" }

  const auth = await exchangeAuthorization(input)
  if (auth === "error") return { ok: false, failed: "authorization" }
  if (auth === "revoked") return { ok: false, failed: "revoked" }

  const plaintext = newPlaintext()
  const now = Date.now()
  const { error: tokErr } = await supabase.from("developer_app_tokens").insert({
    authorization_id: auth.id,
    token_hash: hashToken(plaintext),
    token_prefix: `${plaintext.slice(0, 12)}...`,
    expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
    grant_type: ASSERTION_EXCHANGE_GRANT_TYPE,
  })
  // Until migration 651 reaches the database the token cannot be recorded as
  // exchanged, so none is issued: fail closed, never an unmarked token.
  if (tokErr) return { ok: false, failed: isMissingColumnError(tokErr) ? "not_migrated" : "token" }

  // Housekeeping, never a reason to refuse: an application exchanges again
  // whenever it needs a token, so a grant's exchanged tokens are pruned once
  // they expired over a day ago.
  try {
    await supabase
      .from("developer_app_tokens")
      .delete()
      .eq("authorization_id", auth.id)
      .eq("grant_type", ASSERTION_EXCHANGE_GRANT_TYPE)
      .lt("expires_at", new Date(now - EXCHANGED_TOKEN_KEEP_MS).toISOString())
  } catch {
    // best-effort
  }

  return { ok: true, accessToken: plaintext, tokenType: "Bearer", scope: formatScopeString(input.scopes), expiresIn: ttlSeconds }
}
