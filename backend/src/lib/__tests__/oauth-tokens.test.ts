import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"

// The two Supabase calls minting makes, recorded so the test can assert what
// was written rather than only what came back.
const calls = vi.hoisted(() => ({
  upsert: [] as unknown[][],
  insert: [] as unknown[],
  upsertResult: { data: { id: "auth-1" } as { id: string } | null, error: null as unknown },
  insertResult: { error: null as unknown },
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "developer_app_authorizations") {
        return {
          upsert: (...args: unknown[]) => {
            calls.upsert.push(args)
            return { select: () => ({ single: async () => calls.upsertResult }) }
          },
        }
      }
      if (table === "developer_app_tokens") {
        return {
          insert: async (row: unknown) => {
            calls.insert.push(row)
            return calls.insertResult
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

import { ACCESS_TOKEN_TTL_DAYS, hashToken, mintAppAccessToken } from "../oauth-tokens.js"

const INPUT = { appId: "dapp-1", userId: "user-1", scopes: ["jobs:read", "assets:read"] }

beforeEach(() => {
  calls.upsert.length = 0
  calls.insert.length = 0
  calls.upsertResult = { data: { id: "auth-1" }, error: null }
  calls.insertResult = { error: null }
})

describe("mintAppAccessToken", () => {
  it("revives the app↔user authorization and stores only the token's hash", async () => {
    const result = await mintAppAccessToken(INPUT)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.accessToken).toMatch(/^ndr_app_[0-9a-f]{64}$/)
    expect(result.tokenType).toBe("Bearer")
    expect(result.scope).toBe("jobs:read assets:read")
    expect(result.expiresIn).toBe(ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60)

    expect(calls.upsert).toHaveLength(1)
    expect(calls.upsert[0]?.[0]).toEqual({
      app_id: "dapp-1",
      user_id: "user-1",
      scopes_granted: ["jobs:read", "assets:read"],
      revoked_at: null,
    })
    expect(calls.upsert[0]?.[1]).toEqual({ onConflict: "app_id,user_id" })

    expect(calls.insert).toHaveLength(1)
    const row = calls.insert[0] as Record<string, string>
    expect(row.authorization_id).toBe("auth-1")
    expect(row.token_hash).toBe(createHash("sha256").update(result.accessToken).digest("hex"))
    expect(row.token_hash).toBe(hashToken(result.accessToken))
    expect(row.token_prefix).toBe(`${result.accessToken.slice(0, 12)}...`)
    expect(JSON.stringify(row)).not.toContain(result.accessToken)
    const expiresAt = Date.parse(row.expires_at)
    expect(expiresAt - Date.now()).toBeGreaterThan((ACCESS_TOKEN_TTL_DAYS - 1) * 24 * 60 * 60 * 1000)
  })

  it("reports the authorization failing without touching the token table", async () => {
    calls.upsertResult = { data: null, error: { message: "boom" } }
    await expect(mintAppAccessToken(INPUT)).resolves.toEqual({ ok: false, failed: "authorization" })
    expect(calls.insert).toHaveLength(0)
  })

  it("reports the token insert failing", async () => {
    calls.insertResult = { error: { message: "boom" } }
    await expect(mintAppAccessToken(INPUT)).resolves.toEqual({ ok: false, failed: "token" })
  })

  it("mints a different token every time", async () => {
    const a = await mintAppAccessToken(INPUT)
    const b = await mintAppAccessToken(INPUT)
    expect(a.ok && b.ok && a.accessToken !== b.accessToken).toBe(true)
  })
})
