import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `mintAppAccessToken` for the MCP assertion exchange (decided 2026-11-11):
 * an ordinary app token for (person, client) under the same authorization row
 * a consent makes, but recorded as granted by the exchange, short-lived, and
 * never reviving a grant the person revoked. Without the option the function
 * writes exactly what it always wrote (`oauth-tokens.test.ts`).
 */

const fake = vi.hoisted(() => ({ db: null as unknown }))
vi.mock("../supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("../../routes/__tests__/helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { ASSERTION_EXCHANGE_GRANT_TYPE, __resetGrantTypeColumnProbeForTests, hashToken, mintAppAccessToken } from "../oauth-tokens.js"
import type { OAuthMemoryDb } from "../../routes/__tests__/helpers/oauth-memory-db.js"

const db = () => fake.db as OAuthMemoryDb
const INPUT = { appId: "dapp-1", userId: "user-1", scopes: ["jobs:read", "assets:read"], assertionExchange: { ttlSeconds: 3600 } }

beforeEach(() => {
  const d = db()
  d.authorizations.length = 0
  d.tokens.length = 0
  d.missingColumns.clear()
})

describe("mintAppAccessToken({ assertionExchange })", () => {
  it("a first exchange: creates the grant, stores the token's hash with its grant type and a short expiry", async () => {
    const before = Date.now()
    const result = await mintAppAccessToken(INPUT)
    expect(result).toMatchObject({ ok: true, tokenType: "Bearer", scope: "jobs:read assets:read", expiresIn: 3600 })
    if (!result.ok) return
    expect(db().authorizations).toHaveLength(1)
    expect(db().authorizations[0]).toMatchObject({ app_id: "dapp-1", user_id: "user-1", scopes_granted: ["jobs:read", "assets:read"] })
    expect(db().tokens).toHaveLength(1)
    const token = db().tokens[0]!
    expect(token).toMatchObject({ authorization_id: db().authorizations[0]!.id, token_hash: hashToken(result.accessToken), grant_type: ASSERTION_EXCHANGE_GRANT_TYPE })
    expect(JSON.stringify(token)).not.toContain(result.accessToken)
    const expires = new Date(String(token.expires_at)).getTime()
    expect(expires).toBeGreaterThanOrEqual(before + 3600_000)
    expect(expires).toBeLessThanOrEqual(Date.now() + 3600_000)
  })

  it("a later exchange reuses the grant and sets its scopes to the ones asked (the latest grant decides, as a consent does)", async () => {
    await mintAppAccessToken(INPUT)
    const narrower = await mintAppAccessToken({ ...INPUT, scopes: ["jobs:read"] })
    expect(narrower).toMatchObject({ ok: true, scope: "jobs:read" })
    expect(db().authorizations).toHaveLength(1)
    expect(db().authorizations[0]!.scopes_granted).toEqual(["jobs:read"])
    expect(db().tokens).toHaveLength(2)
  })

  it("never revives a grant the person revoked: no token, and the grant stays revoked", async () => {
    db().authorizations.push({ id: "auth-revoked", app_id: "dapp-1", user_id: "user-1", scopes_granted: ["jobs:read"], revoked_at: "2026-11-10T00:00:00.000Z" })
    expect(await mintAppAccessToken(INPUT)).toEqual({ ok: false, failed: "revoked" })
    expect(db().authorizations[0]!.revoked_at).toBe("2026-11-10T00:00:00.000Z")
    expect(db().tokens).toHaveLength(0)
  })

  it("a database without the grant-type column refuses (fails closed) before writing anything, naming why", async () => {
    __resetGrantTypeColumnProbeForTests()
    db().missingColumns.add("developer_app_tokens.grant_type")
    expect(await mintAppAccessToken(INPUT)).toEqual({ ok: false, failed: "not_migrated" })
    expect(db().tokens).toHaveLength(0)
    // No grant either: the person's Connected apps must not list an app that has no token.
    expect(db().authorizations).toHaveLength(0)
  })

  it("an authorization read that fails refuses", async () => {
    db().failReads.add("developer_app_authorizations")
    try {
      expect(await mintAppAccessToken(INPUT)).toEqual({ ok: false, failed: "authorization" })
    } finally {
      db().failReads.delete("developer_app_authorizations")
    }
  })

  it("prunes this grant's exchanged tokens that expired over a day ago, and nothing else", async () => {
    db().authorizations.push({ id: "auth-1", app_id: "dapp-1", user_id: "user-1", scopes_granted: ["jobs:read"], revoked_at: null })
    const old = new Date(Date.now() - 2 * 24 * 3600_000).toISOString()
    const recent = new Date(Date.now() - 3600_000).toISOString()
    db().tokens.push(
      { id: "old-exchanged", authorization_id: "auth-1", token_hash: "h1", expires_at: old, grant_type: ASSERTION_EXCHANGE_GRANT_TYPE },
      { id: "recent-exchanged", authorization_id: "auth-1", token_hash: "h2", expires_at: recent, grant_type: ASSERTION_EXCHANGE_GRANT_TYPE },
      { id: "old-consent", authorization_id: "auth-1", token_hash: "h3", expires_at: old, grant_type: null },
      { id: "other-grant", authorization_id: "auth-2", token_hash: "h4", expires_at: old, grant_type: ASSERTION_EXCHANGE_GRANT_TYPE },
    )
    expect((await mintAppAccessToken(INPUT)).ok).toBe(true)
    expect(db().tokens.map((t) => t.id).filter((id) => typeof id === "string" && !/^[0-9a-f-]{36}$/.test(id as string)).sort()).toEqual(["old-consent", "other-grant", "recent-exchanged"])
    expect(db().tokens).toHaveLength(4)
  })
})
