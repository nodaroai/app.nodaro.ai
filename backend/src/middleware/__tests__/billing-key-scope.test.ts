import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * THE SCOPE PROOF for the billing integration key.
 *
 * The rule this file exists to pin, in one sentence: **a credential either
 * spends or administers, never both.** The billing integration key
 * (`ndr_bill_<64 hex>`) administers — it may read the pool and allocate
 * per-user quotas — and it must never be able to generate, to mint another
 * credential, or to buy credits. That is not a property of each route
 * remembering to check something; it is a property of the CREDENTIAL, enforced
 * once in the auth preHandler before any route handler runs.
 *
 * So the assertions here are deliberately handler-level, not status-code-level:
 * every forbidden path below is backed by a `vi.fn()` stub, and the test asserts
 * the stub NEVER FIRED. A 403 produced by a handler that already ran (and
 * already reserved credits, or already wrote a row) would satisfy a status
 * assertion and violate the invariant.
 *
 * Four things are pinned:
 *
 *  1. **The path allow-list.** Anything outside `/v1/deployment-billing/` is
 *     403 `billing_key_scope` with no handler run — `/v1/jobs`, the two credit
 *     reads, the two credential-minting routes, `/mcp` and the admin surface.
 *     `/mcp` matters most: it is a PUBLIC route, so the refusal must be
 *     unconditional. A path check that deferred to the public-route escape
 *     would let the MCP handler run anonymously — with a valid billing key in
 *     the header — which is exactly the generate surface this key must not
 *     reach.
 *
 *  2. **The one place it works.** `/v1/deployment-billing/overview` answers 200
 *     and the request carries `authKind === "billing_key"` and the key's
 *     identity, so the guard and the audit line have something to key on.
 *
 *  3. **The two local refusals.** `POST /checkout` and `POST /integration-keys`
 *     are under the allowed prefix and still refuse the key, with their own
 *     code (`payer_session_required`). Buying credits and minting another
 *     credential are browser-session verbs forever: they are the two that turn
 *     a leaked key into a charge, or into a second key.
 *
 *  4. **The credential's own lifecycle.** Revoked and expired keys are 401 (and
 *     the message never says WHICH — an attacker learns nothing about whether
 *     a bearer was ever real), and a source outside `allowed_cidrs` is 403
 *     `billing_key_source`.
 *
 * And the mainline half (R2): with no deployment payer the branch does not
 * exist, the same bearer is refused 401 by the personal-token path exactly as
 * any unknown `ndr_` string is today, and the keys table is never queried. The
 * personal-token path DOES query `api_tokens` — that is the byte-identical
 * behaviour, and asserting "no query at all" would be asserting a change.
 */

const PAYER = "00000000-0000-4000-8000-000000000009"
const KEY_ID = "00000000-0000-4000-8000-0000000000a1"
const BEARER = `ndr_bill_${"a".repeat(64)}`
const BEARER_2 = `ndr_bill_${"b".repeat(64)}`

// ---------------------------------------------------------------------------
// Mocks — hoisted before any import that touches them
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number }
  const tableResults = new Map<string, Result>()
  const rec = {
    fromCalls: [] as string[],
    writes: [] as Array<{ table: string; op: "insert" | "update"; payload: unknown }>,
  }
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const result = (): Result => tableResults.get(table) ?? { data: null, error: null, count: 0 }
    chain.select = () => self()
    chain.update = (payload: unknown) => {
      rec.writes.push({ table, op: "update", payload })
      return self()
    }
    chain.insert = (payload: unknown) => {
      rec.writes.push({ table, op: "insert", payload })
      return self()
    }
    for (const op of ["eq", "neq", "in", "is", "gte", "lte", "or", "order", "range", "limit"]) {
      chain[op] = () => self()
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
    rec,
    chainFor,
    rpc: vi.fn(),
    config: { EDITION: "cloud", INTERNAL_ORCHESTRATOR_SECRET: "0".repeat(64) } as Record<string, unknown>,
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
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: vi.fn() }))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { getBalance: (...a: unknown[]) => h.getBalance(...a) },
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

const { tableResults, rec } = h

// ---------------------------------------------------------------------------
// Imports (after the mocks)
// ---------------------------------------------------------------------------

import { registerAuthHook } from "../auth.js"
import { deploymentBillingRoutes } from "../../ee/routes/deployment-billing.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../lib/deployment-payer.js"
import { __resetDeploymentAllowanceCacheForTests } from "../../ee/billing/deployment-allowance-service.js"
import {
  hashBillingKey,
  invalidateBillingKeyCache,
  __resetBillingKeyCacheForTests,
} from "../../lib/billing-key-resolver.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

function payerDeployment(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { unitLabel: "units", unitRate: 2000, unitDecimals: 0, selfServe: false, payerAccount: PAYER },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

/** A live key row as the database hands it back. */
function keyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: KEY_ID,
    name: "Back office",
    token_hash: hashBillingKey(BEARER),
    token_prefix: BEARER.slice(0, 12),
    created_by: PAYER,
    created_at: new Date().toISOString(),
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    allowed_cidrs: null,
    ...over,
  }
}

function liveKey(over: Record<string, unknown> = {}): void {
  tableResults.set("deployment_integration_keys", { data: keyRow(over), error: null })
}

/** Every path the key must NOT reach, each behind a spy. */
const FORBIDDEN: ReadonlyArray<{ method: "GET" | "POST"; url: string }> = [
  { method: "POST", url: "/v1/jobs" },
  { method: "GET", url: "/v1/user/credits" },
  { method: "GET", url: "/v1/credits/transactions" },
  { method: "POST", url: "/v1/api-tokens" },
  { method: "POST", url: "/v1/developer-apps" },
  { method: "POST", url: "/mcp" },
  { method: "GET", url: "/v1/admin/users" },
]

let app: FastifyInstance
let handlers: Map<string, ReturnType<typeof vi.fn>>
/** What the auth hook left on each request that actually reached a handler. */
let seen: Array<{ url: string; authKind?: string; billingKey?: { id: string; name: string } }>

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  registerAuthHook(instance)
  // Registered AFTER the auth hook, so it records only requests the hook let
  // through — a hook that replies aborts the chain.
  instance.addHook("preHandler", async (req) => {
    seen.push({ url: req.url, authKind: req.authKind, billingKey: req.billingKey })
  })
  handlers = new Map()
  for (const r of FORBIDDEN) {
    const spy = vi.fn(async () => ({ ok: true }))
    handlers.set(`${r.method} ${r.url}`, spy)
    instance.route({ method: r.method, url: r.url, handler: spy })
  }
  await instance.register(async (i) => {
    await deploymentBillingRoutes(i)
  })
  await instance.ready()
  return instance
}

const AS_KEY = { authorization: `Bearer ${BEARER}` }

beforeEach(async () => {
  vi.clearAllMocks()
  tableResults.clear()
  rec.fromCalls = []
  rec.writes = []
  seen = []
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  __resetBillingKeyCacheForTests()
  h.getBalance.mockResolvedValue({ total: 1000, subscription: 0, topup: 1000, tier: "basic", periodEnd: null })
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
// 1. The path allow-list — the R8 proof
// ---------------------------------------------------------------------------

describe("the path allow-list refuses the key everywhere but the billing surface", () => {
  it("answers 403 billing_key_scope and runs NO handler on every forbidden path", async () => {
    payerDeployment()
    for (const r of FORBIDDEN) {
      liveKey()
      const res = await app.inject({ method: r.method, url: r.url, headers: AS_KEY, payload: {} })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
      expect(res.json().error.code, `${r.method} ${r.url}`).toBe("billing_key_scope")
      expect(handlers.get(`${r.method} ${r.url}`), `${r.method} ${r.url}`).not.toHaveBeenCalled()
    }
    // Nothing got past the hook at all — not even onto the recording hook.
    expect(seen).toHaveLength(0)
  })

  it("refuses on /mcp even though /mcp is a PUBLIC route", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({ method: "POST", url: "/mcp", headers: AS_KEY, payload: {} })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("billing_key_scope")
    // The load-bearing half: a public route whose handler runs anonymously
    // would be a generate surface reached with a billing key in hand.
    expect(handlers.get("POST /mcp")).not.toHaveBeenCalled()
  })

  it("keeps refusing when a query string is appended", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({ method: "GET", url: "/v1/user/credits?x=/v1/deployment-billing/", headers: AS_KEY })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("billing_key_scope")
  })
})

// ---------------------------------------------------------------------------
// 2. The one surface it may reach
// ---------------------------------------------------------------------------

describe("the billing surface", () => {
  it("answers 200 on /overview and stamps authKind billing_key plus the key identity", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    expect(res.statusCode).toBe(200)
    const passed = seen.find((s) => s.url.startsWith("/v1/deployment-billing/overview"))
    expect(passed?.authKind).toBe("billing_key")
    expect(passed?.billingKey).toEqual({ id: KEY_ID, name: "Back office" })
  })

  it("stamps the request as the PAYER, so the identity guard passes", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    // `requireDeploymentPayer` 403s anything whose userId is not the payer, so
    // a 200 IS the identity assertion.
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 3. The two verbs that stay browser-only
// ---------------------------------------------------------------------------

describe("the money and credential verbs refuse the key locally", () => {
  it("refuses POST /checkout with payer_session_required", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: AS_KEY,
      payload: { amountUsd: 10 },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_session_required")
  })

  it("refuses POST /integration-keys with payer_session_required — a key cannot mint a key", async () => {
    payerDeployment()
    liveKey()
    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/integration-keys",
      headers: AS_KEY,
      payload: { name: "second" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_session_required")
    // And no key was created on the way to the refusal. (`last_used_at` IS
    // stamped — the key authenticated; it simply may not mint.)
    expect(rec.writes.filter((w) => w.table === "deployment_integration_keys" && w.op === "insert")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. The credential's lifecycle
// ---------------------------------------------------------------------------

describe("revocation, expiry and the source restriction", () => {
  it("401s a revoked key within one cache TTL, once the cache is invalidated", async () => {
    payerDeployment()
    liveKey()
    const warm = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    expect(warm.statusCode).toBe(200)

    tableResults.set("deployment_integration_keys", {
      data: keyRow({ revoked_at: new Date().toISOString() }),
      error: null,
    })
    invalidateBillingKeyCache(KEY_ID)

    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("401s an expired key", async () => {
    payerDeployment()
    liveKey({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("never says WHICH of unknown, revoked or expired it was", async () => {
    payerDeployment()
    tableResults.set("deployment_integration_keys", { data: null, error: null })
    const unknown = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_KEY })
    __resetBillingKeyCacheForTests()
    liveKey({ revoked_at: new Date().toISOString() })
    const revoked = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/overview",
      headers: { authorization: `Bearer ${BEARER_2}` },
    })
    expect(unknown.statusCode).toBe(401)
    expect(revoked.statusCode).toBe(401)
    expect(revoked.json().error.message).toBe(unknown.json().error.message)
  })

  it("403 billing_key_source for a forwarded IP outside allowed_cidrs", async () => {
    payerDeployment()
    liveKey({ allowed_cidrs: ["10.0.0.0/8"] })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/overview",
      headers: { ...AS_KEY, "x-forwarded-for": "203.0.113.9" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("billing_key_source")
  })

  it("accepts a forwarded IP inside allowed_cidrs", async () => {
    payerDeployment()
    liveKey({ allowed_cidrs: ["10.0.0.0/8"] })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/overview",
      headers: { ...AS_KEY, "x-forwarded-for": "10.1.2.3" },
    })
    expect(res.statusCode).toBe(200)
  })

  it("takes the LEFTMOST forwarded hop — the one Caddy rewrites to the real client", async () => {
    payerDeployment()
    liveKey({ allowed_cidrs: ["10.0.0.0/8"] })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/overview",
      headers: { ...AS_KEY, "x-forwarded-for": "203.0.113.9, 10.1.2.3" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("billing_key_source")
  })
})

// ---------------------------------------------------------------------------
// 5. Mainline (R2)
// ---------------------------------------------------------------------------

describe("mainline — no deployment payer", () => {
  it("401s the same bearer through the personal-token path and never reads the keys table", async () => {
    // No payerDeployment(): payerId is null, so the branch is not registered.
    liveKey() // the row exists; nothing must look for it
    const res = await app.inject({ method: "GET", url: "/v1/user/credits", headers: AS_KEY })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expect(handlers.get("GET /v1/user/credits")).not.toHaveBeenCalled()
    expect(rec.fromCalls).not.toContain("deployment_integration_keys")
    // …and it fell through to exactly today's path, which DOES read api_tokens.
    expect(rec.fromCalls).toContain("api_tokens")
  })

  it("does not stamp authKind billing_key on anything", async () => {
    liveKey()
    await app.inject({ method: "GET", url: "/v1/user/credits", headers: AS_KEY })
    expect(seen.filter((s) => s.authKind === "billing_key")).toHaveLength(0)
  })
})
