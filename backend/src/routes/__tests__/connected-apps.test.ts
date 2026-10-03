/**
 * Connected apps: the grants a user gave through OAuth, and revoking one.
 * Browser sessions only; a user sees and revokes only their own grants; a
 * revoke ends the grant AND its tokens.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  authorizations: [] as unknown[],
  tokens: [] as unknown[],
  revokeHit: true,
}))

function query(table: string) {
  const record = (op: string, ...args: unknown[]) => {
    db.calls.push({ table, op, args })
    return chain
  }
  const chain: Record<string, unknown> = {
    select: (...a: unknown[]) => record("select", ...a),
    update: (...a: unknown[]) => record("update", ...a),
    eq: (...a: unknown[]) => record("eq", ...a),
    is: (...a: unknown[]) => record("is", ...a),
    in: (...a: unknown[]) => record("in", ...a),
    not: (...a: unknown[]) => record("not", ...a),
    order: (...a: unknown[]) => record("order", ...a),
    // The row the caller-scoped update matched: the id it was filtered by.
    maybeSingle: async () => {
      const idFilter = [...db.calls].reverse().find((c) => c.table === table && c.op === "eq" && c.args[0] === "id")
      return { data: db.revokeHit ? { id: idFilter?.args[1] } : null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "developer_app_tokens" ? db.tokens : db.authorizations, error: null }),
  }
  return chain
}

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (table: string) => query(table) } }))

import { connectedAppsRoutes } from "../connected-apps.js"

const AUTH_ID = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  db.calls.length = 0
  db.revokeHit = true
  db.authorizations = [
    {
      id: AUTH_ID,
      scopes_granted: ["workflows:read", "workflows:execute"],
      created_at: "2026-09-01T10:00:00Z",
      developer_apps: { name: "Claude", kind: "dynamic_mcp", homepage_url: null },
    },
  ]
  db.tokens = [
    { authorization_id: AUTH_ID, last_used_at: "2026-09-20T08:00:00Z" },
    { authorization_id: AUTH_ID, last_used_at: "2026-09-25T09:30:00Z" },
  ]
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") {
      req.userId = user
      req.authKind = (req.headers["x-auth-kind"] as "jwt" | "app_token" | undefined) ?? "jwt"
    }
  })
  await app.register(connectedAppsRoutes)
  await app.ready()
})

describe("GET /v1/me/connected-apps", () => {
  it("lists the caller's live grants, with each grant's latest use", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/connected-apps", headers: { "x-user-id": "user-1" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().apps).toEqual([
      {
        authorizationId: AUTH_ID,
        name: "Claude",
        kind: "dynamic_mcp",
        homepageUrl: null,
        scopes: ["workflows:read", "workflows:execute"],
        connectedAt: "2026-09-01T10:00:00Z",
        lastUsedAt: "2026-09-25T09:30:00Z",
      },
    ])
    const filters = db.calls.filter((c) => c.table === "developer_app_authorizations")
    expect(filters).toContainEqual({ table: "developer_app_authorizations", op: "eq", args: ["user_id", "user-1"] })
    expect(filters).toContainEqual({ table: "developer_app_authorizations", op: "is", args: ["revoked_at", null] })
  })

  it("refuses an app token: an app cannot list the grants it lives under", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/connected-apps", headers: { "x-user-id": "user-1", "x-auth-kind": "app_token" } })
    expect(res.statusCode).toBe(401)
  })

  it("refuses a signed-out caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/connected-apps" })
    expect(res.statusCode).toBe(401)
  })
})

describe("POST /v1/me/connected-apps/:id/revoke", () => {
  it("revokes the caller's grant and every token under it", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/me/connected-apps/${AUTH_ID}/revoke`, headers: { "x-user-id": "user-1" } })
    expect(res.statusCode).toBe(200)
    const auth = db.calls.filter((c) => c.table === "developer_app_authorizations")
    expect(auth.find((c) => c.op === "update")?.args[0]).toHaveProperty("revoked_at")
    expect(auth).toContainEqual({ table: "developer_app_authorizations", op: "eq", args: ["user_id", "user-1"] })
    const tokens = db.calls.filter((c) => c.table === "developer_app_tokens")
    expect(tokens.find((c) => c.op === "update")?.args[0]).toHaveProperty("revoked_at")
    expect(tokens).toContainEqual({ table: "developer_app_tokens", op: "eq", args: ["authorization_id", AUTH_ID] })
  })

  it("answers 404 for a grant that is not the caller's (or already revoked), and touches no token", async () => {
    db.revokeHit = false
    const res = await app.inject({ method: "POST", url: `/v1/me/connected-apps/${AUTH_ID}/revoke`, headers: { "x-user-id": "user-2" } })
    expect(res.statusCode).toBe(404)
    expect(db.calls.some((c) => c.table === "developer_app_tokens")).toBe(false)
  })

  it("refuses a malformed id and an app token", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/me/connected-apps/not-a-uuid/revoke", headers: { "x-user-id": "user-1" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: `/v1/me/connected-apps/${AUTH_ID}/revoke`, headers: { "x-user-id": "user-1", "x-auth-kind": "app_token" } })).statusCode).toBe(401)
  })
})
