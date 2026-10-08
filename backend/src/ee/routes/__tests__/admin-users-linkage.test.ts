import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/admin/users/linkage — the Users page's "who belongs together" read —
 * and GET /v1/admin/users/linkage/cluster — one cluster's members, on demand.
 *
 * Pinned here: the gate; the id list's validation; the RPC paged to its
 * total_count on every axis, the members' grant states read once, and both
 * cached between requests (a failed walk forgotten); a missing RPC answered as
 * `unavailable`, not a 500; keyed tokens on the wire and never a stored hash;
 * a page row the 25-id cap hid still attached to its cluster; the list free of
 * member emails, which the cluster route serves fresh.
 */

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000003"
const U3 = "00000000-0000-4000-8000-000000000004"
const U4 = "00000000-0000-4000-8000-000000000005"
const U9 = "00000000-0000-4000-8000-000000000009"
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

// Stored hashes as 64-character stand-ins. Zero-entropy on purpose: the public-mirror
// secret gate (gitleaks) reads a high-entropy hex string next to the word "key" as a
// leaked credential, as it did with an earlier fixture here. The assertions below search
// the body for them, so each stays distinct.
const DEVICE_HASH = "d".repeat(64)
const NETWORK_HASH = "a".repeat(64)
const BROWSER_UNIQUE = "b".repeat(64)
const NETWORK_UNIQUE = "u".repeat(64)

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

import { adminUsersLinkageRoutes, resetLinkageCache, RPC_PAGE } from "../admin-users-linkage.js"
import { keyToken } from "../../lib/signup-signal-clusters.js"

/** Matches the SUPABASE_SERVICE_ROLE_KEY the config mock hands the route. */
const TOKEN_SECRET = "test"
const token = (key: string) => keyToken(key, TOKEN_SECRET)!

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown }

interface RpcRow {
  cluster_key: string
  member_count: number
  first_seen_at: string
  last_seen_at: string
  user_ids: string[]
  total_count: number
}

function rpcRow(key: string, ids: string[], extra: Partial<RpcRow> = {}): RpcRow {
  return {
    cluster_key: key,
    member_count: ids.length,
    first_seen_at: "2026-10-08T05:00:00.000Z",
    last_seen_at: "2026-10-08T13:00:00.000Z",
    user_ids: ids,
    total_count: 1,
    ...extra,
  }
}

/** Pages per axis: `rpcPages.get("device")[k]` answers offset k * RPC_PAGE. */
const rpcPages = new Map<string, Result[]>()
let rpcFailure: Result | null = null

function pageOf(args: { p_axis: string; p_limit: number; p_offset: number }): Result {
  if (rpcFailure) return rpcFailure
  const pages = rpcPages.get(args.p_axis) ?? []
  return pages[args.p_offset / args.p_limit] ?? { data: [], error: null }
}

const queues = new Map<string, Result[]>()
function queueTable(table: string, ...results: Result[]) {
  queues.set(table, [...(queues.get(table) ?? []), ...results])
}

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
  chain.maybeSingle = vi.fn(async () => result)
  chain.single = vi.fn(async () => result)
  chain.insert = vi.fn(async () => ({ data: null, error: null }))
  chain.then = (resolve: (v: unknown) => void) => resolve(result)
  return chain
}

function argsFor(table: string, method: string): unknown[][] {
  return chainCalls.filter((c) => c.table === table && c.method === method).map((c) => c.args)
}

function queryCount(table: string): number {
  return mockFrom.mock.calls.filter((c) => c[0] === table).length
}

function signal(userId: string, keys: { device?: string | null; browser?: string | null; ip?: string }, decision: string | null = "withheld", reasons: string[] = []) {
  return {
    user_id: userId,
    device_key: keys.device ?? null,
    browser_key: keys.browser ?? null,
    ip_hash: keys.ip ?? NETWORK_UNIQUE,
    decision,
    reasons,
    created_at: "2026-10-08T14:00:00.000Z",
  }
}

const state = (id: string, free_grant_state: string | null) => ({ id, free_grant_state })
const member = (id: string, email: string, free_grant_state: string | null, role = "user") => ({ id, email, free_grant_state, role })

let app: FastifyInstance

async function list(ids: string, userId: string = ADMIN_UUID) {
  return app.inject({ method: "GET", url: `/v1/admin/users/linkage?ids=${ids}`, headers: { "x-user-id": userId } })
}
async function cluster(key: string, userId: string = ADMIN_UUID) {
  return app.inject({ method: "GET", url: `/v1/admin/users/linkage/cluster?key=${key}`, headers: { "x-user-id": userId } })
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetLinkageCache()
  rpcPages.clear()
  rpcFailure = null
  queues.clear()
  chainCalls.length = 0
  mockFrom.mockImplementation((t: string) => chainFor(t, queues.get(t)?.shift() ?? { data: [], error: null }))
  mockRpc.mockImplementation(async (_fn: string, args: { p_axis: string; p_limit: number; p_offset: number }) => pageOf(args))

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminUsersLinkageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Gate and validation
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users/linkage — gate and validation", () => {
  it("refuses a non-admin before it ever asks the database", async () => {
    const res = await list(U1, U1)
    expect(res.statusCode).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("rejects a missing list, a non-uuid and an over-long list", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/users/linkage", headers: { "x-user-id": ADMIN_UUID } })).statusCode).toBe(400)
    expect((await list(`${U1},not-a-uuid`)).statusCode).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, i) => uid(1000 + i)).join(",")
    expect((await list(tooMany)).statusCode).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("answers an upper-case id under its lower-case spelling", async () => {
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    queueTable("profiles", { data: [state(U1, "withheld"), state(U2, "withheld")], error: null })
    queueTable("signup_signals", { data: [signal(U1, { device: DEVICE_HASH })], error: null })
    const res = await list(U1.toUpperCase())
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json().users)).toEqual([U1])
  })
})

// ---------------------------------------------------------------------------
// Availability, paging, cache
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users/linkage — the walk", () => {
  it("serves `unavailable` when the function is not in the database yet, and asks nothing else", async () => {
    rpcFailure = { data: null, error: { code: "PGRST202", message: "Could not find the function public.signup_signal_clusters" } }
    const res = await list(U1)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ unavailable: true, clusters: [], users: {} })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("is a 500 when the function fails for any other reason", async () => {
    rpcFailure = { data: null, error: { code: "XX000", message: "disk on fire" } }
    const res = await list(U1)
    expect(res.statusCode).toBe(500)
  })

  it("pages every axis until total_count and asks each axis once", async () => {
    const first = Array.from({ length: RPC_PAGE }, (_, i) => rpcRow(`dev-${i}`, [uid(10_000 + 2 * i), uid(10_001 + 2 * i)], { total_count: RPC_PAGE + 150 }))
    const second = Array.from({ length: 150 }, (_, i) => rpcRow(`dev-late-${i}`, [uid(20_000 + 2 * i), uid(20_001 + 2 * i)], { total_count: RPC_PAGE + 150 }))
    rpcPages.set("device", [{ data: first, error: null }, { data: second, error: null }])
    rpcPages.set("ip", [{ data: [rpcRow(NETWORK_HASH, [U2, U3])], error: null }])

    const res = await list(U1)
    expect(res.statusCode).toBe(200)

    const calls = mockRpc.mock.calls.map((c) => c[1] as { p_axis: string; p_limit: number; p_offset: number })
    expect(calls.filter((c) => c.p_axis === "device").map((c) => c.p_offset)).toEqual([0, RPC_PAGE])
    expect(calls.filter((c) => c.p_axis === "browser").map((c) => c.p_offset)).toEqual([0])
    expect(calls.filter((c) => c.p_axis === "ip").map((c) => c.p_offset)).toEqual([0])
    expect(calls.every((c) => c.p_limit === RPC_PAGE)).toBe(true)
    expect(res.json().summary.clusters).toBe(RPC_PAGE + 150 + 1)
  })

  it("stops on total_count when the last page is exactly full, without asking for an empty page", async () => {
    const full = Array.from({ length: RPC_PAGE }, (_, i) => rpcRow(`br-${i}`, [uid(30_000 + 2 * i), uid(30_001 + 2 * i)], { total_count: RPC_PAGE }))
    rpcPages.set("browser", [{ data: full, error: null }])

    await list(U1)
    const browserCalls = mockRpc.mock.calls.filter((c) => (c[1] as { p_axis: string }).p_axis === "browser")
    expect(browserCalls).toHaveLength(1)
  })

  it("reads every member's grant state once per walk, for exactly the ids the rows name", async () => {
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    rpcPages.set("ip", [{ data: [rpcRow(NETWORK_HASH, [U2, U3])], error: null }])
    queueTable("profiles", { data: [state(U1, "withheld"), state(U2, "withheld"), state(U3, "granted")], error: null })

    const res = await list(U4)
    expect(argsFor("profiles", "select")).toEqual([["id, free_grant_state"]])
    expect(argsFor("profiles", "in")).toEqual([["id", [U1, U2, U3]]])
    expect(res.json().summary).toEqual({ clusters: 1, accounts: 3, withheld: 2, granted: 1 })
  })

  it("caches the walk — rows and states — between requests, but reads the page's signals fresh every time", async () => {
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    queueTable("profiles", { data: [state(U1, "withheld"), state(U2, "granted")], error: null })

    await list(U1)
    await list(U3)
    expect(mockRpc).toHaveBeenCalledTimes(3)
    expect(queryCount("profiles")).toBe(1)
    expect(queryCount("signup_signals")).toBe(2)

    resetLinkageCache()
    await list(U1)
    expect(mockRpc).toHaveBeenCalledTimes(6)
    expect(queryCount("profiles")).toBe(2)
  })

  it("forgets a failed walk, so the next request tries again", async () => {
    rpcFailure = { data: null, error: { code: "XX000", message: "disk on fire" } }
    expect((await list(U1)).statusCode).toBe(500)

    rpcFailure = null
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    const res = await list(U1)
    expect(res.statusCode).toBe(200)
    expect(res.json().summary.clusters).toBe(1)
    expect(mockRpc.mock.calls.length).toBeGreaterThan(3)
  })
})

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users/linkage — what the page gets", () => {
  beforeEach(() => {
    // U1 and U2 share a device; U2 and U3 share a network: one cluster of three.
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    rpcPages.set("ip", [{ data: [rpcRow(NETWORK_HASH, [U2, U3])], error: null }])
    queueTable("profiles", { data: [state(U1, "withheld"), state(U2, "withheld"), state(U3, "granted")], error: null })
    queueTable("signup_signals", {
      data: [
        signal(U1, { device: DEVICE_HASH, browser: BROWSER_UNIQUE, ip: NETWORK_UNIQUE }, "withheld", ["device_ip_match", "browser_match"]),
        signal(U4, { device: "aaaa".repeat(16), browser: "bbbb".repeat(16), ip: "cccc".repeat(16) }, "granted", []),
      ],
      error: null,
    })
  })

  it("numbers the cluster, identifies it by its lowest key, counts its grant states — and ships no member emails", async () => {
    const res = await list([U1, U3, U4].join(","))
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.unavailable).toBe(false)
    expect(body.summary).toEqual({ clusters: 1, accounts: 3, withheld: 2, granted: 1 })
    expect(body.clusters).toHaveLength(1)
    const [c] = body.clusters
    // NETWORK_HASH sorts below DEVICE_HASH, so it is the cluster's anchor.
    expect(c).toMatchObject({ key: token(NETWORK_HASH), id: 1, size: 3, unresolved: 0, tier: "small", withheld: 2, granted: 1 })
    expect(c.members).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain("@")
  })

  it("puts keyed tokens on the wire and never a stored hash", async () => {
    const res = await list([U1, U3, U4].join(","))
    const body = res.json()
    const text = JSON.stringify(body)

    for (const raw of [DEVICE_HASH, NETWORK_HASH, BROWSER_UNIQUE, NETWORK_UNIQUE]) {
      expect(text).not.toContain(raw)
      expect(text).not.toContain(raw.slice(0, 12))
    }
    expect(body.clusters[0].keys).toEqual([
      { axis: "device", token: token(DEVICE_HASH), count: 2 },
      { axis: "ip", token: token(NETWORK_HASH), count: 2 },
    ])
    expect(body.users[U1].signals).toEqual({
      device: { token: token(DEVICE_HASH), count: 2 },
      browser: { token: token(BROWSER_UNIQUE), count: 1 },
      ip: { token: token(NETWORK_UNIQUE), count: 1 },
    })
  })

  it("tells each page row its cluster, decision and reasons — and says nothing about a clean one", async () => {
    const res = await list([U1, U3, U4].join(","))
    const body = res.json()

    expect(body.users[U1]).toMatchObject({ clusterId: 1, decision: "withheld", reasons: ["device_ip_match", "browser_match"], signalAt: "2026-10-08T14:00:00.000Z" })
    // U3 is in the cluster by the RPC's word but its own signal row was not among the page's.
    expect(body.users[U3]).toMatchObject({ clusterId: 1, signals: null, decision: null, reasons: [] })
    // U4 has signals nobody shares: no cluster, counts of one.
    expect(body.users[U4].clusterId).toBeNull()
    expect(body.users[U4].signals.device.count).toBe(1)
    expect(body.users[U4].decision).toBe("granted")
  })

  it("reads the page's signals only for the ids asked, from claim rows", async () => {
    await list([U1, U3, U4].join(","))
    expect(argsFor("signup_signals", "in")).toEqual([["user_id", [U1, U3, U4]]])
    expect(argsFor("signup_signals", "eq")).toEqual([["source", "claim"]])
  })
})

describe("GET /v1/admin/users/linkage — the 25-id cap", () => {
  it("attaches a page row the cap hid, through its own signal row", async () => {
    const known = Array.from({ length: 25 }, (_, i) => uid(100 + i))
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, known, { member_count: 26 })], error: null }])
    queueTable("signup_signals", { data: [signal(U9, { device: DEVICE_HASH })], error: null })

    const res = await list(U9)
    const body = res.json()
    expect(body.users[U9].clusterId).toBe(1)
    expect(body.clusters[0]).toMatchObject({ size: 26, unresolved: 0, tier: "large" })
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/users/linkage/cluster
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users/linkage/cluster", () => {
  beforeEach(() => {
    rpcPages.set("device", [{ data: [rpcRow(DEVICE_HASH, [U1, U2])], error: null }])
    rpcPages.set("ip", [{ data: [rpcRow(NETWORK_HASH, [U2, U3])], error: null }])
    // The walk's states first, then the members read.
    queueTable("profiles", { data: [state(U1, "withheld"), state(U2, "withheld"), state(U3, "granted")], error: null })
  })

  it("refuses a non-admin and rejects a key that is not a token", async () => {
    expect((await cluster(token(NETWORK_HASH), U1)).statusCode).toBe(403)
    expect((await cluster("not-a-token")).statusCode).toBe(400)
    expect((await cluster(NETWORK_HASH)).statusCode).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("names the members fresh — email, state, role — for exactly the cluster's ids, and nothing raw", async () => {
    queueTable("profiles", {
      data: [member(U1, "one@example.test", "withheld"), member(U2, "two@example.test", "withheld", "admin"), member(U3, "three@example.test", "granted")],
      error: null,
    })
    const res = await cluster(token(NETWORK_HASH))
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.data).toMatchObject({ key: token(NETWORK_HASH), id: 1, size: 3, unresolved: 0 })
    expect(body.data.members).toEqual([
      { userId: U1, email: "one@example.test", state: "withheld", role: "user" },
      { userId: U2, email: "two@example.test", state: "withheld", role: "admin" },
      { userId: U3, email: "three@example.test", state: "granted", role: "user" },
    ])
    expect(argsFor("profiles", "select").at(-1)).toEqual(["id, email, free_grant_state, role"])
    expect(argsFor("profiles", "in").at(-1)).toEqual(["id", [U1, U2, U3]])
    const text = JSON.stringify(body)
    expect(text).not.toContain(DEVICE_HASH)
    expect(text).not.toContain(NETWORK_HASH)
  })

  it("keeps a member whose profile row is gone", async () => {
    queueTable("profiles", { data: [member(U1, "one@example.test", "withheld")], error: null })
    const res = await cluster(token(NETWORK_HASH))
    expect(res.json().data.members.map((m: { userId: string; email: string | null }) => [m.userId, m.email])).toEqual([
      [U1, "one@example.test"],
      [U2, null],
      [U3, null],
    ])
  })

  it("is a 404 for a key no cluster has any more, and a 503 while the function is missing", async () => {
    expect((await cluster(token(BROWSER_UNIQUE))).statusCode).toBe(404)

    resetLinkageCache()
    rpcFailure = { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
    const res = await cluster(token(NETWORK_HASH))
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available_yet")
  })

  it("shares the list's cached walk instead of walking again", async () => {
    await list(U1)
    expect(mockRpc).toHaveBeenCalledTimes(3)
    queueTable("profiles", { data: [member(U1, "one@example.test", "withheld")], error: null })
    await cluster(token(NETWORK_HASH))
    expect(mockRpc).toHaveBeenCalledTimes(3)
  })
})
