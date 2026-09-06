import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The billing integration key's own three routes — mint, list, revoke.
 *
 * The companion to `middleware/__tests__/billing-key-scope.test.ts`: that file
 * proves what the credential may REACH, this one proves how it is issued and
 * withdrawn. Four properties, and every one of them is a way key material
 * leaks:
 *
 *  1. **The bearer exists in exactly one response body, once.** `POST` answers
 *     with it; nothing else ever does. What reaches the database is the sha256
 *     of it, and the test asserts the INSERT payload against the hash — not
 *     merely that a `token` column is absent, because a payload that stored the
 *     plaintext under any name would pass that weaker check.
 *
 *  2. **`GET` never echoes it.** Not the bearer, and not the hash either: the
 *     hash is offline-crackable against a 9-character known prefix, so a list
 *     route that returned it would be handing out a verifier. The page gets the
 *     12-character prefix, which names a key and reconstructs nothing.
 *
 *  3. **Five live keys is the cap.** An integration needs one, plus one during
 *     a rotation. A credential class with no cap is a credential class that
 *     accumulates forgotten live keys.
 *
 *  4. **Revoking actually revokes, immediately.** The resolver caches for 60
 *     seconds, so a `DELETE` that only wrote the row would leave the key
 *     working for up to a minute after the payer was told it was dead. The test
 *     warms the cache, revokes through the route, and asserts the resolver
 *     answers null on the very next call.
 *
 * Mainline (R2): these routes are registered inside `deploymentBillingRoutes`,
 * which `app.ts` mounts only under `hasCredits() && deploymentPayerActive()`.
 * With no `billing.payerAccount` the paths do not exist.
 */

const PAYER = "00000000-0000-4000-8000-000000000009"
const OTHER = "00000000-0000-4000-8000-000000000103"
const KEY_ID = "00000000-0000-4000-8000-0000000000a1"
const BEARER = `ndr_bill_${"a".repeat(64)}`

// ---------------------------------------------------------------------------
// Mocks — hoisted before any import that touches them
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number }
  /** Sticky per-table result, plus an optional FIFO queue for the requests that
   *  read the same table twice (the mint route lists before it inserts). */
  const tableResults = new Map<string, Result>()
  const queues = new Map<string, Result[]>()
  const rec = {
    fromCalls: [] as string[],
    writes: [] as Array<{ table: string; op: "insert" | "update"; payload: unknown }>,
    filters: [] as Array<{ table: string; op: string; args: unknown[] }>,
  }
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const result = (): Result => {
      const q = queues.get(table)
      if (q && q.length > 0) return q.shift()!
      return tableResults.get(table) ?? { data: null, error: null, count: 0 }
    }
    chain.select = () => self()
    chain.insert = (payload: unknown) => {
      rec.writes.push({ table, op: "insert", payload })
      return self()
    }
    chain.update = (payload: unknown) => {
      rec.writes.push({ table, op: "update", payload })
      return self()
    }
    for (const op of ["eq", "neq", "in", "is", "gte", "lte", "or", "order", "range", "limit"]) {
      chain[op] = (...args: unknown[]) => {
        rec.filters.push({ table, op, args })
        return self()
      }
    }
    chain.single = async () => result()
    chain.maybeSingle = async () => result()
    chain.then = (resolve: (v: unknown) => void) => {
      const r = result()
      return resolve({ data: r.data, error: r.error, count: r.count ?? null })
    }
    return chain
  }
  return {
    tableResults,
    queues,
    rec,
    chainFor,
    rpc: vi.fn(),
    config: { EDITION: "cloud" } as Record<string, unknown>,
    getBalance: vi.fn(),
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      h.rec.fromCalls.push(table)
      return h.chainFor(table)
    },
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: h.config,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: vi.fn() }))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { getBalance: (...a: unknown[]) => h.getBalance(...a) },
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

const { tableResults, queues, rec } = h

// ---------------------------------------------------------------------------
// Imports (after the mocks)
// ---------------------------------------------------------------------------

import { deploymentBillingRoutes } from "../routes/deployment-billing.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../lib/deployment-payer.js"
import { __resetDeploymentAllowanceCacheForTests } from "../billing/deployment-allowance-service.js"
import {
  hashBillingKey,
  resolveBillingKey,
  __resetBillingKeyCacheForTests,
} from "../../lib/billing-key-resolver.js"

const KEYS = "deployment_integration_keys"
const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

function payerDeployment(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { unitLabel: "units", unitRate: 2000, unitDecimals: 0, selfServe: false, payerAccount: PAYER },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: KEY_ID,
    name: "Back office",
    token_hash: hashBillingKey(BEARER),
    token_prefix: BEARER.slice(0, 12),
    created_by: PAYER,
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    allowed_cidrs: null,
    ...over,
  }
}

function push(table: string, data: unknown, error: unknown = null): void {
  const q = queues.get(table) ?? []
  q.push({ data, error })
  queues.set(table, q)
}

let app: FastifyInstance

/** `x-user-id` sets the identity, `x-auth-kind` the credential class — the same
 *  door `deployment-billing.test.ts` uses, so the route-local refusals are
 *  exercised through the real guard. */
async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  instance.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as "jwt" | "api_token" | "billing_key") : "jwt"
    if (req.authKind === "api_token") req.apiToken = { id: "tok", userId: String(userId) } as never
    if (req.authKind === "billing_key") req.billingKey = { id: KEY_ID, name: "Back office" }
  })
  await instance.register(async (i) => {
    await deploymentBillingRoutes(i)
  })
  await instance.ready()
  return instance
}

const AS_PAYER = { "x-user-id": PAYER }
const AS_KEY = { "x-user-id": PAYER, "x-auth-kind": "billing_key" }
const KEYS_URL = "/v1/deployment-billing/integration-keys"

beforeEach(async () => {
  vi.clearAllMocks()
  tableResults.clear()
  queues.clear()
  rec.fromCalls = []
  rec.writes = []
  rec.filters = []
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  __resetBillingKeyCacheForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  __resetBillingKeyCacheForTests()
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

// ---------------------------------------------------------------------------
// Who may call these at all
// ---------------------------------------------------------------------------

describe("the three routes are browser-session only", () => {
  const ALL = [
    { method: "GET" as const, url: KEYS_URL },
    { method: "POST" as const, url: KEYS_URL, body: { name: "x" } },
    { method: "DELETE" as const, url: `${KEYS_URL}/${KEY_ID}` },
  ]

  it("refuses a billing integration key on all three with payer_session_required", async () => {
    payerDeployment()
    for (const r of ALL) {
      const res = await app.inject({ method: r.method, url: r.url, headers: AS_KEY, payload: r.body })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
      expect(res.json().error.code, `${r.method} ${r.url}`).toBe("payer_session_required")
    }
    expect(rec.writes.filter((w) => w.table === KEYS)).toHaveLength(0)
  })

  it("refuses an account that is not the billing account", async () => {
    payerDeployment()
    for (const r of ALL) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { "x-user-id": OTHER },
        payload: r.body,
      })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
      expect(res.json().error.code, `${r.method} ${r.url}`).toBe("payer_required")
    }
  })

  it("refuses the payer's own personal API token", async () => {
    payerDeployment()
    for (const r of ALL) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { ...AS_PAYER, "x-auth-kind": "api_token" },
        payload: r.body,
      })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
    }
  })
})

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

describe("POST /integration-keys", () => {
  it("returns the bearer once and stores only its hash", async () => {
    payerDeployment()
    push(KEYS, []) // the live-key count
    push(KEYS, row({ name: "Back office" })) // the insert's RETURNING

    const res = await app.inject({ method: "POST", url: KEYS_URL, headers: AS_PAYER, payload: { name: "Back office" } })
    expect(res.statusCode).toBe(201)

    const token = res.json().data.token as string
    expect(token).toMatch(/^ndr_bill_[0-9a-f]{64}$/)

    const insert = rec.writes.find((w) => w.table === KEYS && w.op === "insert")
    expect(insert).toBeDefined()
    const payload = insert!.payload as Record<string, unknown>
    // The 12-character prefix stored (and rendered) is the bearer's own.
    expect(payload.token_prefix).toBe(token.slice(0, 12))
    expect(payload.token_hash).toBe(hashBillingKey(token))
    expect(payload.token_hash).not.toBe(token)
    expect(payload.created_by).toBe(PAYER)
    // Nothing in the row is the plaintext, under ANY column name.
    expect(Object.values(payload).some((v) => typeof v === "string" && v.includes(token.slice(9)))).toBe(false)
  })

  it("refuses an empty or over-long name", async () => {
    payerDeployment()
    for (const name of ["", "   ", "x".repeat(81)]) {
      const res = await app.inject({ method: "POST", url: KEYS_URL, headers: AS_PAYER, payload: { name } })
      expect(res.statusCode, JSON.stringify(name)).toBe(400)
      expect(res.json().error.code).toBe("invalid_name")
    }
  })

  it("refuses a CIDR with host bits set, and accepts a bare address as a single host", async () => {
    payerDeployment()
    const bad = await app.inject({
      method: "POST",
      url: KEYS_URL,
      headers: AS_PAYER,
      payload: { name: "k", allowedCidrs: ["10.0.0.1/24"] },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("invalid_cidr")

    push(KEYS, [])
    push(KEYS, row({ allowed_cidrs: ["203.0.113.9/32"] }))
    const ok = await app.inject({
      method: "POST",
      url: KEYS_URL,
      headers: AS_PAYER,
      payload: { name: "k", allowedCidrs: ["203.0.113.9"] },
    })
    expect(ok.statusCode).toBe(201)
    const insert = rec.writes.find((w) => w.table === KEYS && w.op === "insert")
    expect((insert!.payload as Record<string, unknown>).allowed_cidrs).toEqual(["203.0.113.9/32"])
  })

  it("refuses the sixth live key", async () => {
    payerDeployment()
    const live = Array.from({ length: 5 }, (_, i) => row({ id: `k${i}` }))
    push(KEYS, live)
    const res = await app.inject({ method: "POST", url: KEYS_URL, headers: AS_PAYER, payload: { name: "sixth" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("key_limit_reached")
    expect(rec.writes.filter((w) => w.table === KEYS && w.op === "insert")).toHaveLength(0)
  })

  it("does not count revoked or expired keys against the cap", async () => {
    payerDeployment()
    const dead = [
      row({ id: "k0", revoked_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "k1", expires_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "k2", revoked_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "k3", expires_at: "2026-01-01T00:00:00.000Z" }),
      row({ id: "k4", revoked_at: "2026-01-01T00:00:00.000Z" }),
    ]
    push(KEYS, dead)
    push(KEYS, row())
    const res = await app.inject({ method: "POST", url: KEYS_URL, headers: AS_PAYER, payload: { name: "sixth" } })
    expect(res.statusCode).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("GET /integration-keys", () => {
  it("never returns a bearer or a hash", async () => {
    payerDeployment()
    tableResults.set(KEYS, { data: [row({ last_used_at: "2026-09-02T00:00:00.000Z" })], error: null })
    const res = await app.inject({ method: "GET", url: KEYS_URL, headers: AS_PAYER })
    expect(res.statusCode).toBe(200)

    const body = res.payload
    expect(body).not.toContain(BEARER)
    expect(body).not.toContain(hashBillingKey(BEARER))

    const [first] = res.json().data as Array<Record<string, unknown>>
    expect(first).toEqual({
      id: KEY_ID,
      name: "Back office",
      tokenPrefix: BEARER.slice(0, 12),
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null,
      lastUsedAt: "2026-09-02T00:00:00.000Z",
      revokedAt: null,
      allowedCidrs: null,
    })
  })

  it("answers an empty list when there are none", async () => {
    payerDeployment()
    tableResults.set(KEYS, { data: [], error: null })
    const res = await app.inject({ method: "GET", url: KEYS_URL, headers: AS_PAYER })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

describe("DELETE /integration-keys/:id", () => {
  it("revokes the row and invalidates the resolver cache in the same breath", async () => {
    payerDeployment()

    // Warm the 60 s cache with a LIVE key, the way a request through it would.
    tableResults.set(KEYS, { data: row(), error: null })
    expect(await resolveBillingKey(BEARER)).not.toBeNull()

    // Revoke through the route; the row now comes back revoked.
    const revokedAt = "2026-09-03T00:00:00.000Z"
    tableResults.set(KEYS, { data: row({ revoked_at: revokedAt }), error: null })
    const res = await app.inject({ method: "DELETE", url: `${KEYS_URL}/${KEY_ID}`, headers: AS_PAYER })
    expect(res.statusCode).toBe(200)

    const update = rec.writes.find((w) => w.table === KEYS && w.op === "update")
    expect(update).toBeDefined()
    expect((update!.payload as Record<string, unknown>).revoked_at).toEqual(expect.any(String))

    // Without the invalidation this would still answer the cached live key for
    // up to a minute after the payer was told the key was dead.
    expect(await resolveBillingKey(BEARER)).toBeNull()
  })

  it("404s an id with no live key behind it", async () => {
    payerDeployment()
    tableResults.set(KEYS, { data: null, error: null })
    const res = await app.inject({ method: "DELETE", url: `${KEYS_URL}/${KEY_ID}`, headers: AS_PAYER })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("key_not_found")
  })

  it("400s an id that is not a uuid, without touching the table", async () => {
    payerDeployment()
    const res = await app.inject({ method: "DELETE", url: `${KEYS_URL}/not-a-uuid`, headers: AS_PAYER })
    expect(res.statusCode).toBe(400)
    expect(rec.writes.filter((w) => w.table === KEYS)).toHaveLength(0)
  })
})
