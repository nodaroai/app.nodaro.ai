import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Admin access controls (migration 458), end to end through the REAL account- and
 * network-blocking libs over an in-memory Supabase: block / unblock an account (row +
 * a sign-in ban marked as ours), block / lift a network, and the two read views. Plain
 * admin gate — nothing here moves money — so the operator gate is mocked to REFUSE.
 */

const ADMIN = "00000000-0000-4000-8000-000000000002"
const NON_ADMIN = "00000000-0000-4000-8000-000000000001"
const SUPER = "00000000-0000-4000-8000-000000000003"
const TARGET = "00000000-0000-4000-8000-0000000000b2"
const OTHER_ADMIN = "00000000-0000-4000-8000-0000000000b3"
const OWNER = "00000000-0000-4000-8000-0000000000b4"
const PAYER = "00000000-0000-4000-8000-0000000000c3"
const MISSING = "00000000-0000-4000-8000-0000000000ff"

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>
  type Filter = { op: "eq" | "neq" | "gt" | "in"; column: string; value: unknown }
  type Query = {
    table: string; action: "select" | "insert" | "upsert" | "delete"; terminal: "await" | "single" | "maybeSingle"
    columns: string | null; values: Row | Row[] | null; options: Record<string, unknown> | null
    filters: Filter[]; returning: string | null; limit: number | null
  }
  type Result = { data: unknown; error: unknown; count: number | null }
  type AuthUser = { banned_until: string | null; app_metadata: Record<string, unknown> }
  const FAR_FUTURE = "2126-01-01T00:00:00.000Z"
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  /** Postgres compares `uuid` VALUES — an upper-case spelling finds the same row. */
  const same = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string" && UUID.test(a) && UUID.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b

  const state = {
    tables: new Map<string, Row[]>(),
    queries: [] as Query[],
    missingTables: new Set<string>(),
    /** `table.column` — reads answer 42703, writes PGRST204 (pre-migration database). */
    missingColumns: new Set<string>(),
    /** `table:action` → the error to answer. */
    errors: new Map<string, unknown>(),
    nextId: 1,
    authUsers: new Map<string, AuthUser>(),
    authUpdateError: null as unknown,
    /** Runs right after a write lands — something else changing the database in between two reads. */
    afterWrite: null as ((q: Query) => void) | null,
  }

  const list = <T,>(v: T | T[] | null): T[] => (v === null ? [] : Array.isArray(v) ? v : [v])
  const rowsOf = (table: string) => state.tables.get(table) ?? []
  const matches = (row: Row, filters: Filter[]) =>
    filters.every(({ op, column, value }) => {
      const v = row[column]
      if (op === "eq") return same(v, value)
      if (op === "neq") return !same(v, value)
      if (op === "gt") return typeof v === "string" && typeof value === "string" && v > value
      return Array.isArray(value) && value.some((x) => same(v, x))
    })
  const columnsOf = (spec: string | null) =>
    spec === null || spec.trim() === "*" ? null : spec.split(",").map((c) => c.trim()).filter(Boolean)
  /** Absent columns read as NULL, like a real row. */
  const project = (row: Row, spec: string | null) => {
    const cols = columnsOf(spec)
    return cols ? Object.fromEntries(cols.map((c) => [c, c in row ? row[c] : null])) : { ...row }
  }
  const withDefaults = (v: Row): Row => ({ id: `00000000-0000-4000-9000-${String(state.nextId++).padStart(12, "0")}`, created_at: new Date().toISOString(), ...v })

  /** A write without `.select()` returns no rows; `.single()` wants exactly one, `.maybeSingle()` at most one. */
  function shape(q: Query, rows: Row[], count: number | null): Result {
    if (q.action !== "select" && q.returning === null) return { data: null, error: null, count: null }
    const out = rows.map((r) => project(r, q.action === "select" ? q.columns : q.returning))
    if (q.terminal === "await") return { data: out, error: null, count }
    const ok = q.terminal === "single" ? out.length === 1 : out.length <= 1
    return ok ? { data: out[0] ?? null, error: null, count } : { data: null, error: { code: "PGRST116", message: `${out.length} rows` }, count }
  }

  function execute(q: Query): Result {
    state.queries.push(q)
    if (state.missingTables.has(q.table)) {
      return { data: null, error: { code: "42P01", message: `relation "public.${q.table}" does not exist` }, count: null }
    }
    const injected = state.errors.get(`${q.table}:${q.action}`)
    if (injected) return { data: null, error: injected, count: null }
    const touched = [...(columnsOf(q.columns) ?? []), ...list(q.values).flatMap((v) => Object.keys(v))]
    const missing = touched.find((c) => state.missingColumns.has(`${q.table}.${c}`))
    if (missing) {
      const code = q.action === "select" ? "42703" : "PGRST204"
      return { data: null, error: { code, message: `column ${q.table}.${missing} does not exist` }, count: null }
    }
    const all = rowsOf(q.table)
    if (q.action === "select") {
      const hits = all.filter((r) => matches(r, q.filters))
      return shape(q, q.limit === null ? hits : hits.slice(0, q.limit), hits.length)
    }
    if (q.action === "insert") {
      const added = list(q.values).map(withDefaults)
      state.tables.set(q.table, [...all, ...added])
      return shape(q, added, null)
    }
    if (q.action === "upsert") {
      const conflict = String(q.options?.onConflict ?? "id").split(",").map((c) => c.trim())
      let next = [...all]
      const written: Row[] = []
      for (const v of list(q.values)) {
        const at = next.findIndex((r) => conflict.every((c) => v[c] != null && same(r[c], v[c])))
        // ON CONFLICT DO NOTHING: the existing row stays as it is and is not returned.
        if (at >= 0 && q.options?.ignoreDuplicates === true) continue
        const row = at >= 0 ? { ...next[at], ...v } : withDefaults(v)
        next = at >= 0 ? next.map((r, i) => (i === at ? row : r)) : [...next, row]
        written.push(row)
      }
      state.tables.set(q.table, next)
      state.afterWrite?.(q)
      return shape(q, written, null)
    }
    const removed = all.filter((r) => matches(r, q.filters))
    state.tables.set(q.table, all.filter((r) => !matches(r, q.filters)))
    return shape(q, removed, null)
  }

  function from(table: string) {
    const q: Query = { table, action: "select", columns: null, values: null, options: null, filters: [], returning: null, limit: null, terminal: "await" }
    const filter = (op: Filter["op"]) => (column: string, value: unknown) => {
      q.filters.push({ op, column, value })
      return builder
    }
    const builder: Record<string, unknown> = {
      // `.select()` after a write is the RETURNING list.
      select: (columns = "*", options?: Record<string, unknown>) =>
        Object.assign(q, q.action === "select" ? { columns, options: options ?? null } : { returning: columns }) && builder,
      insert: (values: Row | Row[]) => Object.assign(q, { action: "insert", values }) && builder,
      upsert: (values: Row | Row[], options?: Record<string, unknown>) =>
        Object.assign(q, { action: "upsert", values, options: options ?? null }) && builder,
      delete: () => Object.assign(q, { action: "delete" }) && builder,
      eq: filter("eq"),
      neq: filter("neq"),
      gt: filter("gt"),
      in: filter("in"),
      order: () => builder,
      range: () => builder,
      limit: (n: number) => Object.assign(q, { limit: n }) && builder,
      single: async () => execute(Object.assign(q, { terminal: "single" })),
      maybeSingle: async () => execute(Object.assign(q, { terminal: "maybeSingle" })),
      then: (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve().then(() => execute(q)).then(onFulfilled, onRejected),
    }
    return builder
  }

  /** GoTrue parses the id as a uuid too. */
  const getUserById = vi.fn(async (id: string) => {
    const user = state.authUsers.get(id.toLowerCase())
    if (!user) return { data: { user: null }, error: { message: "User not found", status: 404 } }
    return { data: { user: { id: id.toLowerCase(), ...user, app_metadata: { ...user.app_metadata } } }, error: null }
  })
  const updateUserById = vi.fn(async (id: string, attrs: { ban_duration?: string; app_metadata?: Record<string, unknown> }) => {
    if (state.authUpdateError) return { data: { user: null }, error: state.authUpdateError }
    const key = id.toLowerCase()
    const user = state.authUsers.get(key)
    if (!user) return { data: { user: null }, error: { message: "User not found", status: 404 } }
    const banned_until =
      attrs.ban_duration === undefined ? user.banned_until : attrs.ban_duration === "none" ? null : FAR_FUTURE
    state.authUsers.set(key, { banned_until, app_metadata: { ...user.app_metadata, ...(attrs.app_metadata ?? {}) } })
    return { data: { user: null }, error: null }
  })

  return { state, from, rowsOf, getUserById, updateUserById, FAR_FUTURE }
})

const spies = vi.hoisted(() => ({
  invalidateAccessBlocks: vi.fn(),
  accessBlocksStatus: vi.fn(),
  invalidateAuthCache: vi.fn(),
  requirePlatformOperator: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => fake.from(table),
    rpc: vi.fn(),
    auth: { admin: { getUserById: fake.getUserById, updateUserById: fake.updateUserById } },
  },
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  invalidateAccessBlocks: spies.invalidateAccessBlocks,
  accessBlocksStatus: spies.accessBlocksStatus,
}))
vi.mock("@/middleware/auth.js", () => ({ invalidateAuthCache: spies.invalidateAuthCache }))
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    if (req.userId !== ADMIN && req.userId !== SUPER) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
// Kept real except the gate itself, which REFUSES everyone: these routes must not use it.
vi.mock("@/ee/middleware/require-platform-operator.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/middleware/require-platform-operator.js")>()),
  requirePlatformOperator: spies.requirePlatformOperator,
}))

import { adminAccessRoutes } from "../admin-access.js"
import { config } from "../../../lib/config.js"
import { networkHash } from "../../../lib/client-address.js"
import { networkKey } from "../../../lib/ip-address.js"
import { keyToken } from "../../lib/signup-signal-clusters.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import { __flushHttpErrorTelemetry, __resetHttpErrorTelemetry } from "../../../lib/http-errors.js"

const TOKEN_SECRET = config.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_IP = "85.65.91.64"
const TARGET_IP = "93.184.216.34"
const NOW = Date.parse("2026-10-05T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000
const STATUS = { ready: true, users: 0, networks: 0, loadedAt: null }
const BAN = { ban_duration: "876000h", app_metadata: { nodaro_access_block: true } }
const LIFT = { ban_duration: "none", app_metadata: { nodaro_access_block: null } }

const hashOf = (address: string) => networkHash(networkKey(address)!)
const rows = (table: string) => fake.rowsOf(table)
const seed = (table: string, ...added: Array<Record<string, unknown>>) => fake.state.tables.set(table, [...rows(table), ...added])

let app: FastifyInstance
let saved: Record<string, string | undefined> = {}
const ENV_KEYS = ["CLIENT_IP_HEADER", "CLIENT_IP_HEADER_FROM", "NETWORK_HASH_SECRET", "PLATFORM_OPERATOR_EMAILS", "PLATFORM_OWNER_EMAIL"] as const

beforeEach(async () => {
  vi.clearAllMocks()
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.CLIENT_IP_HEADER = "x-real-ip"
  process.env.CLIENT_IP_HEADER_FROM = "100.64.0.0/10"
  process.env.PLATFORM_OPERATOR_EMAILS = ""
  process.env.PLATFORM_OWNER_EMAIL = "owner@nodaro.test"
  spies.accessBlocksStatus.mockResolvedValue(STATUS)
  spies.requirePlatformOperator.mockImplementation(async (_req: unknown, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    reply.status(403).send({ error: { code: "operator_required", message: "operator only" } })
  })
  Object.assign(fake.state, {
    tables: new Map(),
    queries: [],
    missingTables: new Set(),
    missingColumns: new Set(),
    errors: new Map(),
    authUpdateError: null,
    afterWrite: null,
    authUsers: new Map([[TARGET, { banned_until: null, app_metadata: {} }], [PAYER, { banned_until: null, app_metadata: {} }]]),
  })
  seed(
    "profiles",
    { id: ADMIN, email: "admin@nodaro.test", role: "admin" },
    { id: SUPER, email: "super@nodaro.test", role: "super_admin" },
    { id: NON_ADMIN, email: "user@example.test", role: "user" },
    { id: TARGET, email: "target@example.test", role: "user", tier: "free" },
    { id: OTHER_ADMIN, email: "other-admin@nodaro.test", role: "admin" },
    { id: OWNER, email: "Owner@Nodaro.test", role: "user" },
    { id: PAYER, email: "billing@customer.test", role: "user" },
  )
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") (req as { userId?: string }).userId = h
  })
  await app.register(async (i) => {
    await adminAccessRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await __flushHttpErrorTelemetry()
  __resetHttpErrorTelemetry()
  __resetDeploymentPayerForTests()
  vi.useRealTimers()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await app.close()
})

function whoami(headers: Record<string, string>, userId = ADMIN) {
  return app.inject({ method: "GET", url: "/v1/admin/access/whoami", headers: { "x-user-id": userId, ...headers } })
}

/** A request from `as`, whose address (stated by the trusted edge) is `ip`. */
function call(method: "GET" | "POST" | "DELETE", url: string, opts: { as?: string; body?: Record<string, unknown>; ip?: string } = {}) {
  return app.inject({
    method,
    url,
    headers: { "x-user-id": opts.as ?? ADMIN, "x-forwarded-for": "100.64.3.4", "x-real-ip": opts.ip ?? ADMIN_IP },
    ...(opts.body ? { payload: opts.body } : {}),
  })
}

const audits = () => rows("admin_actions").map(({ id: _id, created_at: _at, ...rest }) => rest)

function signup(userId: string, address: string, scheme: "client" | null = "client", tier = "free") {
  seed("signup_signals", { user_id: userId, source: "claim", ip_hash: hashOf(address), ip_scheme: scheme, created_at: "2026-09-01T10:00:00.000Z" })
  if (!rows("profiles").some((p) => p.id === userId)) seed("profiles", { id: userId, email: null, role: "user", tier, subscription_tier: null, lifetime_topup_credits: 0 })
}
function othersOn(address: string, count: number, paying = 0) {
  for (let i = 0; i < count; i++) signup(`00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`, address, "client", i < paying ? "pro" : "free")
}

describe("GET /v1/admin/access/whoami", () => {
  it("is admin-only", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4", "x-real-ip": "85.65.91.64" }, NON_ADMIN)
    expect(res.statusCode).toBe(403)
  })

  it("shows how the server sees the caller: the edge's statement, the hop, a network token", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4", "x-real-ip": "85.65.91.64" })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({
      address: "85.65.91.64",
      source: "edge-header",
      hop: "100.64.3.4",
      header: "x-real-ip",
      network: "85.65.91.64",
      hashScheme: "sha256",
    })
    expect(data.networkToken).toMatch(/^[0-9a-f]{12}$/)
  })

  it("reports unknown — not the proxy — when the edge states nothing", async () => {
    const res = await whoami({ "x-forwarded-for": "100.64.3.4" })
    expect(res.json().data).toMatchObject({ address: null, source: "unknown", hop: "100.64.3.4", network: null, networkToken: null })
  })
})

describe("every access route is admin-only", () => {
  it.each([
    ["POST", `/v1/admin/users/${TARGET}/block`],
    ["POST", `/v1/admin/users/${TARGET}/unblock`],
    ["POST", "/v1/admin/access/networks"],
    ["DELETE", "/v1/admin/access/networks/00000000-0000-4000-9000-00000000abcd"],
    ["GET", "/v1/admin/access/blocks"],
    ["GET", `/v1/admin/users/${TARGET}/access`],
  ] as const)("%s %s refuses a non-admin before it reads or writes anything", async (method, url) => {
    seed("account_blocks", { user_id: TARGET })
    signup(TARGET, TARGET_IP)
    const res = await call(method, url, { as: NON_ADMIN, body: method === "POST" ? { userId: TARGET } : undefined })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(fake.state.queries).toEqual([])
    expect(fake.getUserById).not.toHaveBeenCalled()
    expect(fake.updateUserById).not.toHaveBeenCalled()
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
  })
})

describe("POST /v1/admin/users/:id/block", () => {
  const block = (id: string, body?: Record<string, unknown>, as = ADMIN) => call("POST", `/v1/admin/users/${id}/block`, { as, body })
  const nothingHappened = () => {
    expect(rows("account_blocks")).toEqual([])
    expect(fake.updateUserById).not.toHaveBeenCalled()
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
  }

  it("rejects a malformed id and a reason over 500 characters", async () => {
    expect((await block("not-a-uuid")).statusCode).toBe(400)
    const res = await block(TARGET, { reason: "x".repeat(501) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    nothingHappened()
  })

  it.each([
    ["the admin's own account", ADMIN, 403, "cannot_block_self"],
    ["another admin", OTHER_ADMIN, 403, "target_is_admin"],
    ["a super admin", SUPER, 403, "target_is_admin"],
    ["the platform owner (by email)", OWNER, 403, "target_protected"],
    ["an account that does not exist", MISSING, 404, "not_found"],
  ])("refuses %s → %i %s, and touches nothing", async (_label, id, status, code) => {
    const res = await block(id)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    nothingHappened()
  })

  it("refuses the deployment's billing account", async () => {
    __setDeploymentPayerForTests(PAYER)
    const res = await block(PAYER)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_account_protected")
    nothingHappened()
  })

  it("refuses the billing account when its id is spelled in upper case too (same uuid, same account)", async () => {
    __setDeploymentPayerForTests(PAYER)
    const res = await block(PAYER.toUpperCase())
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_account_protected")
    nothingHappened()
  })

  it("blocks: writes the row, bans sign-in with OUR marker in one call, invalidates, audits", async () => {
    const res = await block(TARGET, { reason: "  card-testing farm  " })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { userId: TARGET, blocked: true, signInBlocked: true, warning: null } })
    expect(rows("account_blocks")).toEqual([expect.objectContaining({ user_id: TARGET, reason: "card-testing farm", blocked_by: ADMIN })])
    expect(fake.updateUserById).toHaveBeenCalledTimes(1)
    expect(fake.updateUserById).toHaveBeenCalledWith(TARGET, BAN)
    expect(spies.invalidateAccessBlocks).toHaveBeenCalledTimes(1)
    expect(spies.invalidateAuthCache).toHaveBeenCalledWith(TARGET)
    expect(audits()).toEqual([
      { admin_user_id: ADMIN, action: "account_block", target_type: "user", target_id: TARGET, reason: "card-testing farm", payload: { signInBlocked: true } },
    ])
  })

  it("an empty reason is stored as no reason", async () => {
    expect((await block(TARGET, { reason: "   " })).statusCode).toBe(200)
    expect(rows("account_blocks")[0]).toMatchObject({ reason: null })
  })

  it("pressing Block again keeps one row and its first block time, and bans only once", async () => {
    await block(TARGET, { reason: "first" })
    const firstAt = rows("account_blocks")[0]!.created_at
    const res = await block(TARGET, { reason: "second" })
    expect(res.json().data).toMatchObject({ blocked: true, signInBlocked: true, warning: null })
    expect(rows("account_blocks")).toHaveLength(1)
    // "Block again" finishes a sign-in step; it must not rewrite who blocked and why.
    expect(rows("account_blocks")[0]).toMatchObject({ reason: "first", blocked_by: ADMIN, created_at: firstAt })
    expect(fake.updateUserById).toHaveBeenCalledTimes(1)
  })

  it("an account promoted to admin between the role check and the write is not left blocked", async () => {
    // The role is read before the row is written; a promotion landing in
    // between would otherwise leave a blocked admin.
    fake.state.afterWrite = (q) => {
      if (q.table !== "account_blocks") return
      fake.state.tables.set(
        "profiles",
        rows("profiles").map((p) => (p.id === TARGET ? { ...p, role: "admin" } : p)),
      )
    }
    const res = await block(TARGET, { reason: "farm" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("target_is_admin")
    expect(rows("account_blocks")).toEqual([])
    expect(fake.updateUserById).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
  })

  it("an account already banned by something else is blocked without adopting that ban", async () => {
    fake.state.authUsers.set(TARGET, { banned_until: fake.FAR_FUTURE, app_metadata: { sso: null } })
    const res = await block(TARGET)
    expect(res.json().data).toMatchObject({ blocked: true, signInBlocked: true })
    expect(fake.updateUserById).not.toHaveBeenCalled()
  })

  it("a failed sign-in ban still answers 200 — blocked, with a warning to press Block again", async () => {
    fake.state.authUpdateError = { message: "gotrue unavailable", status: 503 }
    const res = await block(TARGET)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ userId: TARGET, blocked: true, signInBlocked: false })
    expect(data.warning).toMatch(/Block again/)
    expect(rows("account_blocks")).toHaveLength(1)
    expect(spies.invalidateAccessBlocks).toHaveBeenCalledTimes(1)
    expect(audits()).toEqual([expect.objectContaining({ action: "account_block", payload: { signInBlocked: false } })])
  })

  it("503 blocks_unavailable before migration 458 — and no ban, no audit", async () => {
    fake.state.missingTables.add("account_blocks")
    const res = await block(TARGET)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("blocks_unavailable")
    nothingHappened()
  })

  it("a database failure is a sanitized 500", async () => {
    fake.state.errors.set("profiles:select", { code: "XX000", message: "relation profiles is on fire" })
    const res = await block(TARGET)
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: "Failed to block the account" })
    nothingHappened()
  })
})

describe("POST /v1/admin/users/:id/unblock", () => {
  const unblock = (id: string, as = ADMIN) => call("POST", `/v1/admin/users/${id}/unblock`, { as })
  const blocked = (app_metadata: Record<string, unknown>) => {
    seed("account_blocks", { user_id: TARGET, reason: "spam", blocked_by: ADMIN, created_at: "2026-10-01T00:00:00.000Z" })
    fake.state.authUsers.set(TARGET, { banned_until: fake.FAR_FUTURE, app_metadata })
  }

  it("deletes the row, lifts OUR ban, invalidates, audits", async () => {
    blocked({ nodaro_access_block: true })
    const res = await unblock(TARGET)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { userId: TARGET, blocked: false, signInBlocked: false, warning: null } })
    expect(rows("account_blocks")).toEqual([])
    expect(fake.updateUserById).toHaveBeenCalledTimes(1)
    expect(fake.updateUserById).toHaveBeenCalledWith(TARGET, LIFT)
    expect(spies.invalidateAccessBlocks).toHaveBeenCalledTimes(1)
    expect(spies.invalidateAuthCache).toHaveBeenCalledWith(TARGET)
    expect(audits()).toEqual([
      { admin_user_id: ADMIN, action: "account_unblock", target_type: "user", target_id: TARGET, reason: null, payload: { removed: true, signInBlocked: false } },
    ])
  })

  it("never lifts a ban it did not place (no marker)", async () => {
    blocked({ sso: null, sso_subject: null })
    const res = await unblock(TARGET)
    expect(res.json().data).toMatchObject({ blocked: false, signInBlocked: true, warning: null })
    expect(rows("account_blocks")).toEqual([])
    expect(fake.updateUserById).not.toHaveBeenCalled()
  })

  it("an account that was not blocked answers 200 and records that nothing was removed", async () => {
    const res = await unblock(TARGET)
    expect(res.statusCode).toBe(200)
    expect(audits()).toEqual([expect.objectContaining({ action: "account_unblock", payload: { removed: false, signInBlocked: false } })])
  })

  it("a failed lift answers 200 with a warning to press Unblock again", async () => {
    blocked({ nodaro_access_block: true })
    fake.state.authUpdateError = { message: "gotrue unavailable" }
    const res = await unblock(TARGET)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ blocked: false, signInBlocked: null })
    expect(res.json().data.warning).toMatch(/Unblock again/)
    expect(rows("account_blocks")).toEqual([])
  })

  it("503 blocks_unavailable before migration 458", async () => {
    fake.state.missingTables.add("account_blocks")
    const res = await unblock(TARGET)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("blocks_unavailable")
    expect(fake.updateUserById).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
  })
})

describe("POST /v1/admin/access/networks — an account's signup network", () => {
  const blockNet = (body: Record<string, unknown>, as = ADMIN) => call("POST", "/v1/admin/access/networks", { as, body })
  const noBlock = () => {
    expect(rows("blocked_networks")).toEqual([])
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
  }

  it.each([
    ["neither userId nor address", {}],
    ["both userId and address", { userId: TARGET, address: "93.184.216.0/24" }],
    ["a duration that is not offered", { userId: TARGET, days: 14 }],
    ["a duration sent as text", { userId: TARGET, days: "30" }],
  ])("400 for %s", async (_label, body) => {
    const res = await blockNet(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    noBlock()
  })

  it("404 when the account never claimed (no recorded signup network)", async () => {
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    noBlock()
  })

  it("409 not_blockable when the signup address was not recorded as a client address", async () => {
    signup(TARGET, TARGET_IP, null)
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_blockable")
    noBlock()
  })

  it("409 not_blockable on a database without the marker column yet (pre-458)", async () => {
    signup(TARGET, TARGET_IP, "client")
    fake.state.missingColumns.add("signup_signals.ip_scheme")
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_blockable")
    noBlock()
  })

  it("409 own_network when the account signed up from the network the admin is on", async () => {
    signup(TARGET, ADMIN_IP)
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("own_network")
    noBlock()
  })

  it.each([
    ["20 other accounts", 20, 0],
    ["one paying account", 1, 1],
  ])("%s: 403 needs_super_admin for a plain admin", async (_label, count, paying) => {
    signup(TARGET, TARGET_IP)
    othersOn(TARGET_IP, count, paying)
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("needs_super_admin")
    noBlock()
  })

  it("19 non-paying others: a plain admin may block it", async () => {
    signup(TARGET, TARGET_IP)
    othersOn(TARGET_IP, 19)
    expect((await blockNet({ userId: TARGET })).statusCode).toBe(200)
  })

  it("a super admin may block a network that needs one — the collateral goes in the audit", async () => {
    signup(TARGET, TARGET_IP)
    othersOn(TARGET_IP, 20)
    const res = await blockNet({ userId: TARGET, label: "farm" }, SUPER)
    expect(res.statusCode).toBe(200)
    expect(rows("blocked_networks")).toEqual([
      expect.objectContaining({ network_hash: hashOf(TARGET_IP), source_user_id: TARGET, created_by: SUPER, label: "farm" }),
    ])
    expect(audits()).toEqual([
      {
        admin_user_id: SUPER,
        action: "network_block",
        target_type: "blocked_network",
        target_id: res.json().data.id,
        reason: "farm",
        payload: { range: null, fromUser: TARGET, days: 30, superAdminOnly: true, otherAccounts: 20, payingAccounts: 0, targetPaying: false },
      },
    ])
    // Only a super admin could place it, so only a super admin lifts it.
    expect(rows("blocked_networks")[0]).toMatchObject({ super_admin_only: true })
    expect(res.json().data.superAdminOnly).toBe(true)
  })

  it("a paying account's own signup network is a super admin's call, even with nobody else on it", async () => {
    signup(TARGET, TARGET_IP)
    fake.state.tables.set(
      "profiles",
      rows("profiles").map((p) => (p.id === TARGET ? { ...p, tier: "pro" } : p)),
    )
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("needs_super_admin")
    noBlock()
  })

  it("blocks: upserts on network_hash, expires in 30 days by default, answers a token — never the raw hash", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    signup(TARGET, TARGET_IP)
    const res = await blockNet({ userId: TARGET })
    expect(res.statusCode).toBe(200)
    const hash = hashOf(TARGET_IP)
    const expiresAt = new Date(NOW + 30 * DAY_MS).toISOString()
    const data = res.json().data
    expect(data).toEqual({ id: expect.any(String), range: null, token: keyToken(hash, TOKEN_SECRET), expiresAt, superAdminOnly: false })
    expect(res.body).not.toContain(hash.slice(0, 12))
    const upsert = fake.state.queries.find((q) => q.table === "blocked_networks" && q.action === "upsert")!
    expect(upsert.options).toEqual({ onConflict: "network_hash" })
    expect(rows("blocked_networks")).toEqual([
      expect.objectContaining({
        id: data.id,
        network_hash: hash,
        label: null,
        source_user_id: TARGET,
        created_by: ADMIN,
        expires_at: expiresAt,
        super_admin_only: false,
      }),
    ])
    expect(rows("blocked_networks")[0]).not.toHaveProperty("cidr")
    expect(spies.invalidateAccessBlocks).toHaveBeenCalledTimes(1)
  })

  it("a chosen duration sets the expiry, and blocking again refreshes the one row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    signup(TARGET, TARGET_IP)
    await blockNet({ userId: TARGET, days: 7 })
    expect(rows("blocked_networks")[0]).toMatchObject({ expires_at: new Date(NOW + 7 * DAY_MS).toISOString() })
    await blockNet({ userId: TARGET, days: 90 })
    expect(rows("blocked_networks")).toHaveLength(1)
    expect(rows("blocked_networks")[0]).toMatchObject({ expires_at: new Date(NOW + 90 * DAY_MS).toISOString() })
  })
})

describe("POST /v1/admin/access/networks — a typed address or range", () => {
  const blockAddress = (address: string, as = ADMIN, ip = ADMIN_IP) => call("POST", "/v1/admin/access/networks", { as, ip, body: { address } })

  it.each([
    ["not an address", "not-an-ip", 400, "invalid_address"],
    ["a private range", "192.168.0.0/16", 409, "not_public"],
    ["a Cloudflare edge address", "104.16.0.1", 409, "cloudflare"],
    ["wider than any admin may block", "93.0.0.0/8", 409, "too_wide"],
    ["the admin's own address", ADMIN_IP, 409, "own_network"],
    ["any range wider than one address, for a plain admin", "93.184.216.0/24", 403, "too_wide_for_admin"],
  ])("refuses %s → %i %s", async (_label, address, status, code) => {
    const res = await blockAddress(address)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(rows("blocked_networks")).toEqual([])
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
  })

  it("a /16 is too wide for a plain admin (403) and allowed for a super admin", async () => {
    const plain = await blockAddress("93.184.0.0/16")
    expect(plain.statusCode).toBe(403)
    expect(plain.json().error.code).toBe("too_wide_for_admin")
    expect(rows("blocked_networks")).toEqual([])
    const res = await blockAddress("93.184.0.0/16", SUPER)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ range: "93.184.0.0/16", token: null, superAdminOnly: true })
    expect(rows("blocked_networks")[0]).toMatchObject({ cidr: "93.184.0.0/16", super_admin_only: true })
  })

  it("a super admin is still refused a range holding their own address", async () => {
    const res = await blockAddress("85.65.0.0/16", SUPER)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("own_network")
  })

  it("a single IPv4 address blocks its /32, upserted on cidr, and is audited", async () => {
    const res = await blockAddress("93.184.216.34")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ range: "93.184.216.34/32", token: null })
    const upsert = fake.state.queries.find((q) => q.table === "blocked_networks" && q.action === "upsert")!
    expect(upsert.options).toEqual({ onConflict: "cidr" })
    expect(rows("blocked_networks")).toEqual([
      expect.objectContaining({ cidr: "93.184.216.34/32", source_user_id: null, created_by: ADMIN, super_admin_only: false }),
    ])
    expect(audits()).toEqual([
      expect.objectContaining({
        action: "network_block",
        payload: { range: "93.184.216.34/32", fromUser: null, days: 30, superAdminOnly: false },
      }),
    ])
  })

  it("a single IPv6 address blocks its /64", async () => {
    const res = await blockAddress("2a01:4f8:1:2:aaaa:bbbb:cccc:dddd")
    expect(res.statusCode).toBe(200)
    expect(res.json().data.range).toBe("2a01:4f8:1:2::/64")
  })
})

describe("DELETE /v1/admin/access/networks/:id", () => {
  const NET = "00000000-0000-4000-9000-00000000abcd"
  const lift = (id: string, as = ADMIN) => call("DELETE", `/v1/admin/access/networks/${id}`, { as })

  it("404 when nothing was removed — nothing invalidated or audited", async () => {
    const res = await lift(NET)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
  })

  it("lifts: deletes the row, invalidates, audits the range", async () => {
    seed("blocked_networks", { id: NET, cidr: "93.184.216.0/24", expires_at: "2027-01-01T00:00:00.000Z" })
    const res = await lift(NET)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { id: NET, removed: true } })
    expect(rows("blocked_networks")).toEqual([])
    expect(spies.invalidateAccessBlocks).toHaveBeenCalledTimes(1)
    expect(audits()).toEqual([
      { admin_user_id: ADMIN, action: "network_unblock", target_type: "blocked_network", target_id: NET, reason: null, payload: { range: "93.184.216.0/24" } },
    ])
  })

  it("a block only a super admin could place, only a super admin lifts", async () => {
    seed("blocked_networks", { id: NET, cidr: "93.184.0.0/16", super_admin_only: true, expires_at: "2027-01-01T00:00:00.000Z" })
    const plain = await lift(NET)
    expect(plain.statusCode).toBe(403)
    expect(plain.json().error.code).toBe("super_admin_to_lift")
    expect(rows("blocked_networks")).toHaveLength(1)
    expect(spies.invalidateAccessBlocks).not.toHaveBeenCalled()
    expect(audits()).toEqual([])

    const res = await lift(NET, SUPER)
    expect(res.statusCode).toBe(200)
    expect(rows("blocked_networks")).toEqual([])
  })

  it("400 for a malformed id; 503 before migration 458", async () => {
    expect((await lift("nope")).statusCode).toBe(400)
    fake.state.missingTables.add("blocked_networks")
    const res = await lift(NET)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("blocks_unavailable")
  })
})

describe("the read views", () => {
  it("GET /v1/admin/access/blocks: ready:false with empty lists before the tables exist", async () => {
    fake.state.missingTables.add("account_blocks")
    const res = await call("GET", "/v1/admin/access/blocks")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: { ready: false, status: STATUS, users: [], networks: [], usersTruncated: false, networksTruncated: false },
    })
  })

  it("GET /v1/admin/access/blocks: accounts and LIVE network blocks, by email and token — never a raw hash", async () => {
    const hash = hashOf(TARGET_IP)
    seed("account_blocks", { user_id: TARGET, reason: "spam", blocked_by: ADMIN, created_at: "2026-10-01T00:00:00.000Z" })
    seed(
      "blocked_networks",
      { id: "n1", network_hash: hash, cidr: null, label: "farm", source_user_id: TARGET, created_by: ADMIN, created_at: "2026-10-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
      { id: "n2", network_hash: null, cidr: "93.184.216.0/24", label: null, source_user_id: null, created_by: SUPER, created_at: "2026-10-02T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" },
      { id: "n3", network_hash: null, cidr: "93.184.217.0/24", label: null, source_user_id: null, created_by: ADMIN, created_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-02-01T00:00:00.000Z" },
    )
    const res = await call("GET", "/v1/admin/access/blocks")
    const data = res.json().data
    expect(data.ready).toBe(true)
    expect(data.users).toEqual([
      { userId: TARGET, email: "target@example.test", reason: "spam", blockedBy: "admin@nodaro.test", blockedAt: "2026-10-01T00:00:00.000Z" },
    ])
    expect(data.networks.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"])
    expect(data.networks[0]).toMatchObject({
      range: null,
      token: keyToken(hash, TOKEN_SECRET),
      label: "farm",
      fromUser: "target@example.test",
      superAdminOnly: false,
    })
    expect(data.networks[1]).toMatchObject({ range: "93.184.216.0/24", token: null, blockedBy: "super@nodaro.test" })
    expect(data.usersTruncated).toBe(false)
    expect(data.networksTruncated).toBe(false)
    expect(res.body).not.toContain(hash)
  })

  it("GET /v1/admin/access/blocks: says when a list was cut at its newest 500", async () => {
    for (let i = 0; i < 501; i++) {
      seed("account_blocks", {
        user_id: `00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`,
        created_at: new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 1000).toISOString(),
      })
    }
    const data = (await call("GET", "/v1/admin/access/blocks")).json().data
    expect(data.users).toHaveLength(500)
    expect(data.usersTruncated).toBe(true)
    expect(data.networksTruncated).toBe(false)
  })

  it("GET /v1/admin/users/:id/access: the block, the ban, and the signup network with its collateral", async () => {
    const hash = hashOf(TARGET_IP)
    seed("account_blocks", { user_id: TARGET, reason: "spam", blocked_by: ADMIN, created_at: "2026-10-01T00:00:00.000Z" })
    fake.state.authUsers.set(TARGET, { banned_until: fake.FAR_FUTURE, app_metadata: { nodaro_access_block: true } })
    signup(TARGET, TARGET_IP)
    othersOn(TARGET_IP, 2, 1)
    seed("blocked_networks", { id: "n1", network_hash: hash, expires_at: "2099-01-01T00:00:00.000Z" })
    const res = await call("GET", `/v1/admin/users/${TARGET}/access`)
    expect(res.json()).toEqual({
      data: {
        ready: true,
        blocked: true,
        reason: "spam",
        blockedAt: "2026-10-01T00:00:00.000Z",
        signInBlocked: true,
        signInBanIsOurs: true,
        network: {
          token: keyToken(hash, TOKEN_SECRET),
          blockable: true,
          signupAt: "2026-09-01T10:00:00.000Z",
          otherAccounts: 2,
          payingAccounts: 1,
          needsSuperAdmin: true,
          blocked: true,
        },
      },
    })
  })

  it("GET /v1/admin/users/:id/access before the tables exist: ready:false, nothing reads as blocked", async () => {
    fake.state.missingTables.add("account_blocks")
    fake.state.missingTables.add("blocked_networks")
    signup(TARGET, TARGET_IP)
    const data = (await call("GET", `/v1/admin/users/${TARGET}/access`)).json().data
    expect(data).toMatchObject({ ready: false, blocked: false, signInBlocked: false, network: { blocked: false } })
  })
})

describe("gate: a plain admin, not the platform operator (nothing here moves money)", () => {
  it("on a deployment-payer instance a plain admin still blocks, unblocks and blocks networks", async () => {
    __setDeploymentPayerForTests(PAYER)
    expect((await call("POST", `/v1/admin/users/${TARGET}/block`)).statusCode).toBe(200)
    expect((await call("POST", `/v1/admin/users/${TARGET}/unblock`)).statusCode).toBe(200)
    expect((await call("POST", "/v1/admin/access/networks", { body: { address: "93.184.216.34" } })).statusCode).toBe(200)
    expect(spies.requirePlatformOperator).not.toHaveBeenCalled()
  })
})
