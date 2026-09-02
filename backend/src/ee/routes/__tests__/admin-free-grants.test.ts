import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000003"
const U3 = "00000000-0000-4000-8000-000000000004"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a), rpc: (...a: unknown[]) => mockRpc(...a) },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    if (req.userId !== ADMIN_UUID) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
vi.mock("@/ee/middleware/require-platform-operator.js", () => ({
  requirePlatformOperator: async () => {},
}))
vi.mock("@/ee/billing/signup-grant.js", () => ({ activateSignupGrant: vi.fn() }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminFreeGrantRoutes } from "../admin-free-grants.js"
import { keyToken } from "../../lib/signup-signal-clusters.js"

/** Matches the SUPABASE_SERVICE_ROLE_KEY the config mock above hands the route. */
const TOKEN_SECRET = "test"

// ---------------------------------------------------------------------------
// Helpers — a per-table queue, because one request hits `signup_signals`
// several times in a fixed order.
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown }
const queues = new Map<string, Result[]>()

function queueTable(table: string, ...results: Result[]) {
  queues.set(table, [...(queues.get(table) ?? []), ...results])
}

/**
 * Every builder call is recorded, table and arguments included. A chain that
 * swallowed its arguments would answer the queued fixture no matter WHICH query
 * the route built — dropping `.neq("user_id", …)`, `.eq("source","claim")` or
 * `.limit(…)` would stay green while production shipped the account itself, or
 * non-claim rows, inside its own related list.
 */
type ChainCall = { table: string; method: string; args: unknown[] }
const chainCalls: ChainCall[] = []

function chainFor(table: string, result: Result) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      chainCalls.push({ table, method, args })
      return chain
    })
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "range"]) chain[m] = record(m)
  chain.maybeSingle = vi.fn(async () => {
    chainCalls.push({ table, method: "maybeSingle", args: [] })
    return result
  })
  chain.single = vi.fn(async () => result)
  // The 500 path's best-effort app_reports telemetry writes through this mock.
  chain.insert = vi.fn(async () => ({ data: null, error: null }))
  chain.then = (resolve: (v: unknown) => void) => resolve(result)
  return chain
}

/** The argument lists a given builder method received on a given table, in order. */
function argsFor(table: string, method: string): unknown[][] {
  return chainCalls.filter((c) => c.table === table && c.method === method).map((c) => c.args)
}

/** How many separate queries the route opened against a table. */
function queryCount(table: string): number {
  return mockFrom.mock.calls.filter((c) => c[0] === table).length
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  queues.clear()
  chainCalls.length = 0
  mockFrom.mockImplementation((t: string) => chainFor(t, queues.get(t)?.shift() ?? { data: [], error: null }))

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminFreeGrantRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/admin/free-grants/clusters
// ---------------------------------------------------------------------------

describe("GET /v1/admin/free-grants/clusters", () => {
  it("refuses a non-admin before it ever asks the database", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/free-grants/clusters", headers: { "x-user-id": U1 } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("rejects an axis the function does not know", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/free-grants/clusters?axis=nope",
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("hydrates the cluster, and still lists a member whose profile is gone", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          cluster_key: "a".repeat(64),
          member_count: 3,
          first_seen_at: "2026-09-01T10:00:00.000Z",
          last_seen_at: "2026-09-02T08:00:00.000Z",
          user_ids: [U1, U2],
          total_count: 1,
        },
      ],
      error: null,
    })
    queueTable("profiles", {
      data: [{ id: U1, email: "a@x.test", full_name: "A", subscription_credits: 0, free_grant_state: "withheld" }],
      error: null,
    })
    queueTable("signup_signals", {
      data: [
        { user_id: U1, created_at: "2026-09-01T10:00:00.000Z", reasons: ["device_ip_match"] },
        { user_id: U2, created_at: "2026-09-01T11:00:00.000Z", reasons: [] },
      ],
      error: null,
    })

    const res = await app.inject({ method: "GET", url: "/v1/admin/free-grants/clusters", headers: { "x-user-id": ADMIN_UUID } })

    expect(res.statusCode).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith("signup_signal_clusters", { p_axis: "device", p_limit: 50, p_offset: 0 })
    const body = res.json()
    expect(body.axis).toBe("device")
    expect(body.unavailable).toBe(false)
    expect(body.total).toBe(1)
    expect(body.data[0].keyPrefix).toBe(keyToken("a".repeat(64), TOKEN_SECRET))
    // The stored hash's own head never reaches the wire (an unsalted sha256 of
    // an IPv4 inverts from 12 hex characters).
    expect(body.data[0].keyPrefix).not.toBe("a".repeat(12))
    expect(body.data[0].memberCount).toBe(3)
    expect(body.data[0].members).toHaveLength(2)
    expect(body.data[0].members[0].email).toBe("a@x.test")
    expect(body.data[0].members[1].userId).toBe(U2)
    expect(body.data[0].members[1].email).toBeNull()

    // The hydration asked for exactly the cluster's ids, and only claim signals.
    expect(argsFor("profiles", "in")).toEqual([["id", [U1, U2]]])
    expect(argsFor("signup_signals", "in")).toEqual([["user_id", [U1, U2]]])
    expect(argsFor("signup_signals", "eq")).toEqual([["source", "claim"]])
  })

  it("chunks the hydration rather than building one unsendable .in() url", async () => {
    const ids = Array.from({ length: 125 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 5 }, (_, c) => ({
        cluster_key: String(c).repeat(64),
        member_count: 25,
        first_seen_at: "2026-09-01T10:00:00.000Z",
        last_seen_at: "2026-09-02T08:00:00.000Z",
        user_ids: ids.slice(c * 25, c * 25 + 25),
        total_count: 5,
      })),
      error: null,
    })

    const res = await app.inject({ method: "GET", url: "/v1/admin/free-grants/clusters", headers: { "x-user-id": ADMIN_UUID } })

    expect(res.statusCode).toBe(200)
    // 125 ids at HYDRATION_CHUNK=100 is two queries per table, not one 47 KB URL.
    expect(queryCount("profiles")).toBe(2)
    expect(queryCount("signup_signals")).toBe(2)
    const profileIn = argsFor("profiles", "in")
    expect(profileIn.map((a) => (a[1] as string[]).length)).toEqual([100, 25])
    expect(argsFor("signup_signals", "in").map((a) => (a[1] as string[]).length)).toEqual([100, 25])
  })

  it("reports the real total on a page past the last cluster", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ cluster_key: "k".repeat(64), member_count: 2, first_seen_at: "2026-09-01T10:00:00.000Z", last_seen_at: "2026-09-02T08:00:00.000Z", user_ids: [U1, U2], total_count: 7 }],
        error: null,
      })

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/free-grants/clusters?axis=ip&offset=100",
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], total: 7, axis: "ip", unavailable: false })
    expect(mockRpc).toHaveBeenNthCalledWith(2, "signup_signal_clusters", { p_axis: "ip", p_limit: 1, p_offset: 0 })
    // Nothing to hydrate on an empty page.
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("serves an empty flagged page while the migration has not reached the database", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })

    const res = await app.inject({ method: "GET", url: "/v1/admin/free-grants/clusters", headers: { "x-user-id": ADMIN_UUID } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], total: 0, axis: "device", unavailable: true })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("still 500s on a real RPC failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } })

    const res = await app.inject({ method: "GET", url: "/v1/admin/free-grants/clusters", headers: { "x-user-id": ADMIN_UUID } })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/free-grants/:userId/related
// ---------------------------------------------------------------------------

describe("GET /v1/admin/free-grants/:userId/related", () => {
  it("refuses a non-admin before it ever asks the database", async () => {
    // Without the gate this route is a cross-user lookup oracle: it names every
    // account sharing a machine or network, with email, state and balance.
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/free-grants/${U1}/related`,
      headers: { "x-user-id": U1 },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("merges the three axes into one list per account", async () => {
    queueTable(
      "signup_signals",
      {
        data: {
          browser_key: "b".repeat(64),
          device_key: "d".repeat(64),
          ip_hash: "i".repeat(64),
          created_at: "2026-09-01T10:00:00.000Z",
        },
        error: null,
      },
      { data: [{ user_id: U2, created_at: "2026-09-01T09:00:00.000Z", reasons: [] }], error: null },
      { data: [], error: null },
      {
        data: [
          { user_id: U2, created_at: "2026-09-01T09:00:00.000Z", reasons: [] },
          { user_id: U3, created_at: "2026-09-01T08:00:00.000Z", reasons: ["ip_velocity"] },
        ],
        error: null,
      },
    )
    queueTable("profiles", {
      data: [{ id: U2, email: "b@x.test", full_name: null, subscription_credits: 1500, free_grant_state: "granted" }],
      error: null,
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/free-grants/${U1}/related`,
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.signal.deviceKeyPrefix).toBe(keyToken("d".repeat(64), TOKEN_SECRET))
    expect(data.signal.deviceKeyPrefix).not.toBe("d".repeat(12))
    expect(data.signal.ipHashPrefix).toBe(keyToken("i".repeat(64), TOKEN_SECRET))
    expect(data.signal.ipHashPrefix).not.toBe("i".repeat(12))
    expect(data.related).toHaveLength(2)
    expect(data.related[0].userId).toBe(U2)
    expect(data.related[0].matches).toEqual(["device", "ip"])
    expect(data.related[1].userId).toBe(U3)
    expect(data.related[1].matches).toEqual(["ip"])
    expect(data.related[1].email).toBeNull()
    expect(data.truncated).toBe(false)

    // Each axis query is pinned: the reviewed account is excluded from its own
    // related list, only claim rows count, and each axis is bounded.
    const eqArgs = argsFor("signup_signals", "eq")
    expect(eqArgs).toContainEqual(["user_id", U1])
    expect(eqArgs).toContainEqual(["device_key", "d".repeat(64)])
    expect(eqArgs).toContainEqual(["browser_key", "b".repeat(64)])
    expect(eqArgs).toContainEqual(["ip_hash", "i".repeat(64)])
    expect(eqArgs.filter((a) => a[0] === "source" && a[1] === "claim")).toHaveLength(4)
    expect(argsFor("signup_signals", "neq")).toEqual([
      ["user_id", U1],
      ["user_id", U1],
      ["user_id", U1],
    ])
    expect(argsFor("signup_signals", "limit")).toEqual([[100], [100], [100]])
    expect(argsFor("profiles", "in")).toEqual([["id", [U2, U3]]])
  })

  it("answers an account with no claim signal with an empty list", async () => {
    queueTable("signup_signals", { data: null, error: null })

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/free-grants/${U1}/related`,
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.signal).toBeNull()
    expect(data.related).toEqual([])
    expect(data.truncated).toBe(false)
  })

  it("flags the list as truncated when an axis hit its cap", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      user_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, "0")}`,
      created_at: "2026-09-01T09:00:00.000Z",
      reasons: [],
    }))
    queueTable(
      "signup_signals",
      { data: { browser_key: null, device_key: null, ip_hash: "i".repeat(64), created_at: "2026-09-01T10:00:00.000Z" }, error: null },
      { data: full, error: null },
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/free-grants/${U1}/related`,
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.related).toHaveLength(100)
    expect(data.truncated).toBe(true)
    // Keyless signal: only the network axis was queried.
    expect(argsFor("signup_signals", "limit")).toEqual([[100]])
  })

  it("rejects a non-uuid user id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/free-grants/not-a-uuid/related",
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(400)
  })
})
