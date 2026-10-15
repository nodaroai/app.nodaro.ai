// @test-watches supabase/migrations/*.sql backend/src/routes/jobs.ts
/**
 * /v1/webhook-endpoints (routes/webhook-endpoints.ts).
 *
 * What must hold: every read and write is the caller's own row in this
 * environment (and, for a connected app's token, only that app's endpoints);
 * a miss is 404; the signing secret is returned on create and on rotate and
 * never again; https to a public host only; the cap, the scope, the
 * validation, the delivery log's keyset and the test ping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"
import { readFileSync } from "node:fs"
import { join } from "node:path"

type Op = [string, unknown[]]
interface Query {
  table: string
  ops: Op[]
}
interface Result {
  data?: unknown
  error?: { code?: string; message?: string; details?: string } | null
}

const db = vi.hoisted(() => ({
  log: [] as Query[],
  respond: (_q: Query): Result => ({ data: null, error: null }),
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcRespond: (_fn: string, _args: Record<string, unknown>): Result => ({ data: null, error: null }),
}))

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    const q: Query = { table, ops: [] }
    db.log.push(q)
    const settle = () => {
      const r = db.respond(q)
      return { data: r.data ?? null, error: r.error ?? null }
    }
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(settle()).then(resolve, reject)
          }
          if (prop === "single" || prop === "maybeSingle") {
            return () => {
              q.ops.push([prop, []])
              return Promise.resolve(settle())
            }
          }
          return (...args: unknown[]) => {
            q.ops.push([prop, args])
            return chain
          }
        },
      },
    )
    return chain
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    db.rpcs.push({ fn, args })
    const r = db.rpcRespond(fn, args)
    return { data: r.data ?? null, error: r.error ?? null }
  }
  return { supabase: { from, rpc } }
})

// A 500 files an incident report in the background; keep it off the fake.
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => undefined) }))

const secrets = vi.hoisted(() => ({
  next: "whsec_" + "s".repeat(43),
  seal: vi.fn(),
}))
vi.mock("../../lib/webhooks/secret.js", () => ({
  generateSigningSecret: () => secrets.next,
  sealSigningSecret: (secret: string, binding: unknown) => secrets.seal(secret, binding),
}))

import { webhookEndpointRoutes } from "../webhook-endpoints.js"
import { DELIVERY_COLS, ENDPOINT_COLS, MAX_ENDPOINTS_PER_ACCOUNT, encodeCursor } from "../../lib/webhooks/endpoints.js"
import { EncryptionKeyMissingError } from "../../lib/instance-cipher.js"
import { migrationColumnsOf } from "../../test/migration-columns.js"

// Every route test mocks supabase, so a column name that does not exist would
// pass them all and fail only against the database: names are checked against
// the columns the migrations leave.
const WEBHOOK_COLUMNS = migrationColumnsOf("webhooks")
const DELIVERY_COLUMNS = migrationColumnsOf("webhook_deliveries")
const unknownColumns = (keys: Iterable<string>, table: Set<string>) => [...keys].filter((k) => !table.has(k))

const OWNER = "00000000-0000-4000-8000-000000000001"
const APP = "00000000-0000-4000-8000-0000000000a1"
const EP = "00000000-0000-4000-8000-0000000000e1"
const DELIVERY = "00000000-0000-4000-8000-0000000000d1"

const ROW = {
  id: EP,
  user_id: OWNER,
  url: "https://hooks.example.com/in",
  description: "orders",
  events: ["job.completed", "job.failed"],
  is_active: true,
  app_id: null,
  runtime_env: "production",
  consecutive_failures: 0,
  disabled_reason: null,
  disabled_at: null,
  secret_created_at: "2026-10-15T10:00:00+00:00",
  previous_secret_expires_at: null,
  created_at: "2026-10-15T10:00:00+00:00",
  updated_at: "2026-10-15T10:00:00+00:00",
}

const DELIVERY_ROW = {
  id: DELIVERY,
  webhook_id: EP,
  user_id: OWNER,
  job_id: "00000000-0000-4000-8000-0000000000b1",
  event: "job.completed",
  status: "failed",
  attempts: 8,
  response_status: 500,
  response_body: "oops",
  duration_ms: 120,
  last_error: "http_500",
  payload: '{"id":"x","type":"job.completed"}',
  created_at: "2026-10-15T10:00:00.123456+00:00",
  last_attempt_at: "2026-10-17T05:00:00+00:00",
  next_retry_at: null,
  delivered_at: null,
}

let app: FastifyInstance

function queries(table: string, op?: string): Query[] {
  return db.log.filter((q) => q.table === table && (!op || q.ops.some(([name]) => name === op)))
}
function argOf(q: Query | undefined, op: string): unknown[] | undefined {
  return q?.ops.find(([name]) => name === op)?.[1]
}
function has(q: Query | undefined, op: string, ...args: unknown[]): boolean {
  return !!q?.ops.some(([name, a]) => name === op && JSON.stringify(a) === JSON.stringify(args))
}

function as(user: string | null, scopes?: string, appId = APP): Record<string, string> {
  const headers: Record<string, string> = {}
  if (user) headers["x-user-id"] = user
  if (scopes !== undefined) {
    headers["x-app-scopes"] = scopes
    headers["x-app-id"] = appId
  }
  return headers
}

beforeEach(async () => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  db.rpcs.length = 0
  db.rpcRespond = () => ({ data: null, error: null })
  secrets.seal.mockReset()
  secrets.seal.mockImplementation((_secret: string, b: { endpointId: string }) => `sealed-for-${b.endpointId}`)
  process.env.RUNTIME_ENV = "production"

  app = Fastify({ logger: false })
  await app.register(rateLimit, { global: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") {
      req.appAuthorization = { appId: String(req.headers["x-app-id"]), authorizationId: "auth-1", scopes: scopes.split(" ").filter(Boolean) }
    }
  })
  await app.register(webhookEndpointRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  delete process.env.RUNTIME_ENV
})

describe("POST /v1/webhook-endpoints", () => {
  it("creates an endpoint in this environment and returns its secret, once", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : {})
    const res = await app.inject({
      method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER),
      payload: { url: "https://hooks.example.com/in", description: "orders" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.headers["cache-control"]).toBe("no-store")
    const body = res.json()
    expect(body.secret).toBe(secrets.next)
    expect(body.data).toMatchObject({ id: EP, url: "https://hooks.example.com/in", events: ["job.completed", "job.failed"], isActive: true, appId: null })
    expect(JSON.stringify(body.data)).not.toMatch(/whsec_|sealed|secret_ciphertext/)

    const [insert] = queries("webhooks", "insert")
    const row = argOf(insert, "insert")![0] as Record<string, unknown>
    expect(row).toMatchObject({
      user_id: OWNER,
      url: "https://hooks.example.com/in",
      events: ["job.completed", "job.failed"],
      description: "orders",
      is_active: true,
      runtime_env: "production",
      app_id: null,
    })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    // Sealed for THIS row, owner and environment; the plaintext is not stored.
    expect(secrets.seal).toHaveBeenCalledWith(secrets.next, { endpointId: row.id, userId: OWNER, runtimeEnv: "production" })
    expect(row.secret_ciphertext).toBe(`sealed-for-${row.id}`)
    expect(JSON.stringify(row)).not.toContain(secrets.next)
    expect(typeof row.secret_created_at).toBe("string")
    // No read ever selects the ciphertext back.
    expect(String(argOf(insert, "select")![0])).not.toContain("secret_ciphertext")
    expect(unknownColumns(Object.keys(row), WEBHOOK_COLUMNS)).toEqual([])
  })

  it("subscribes to the events asked for, once each", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: { ...ROW, events: ["job.failed"] } } : {})
    const res = await app.inject({
      method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER),
      payload: { url: "https://hooks.example.com/in", events: ["job.failed", "job.failed"] },
    })
    expect(res.statusCode).toBe(201)
    expect((argOf(queries("webhooks", "insert")[0], "insert")![0] as Record<string, unknown>).events).toEqual(["job.failed"])
  })

  it.each([
    ["http://hooks.example.com/in", /https/],
    ["https://localhost/in", /public address/],
    ["https://127.0.0.1/in", /public address/],
    ["https://10.1.2.3/in", /public address/],
    ["https://169.254.169.254/latest", /public address/],
    ["https://[::1]/in", /public address/],
    ["https://user:pass@hooks.example.com/in", /user name or password/],
    ["not a url", /https/],
  ])("refuses %s", async (url, message) => {
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(message)
    expect(queries("webhooks")).toHaveLength(0)
  })

  it("refuses this server's own storage as a receiver", async () => {
    process.env.R2_PUBLIC_URL = "https://media.example.com/bucket"
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER),
        payload: { url: "https://media.example.com/bucket/hook" },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      delete process.env.R2_PUBLIC_URL
    }
  })

  it("refuses an address of this Nodaro server itself (its app and MCP hosts)", async () => {
    process.env.PUBLIC_URL = "https://app.example.com"
    process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
    try {
      for (const url of ["https://app.example.com/v1/webhooks/0123", "https://MCP.example.com/hook"]) {
        const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url } })
        expect(res.statusCode).toBe(400)
        expect(res.json().error.message).toMatch(/this Nodaro server/)
      }
      expect(queries("webhooks")).toHaveLength(0)
    } finally {
      delete process.env.PUBLIC_URL
      delete process.env.MCP_PUBLIC_URL
    }
  })

  it("stores the address normalized, so two spellings of one address are one address", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : {})
    const res = await app.inject({
      method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER),
      payload: { url: "  https://HOOKS.Example.com:443/in  " },
    })
    expect(res.statusCode).toBe(201)
    expect((argOf(queries("webhooks", "insert")[0], "insert")![0] as Record<string, unknown>).url).toBe("https://hooks.example.com/in")
  })

  it.each([
    ["https://intranet/hook"],
    ["https://db.internal/hook"],
    ["https://printer.local/hook"],
    ["https://router.home.arpa/hook"],
    ["https://app.corp/hook"],
    ["https://svc.railway.internal/hook"],
  ])("refuses a name that only means something inside a private network: %s", async (url) => {
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/public address/)
    expect(queries("webhooks")).toHaveLength(0)
  })

  it.each([
    [{ url: "https://hooks.example.com/in\u001b]8;;https://evil.example.com\u0007" }, /control characters/],
    [{ url: "https://hooks.example.com/in", description: "orders\u001b[2J" }, /control characters/],
    [{ url: "https://hooks.example.com/in", description: "two\nlines" }, /control characters/],
  ])("refuses control characters a terminal would act on: %j", async (payload, message) => {
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(message)
    expect(queries("webhooks")).toHaveLength(0)
  })

  it("answers 409 url_taken when the account already has an endpoint for the address", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { error: { code: "23505", message: "duplicate key value violates unique constraint \"uq_webhooks_address\"" } } : {})
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("url_taken")
  })

  it.each([
    [{ url: "https://hooks.example.com/in", events: [] }],
    [{ url: "https://hooks.example.com/in", events: ["job.started"] }],
    [{ url: "https://hooks.example.com/in", events: ["ping"] }],
    [{ url: "https://hooks.example.com/in", description: "d".repeat(501) }],
    [{}],
  ])("refuses an invalid body %j", async (payload) => {
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("401s without a caller", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(401)
  })

  it("a connected app needs jobs:read, and nothing is created without it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER, "workflows:read assets:write"),
      payload: { url: "https://hooks.example.com/in" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(queries("webhooks")).toHaveLength(0)
  })

  it("an endpoint a connected app registers is stamped with the app", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: { ...ROW, app_id: APP } } : {})
    const res = await app.inject({
      method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER, "jobs:read"),
      payload: { url: "https://hooks.example.com/in" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.appId).toBe(APP)
    expect((argOf(queries("webhooks", "insert")[0], "insert")![0] as Record<string, unknown>).app_id).toBe(APP)
  })

  it(`answers 400 limit_reached past ${MAX_ENDPOINTS_PER_ACCOUNT} endpoints (the database's cap)`, async () => {
    db.respond = (q) => (q.table === "webhooks" ? { error: { code: "53400", message: "an account has at most 10 webhook endpoints" } } : {})
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "limit_reached", message: `You can have at most ${MAX_ENDPOINTS_PER_ACCOUNT} webhook endpoints.` })
  })

  it("the columns the routes read exist, and the plaintext secret column does not", () => {
    expect(WEBHOOK_COLUMNS.has("id") && DELIVERY_COLUMNS.has("webhook_id")).toBe(true) // not vacuous
    expect(WEBHOOK_COLUMNS.has("secret")).toBe(false)
    const named = (cols: string) => cols.split(",").map((c) => c.trim())
    expect(unknownColumns(named(ENDPOINT_COLS), WEBHOOK_COLUMNS)).toEqual([])
    expect(unknownColumns(named(DELIVERY_COLS), DELIVERY_COLUMNS)).toEqual([])
  })

  it("the cap here is the database's (per account, in each environment)", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/521_outbound_webhooks.sql"), "utf8")
    const cap = sql.match(/IS NOT DISTINCT FROM NEW\.runtime_env\)\) >= (\d+)/)
    expect(Number(cap?.[1])).toBe(MAX_ENDPOINTS_PER_ACCOUNT)
  })

  it("503s while the database does not have the feature yet", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { error: { code: "PGRST204", message: "Could not find the 'secret_ciphertext' column" } } : {})
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("503s with the operator's fix when the server has no encryption key", async () => {
    secrets.seal.mockImplementation(() => {
      throw new EncryptionKeyMissingError()
    })
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("encryption_key_missing")
    expect(queries("webhooks")).toHaveLength(0)
  })

  it("a database failure is a sanitized 500", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { error: { code: "XX000", message: "relation public.webhooks broke" } } : {})
    const res = await app.inject({ method: "POST", url: "/v1/webhook-endpoints", headers: as(OWNER), payload: { url: "https://hooks.example.com/in" } })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain("relation public.webhooks")
  })

  it("logs a database failure by its code only — never the row a violation quotes (the address, the sealed secret)", async () => {
    const lines: string[] = []
    const logged = Fastify({ logger: { level: "error", stream: { write: (line: string) => void lines.push(line) } } })
    await logged.register(rateLimit, { global: false })
    logged.addHook("preHandler", async (req) => {
      req.userId = OWNER
    })
    await logged.register(webhookEndpointRoutes)
    await logged.ready()
    try {
      db.respond = (q) =>
        q.table === "webhooks"
          ? { error: { code: "23514", message: "new row violates check constraint", details: "Failing row contains (https://hooks.example.com/private-path, sealed-for-x)" } }
          : {}
      const res = await logged.inject({ method: "POST", url: "/v1/webhook-endpoints", payload: { url: "https://hooks.example.com/private-path" } })
      expect(res.statusCode).toBe(500)
      const out = lines.join("\n")
      expect(out).toContain("23514")
      expect(out).not.toContain("private-path")
      expect(out).not.toContain("sealed-for")
    } finally {
      await logged.close()
    }
  })
})

describe("GET /v1/webhook-endpoints", () => {
  it("lists the caller's own endpoints in this environment, newest first, without secrets", async () => {
    db.respond = () => ({ data: [ROW] })
    const res = await app.inject({ method: "GET", url: "/v1/webhook-endpoints", headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{
      id: EP, url: ROW.url, description: "orders", events: ROW.events, isActive: true, disabledReason: null,
      disabledAt: null, consecutiveFailures: 0, appId: null, secretCreatedAt: ROW.secret_created_at,
      previousSecretExpiresAt: null, createdAt: ROW.created_at, updatedAt: ROW.updated_at,
    }])
    const [list] = queries("webhooks")
    expect(has(list, "eq", "user_id", OWNER)).toBe(true)
    expect(has(list, "or", 'runtime_env.eq."production",runtime_env.is.null')).toBe(true)
    expect(has(list, "order", "created_at", { ascending: false })).toBe(true)
    expect(argOf(list, "eq")).toBeDefined()
    expect(list!.ops.some(([name, args]) => name === "eq" && args[0] === "app_id")).toBe(false)
  })

  it("a connected app sees only the endpoints it registered", async () => {
    db.respond = () => ({ data: [] })
    const res = await app.inject({ method: "GET", url: "/v1/webhook-endpoints", headers: as(OWNER, "jobs:read") })
    expect(res.statusCode).toBe(200)
    expect(has(queries("webhooks")[0], "eq", "app_id", APP)).toBe(true)
  })

  it("a connected app without jobs:read is refused", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/webhook-endpoints", headers: as(OWNER, "workflows:read") })
    expect(res.statusCode).toBe(403)
  })

  it("401s without a caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/webhook-endpoints" })
    expect(res.statusCode).toBe(401)
  })
})

describe("GET /v1/webhook-endpoints/:id", () => {
  it("returns the caller's own endpoint", async () => {
    db.respond = () => ({ data: ROW })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe(EP)
    const [read] = queries("webhooks")
    expect(has(read, "eq", "id", EP)).toBe(true)
    expect(has(read, "eq", "user_id", OWNER)).toBe(true)
    expect(has(read, "or", 'runtime_env.eq."production",runtime_env.is.null')).toBe(true)
  })

  it("404s what is not the caller's", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("400s an id that is not a uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/webhook-endpoints/nope", headers: as(OWNER) })
    expect(res.statusCode).toBe(400)
  })
})

describe("PATCH /v1/webhook-endpoints/:id", () => {
  it("changes the address, events and description of the caller's own endpoint", async () => {
    db.respond = (q) => (q.ops.some(([op]) => op === "update") ? { data: { ...ROW, url: "https://hooks.example.com/v2" } } : { data: ROW })
    const res = await app.inject({
      method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER),
      payload: { url: "https://hooks.example.com/v2", events: ["job.failed"], description: null },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.url).toBe("https://hooks.example.com/v2")
    const [update] = queries("webhooks", "update")
    expect(argOf(update, "update")![0]).toMatchObject({ url: "https://hooks.example.com/v2", events: ["job.failed"], description: null })
    expect(has(update, "eq", "id", EP)).toBe(true)
    expect(has(update, "eq", "user_id", OWNER)).toBe(true)
  })

  it("switching on clears what switched it off and the failure streak", async () => {
    const off = { ...ROW, is_active: false, disabled_reason: "consecutive_failures", disabled_at: "2026-10-16T00:00:00+00:00", consecutive_failures: 50 }
    db.respond = (q) => (q.ops.some(([op]) => op === "update") ? { data: { ...ROW } } : { data: off })
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: true } })
    expect(res.statusCode).toBe(200)
    const patch = argOf(queries("webhooks", "update")[0], "update")![0] as Record<string, unknown>
    expect(patch).toMatchObject({ is_active: true, disabled_reason: null, disabled_at: null, consecutive_failures: 0 })
    expect(unknownColumns(Object.keys(patch), WEBHOOK_COLUMNS)).toEqual([])
  })

  it("switching off is the owner's choice: no platform reason", async () => {
    db.respond = (q) => (q.ops.some(([op]) => op === "update") ? { data: { ...ROW, is_active: false } } : { data: ROW })
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: false } })
    expect(res.statusCode).toBe(200)
    expect(argOf(queries("webhooks", "update")[0], "update")![0]).toMatchObject({ is_active: false, disabled_reason: null, disabled_at: null })
  })

  it("an endpoint with no secret (older than its signing) cannot be switched on: 409", async () => {
    db.respond = () => ({ data: { ...ROW, is_active: false, secret_created_at: null, runtime_env: null, disabled_reason: "legacy_secret" } })
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("secret_required")
    expect(queries("webhooks", "update")).toHaveLength(0)
  })

  it("an address stored before today's rules is checked again before the endpoint is switched on: 409 url_invalid", async () => {
    db.respond = () => ({ data: { ...ROW, url: "http://legacy.example.com/hook", is_active: false } })
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "url_invalid" })
    expect(res.json().error.message).toMatch(/https/)
    expect(queries("webhooks", "update")).toHaveLength(0)
  })

  it("switching on stores an old spelling of the address normalized", async () => {
    db.respond = (q) =>
      q.ops.some(([op]) => op === "update") ? { data: ROW } : { data: { ...ROW, url: "https://Hooks.Example.com:443/in", is_active: false } }
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: true } })
    expect(res.statusCode).toBe(200)
    expect(argOf(queries("webhooks", "update")[0], "update")![0]).toMatchObject({ url: "https://hooks.example.com/in", is_active: true })
  })

  it("answers 409 url_taken when the new address is already one of the account's", async () => {
    db.respond = (q) =>
      q.ops.some(([op]) => op === "update") ? { error: { code: "23505", message: "duplicate key value" } } : { data: ROW }
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { url: "https://hooks.example.com/other" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("url_taken")
  })

  it("404s what is not the caller's, and changes nothing", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { isActive: false } })
    expect(res.statusCode).toBe(404)
    expect(queries("webhooks", "update")).toHaveLength(0)
  })

  it("400s an empty change and an invalid address", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: {} })).statusCode).toBe(400)
    expect((await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER), payload: { url: "http://x.example.com" } })).statusCode).toBe(400)
  })

  it("a connected app reaches only its own endpoints", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER, "jobs:read"), payload: { isActive: false } })
    expect(res.statusCode).toBe(404)
    expect(has(queries("webhooks")[0], "eq", "app_id", APP)).toBe(true)
  })
})

describe("DELETE /v1/webhook-endpoints/:id", () => {
  it("deletes the caller's own endpoint", async () => {
    db.respond = (q) => (q.ops.some(([op]) => op === "delete") ? { data: [{ id: EP }] } : { data: ROW })
    const res = await app.inject({ method: "DELETE", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    const [del] = queries("webhooks", "delete")
    expect(has(del, "eq", "id", EP)).toBe(true)
    expect(has(del, "eq", "user_id", OWNER)).toBe(true)
  })

  it("404s what is not the caller's", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
    expect(queries("webhooks", "delete")).toHaveLength(0)
  })
})

describe("POST /v1/webhook-endpoints/:id/rotate-secret", () => {
  it("seals a new secret for the row, swaps it in the database (keeping the old one a day), and returns it, once", async () => {
    db.respond = () => ({ data: ROW })
    db.rpcRespond = (_fn, args) => ({ data: args.p_previous_expires_at })
    const before = Date.now()
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(secrets.seal).toHaveBeenCalledWith(secrets.next, { endpointId: EP, userId: OWNER, runtimeEnv: "production" })
    expect(db.rpcs).toHaveLength(1)
    const { fn, args } = db.rpcs[0]!
    expect(fn).toBe("rotate_webhook_secret")
    expect(args).toMatchObject({
      p_webhook_id: EP,
      p_user_id: OWNER,
      p_runtime_env: "production",
      p_secret_ciphertext: `sealed-for-${EP}`,
    })
    const keptUntil = Date.parse(String(args.p_previous_expires_at))
    expect(keptUntil - before).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 5000)
    expect(keptUntil - before).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000)
    expect(res.json()).toEqual({ secret: secrets.next, previousSecretExpiresAt: args.p_previous_expires_at })
    // Never a direct write of a ciphertext, and no read of one.
    expect(queries("webhooks", "update")).toHaveLength(0)
    expect(String(argOf(queries("webhooks")[0], "select")![0])).not.toContain("secret_ciphertext")
  })

  it("gracePeriodSeconds: 0 ends the old secret at once", async () => {
    db.respond = () => ({ data: ROW })
    db.rpcRespond = () => ({ data: null })
    const res = await app.inject({
      method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER), payload: { gracePeriodSeconds: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(db.rpcs[0]!.args.p_previous_expires_at).toBeNull()
    expect(res.json()).toEqual({ secret: secrets.next, previousSecretExpiresAt: null })
  })

  it.each([[{ gracePeriodSeconds: -1 }], [{ gracePeriodSeconds: 7 * 24 * 3600 + 1 }], [{ gracePeriodSeconds: 1.5 }], [{ grace: 10 }]])(
    "refuses a grace it cannot honour: %j",
    async (payload) => {
      db.respond = () => ({ data: ROW })
      const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER), payload })
      expect(res.statusCode).toBe(400)
      expect(db.rpcs).toHaveLength(0)
      expect(secrets.seal).not.toHaveBeenCalled()
    },
  )

  it("gives an endpoint older than signing its first secret, here (the database clears why it was paused)", async () => {
    db.respond = () => ({
      data: { ...ROW, is_active: false, runtime_env: null, secret_created_at: null, disabled_reason: "legacy_secret", disabled_at: "2026-10-15T00:00:00+00:00" },
    })
    db.rpcRespond = () => ({ data: null })
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(db.rpcs[0]!.args).toMatchObject({ p_runtime_env: "production", p_secret_ciphertext: `sealed-for-${EP}` })
    expect(res.json().previousSecretExpiresAt).toBeNull()
  })

  it("404s what is not the caller's", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
    expect(secrets.seal).not.toHaveBeenCalled()
  })

  it("answers 409 url_taken when an endpoint older than signing takes this environment, where its address is already used", async () => {
    db.respond = () => ({ data: { ...ROW, is_active: false, runtime_env: null, secret_created_at: null, disabled_reason: "legacy_secret" } })
    db.rpcRespond = () => ({ error: { code: "23505", message: "duplicate key value" } })
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/rotate-secret`, headers: as(OWNER) })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("url_taken")
    expect(res.body).not.toContain(secrets.next)
  })
})

describe("GET /v1/webhook-endpoints/:id/deliveries/:deliveryId", () => {
  it("returns one delivery of the caller's own endpoint, by its id", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : { data: DELIVERY_ROW })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries/${DELIVERY}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ id: DELIVERY, webhookId: EP, status: "failed", error: "http_500" })
    const [read] = queries("webhook_deliveries")
    expect(has(read, "eq", "id", DELIVERY)).toBe(true)
    expect(has(read, "eq", "webhook_id", EP)).toBe(true)
    expect(has(read, "eq", "user_id", OWNER)).toBe(true)
  })

  it("404s a delivery that is not this endpoint's", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : { data: null })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries/${DELIVERY}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
  })

  it("404s an endpoint that is not the caller's, and reads no delivery", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries/${DELIVERY}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
    expect(queries("webhook_deliveries")).toHaveLength(0)
  })

  it("400s a delivery id that is not a uuid", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries/not-a-uuid`, headers: as(OWNER) })
    expect(res.statusCode).toBe(400)
    expect(queries("webhooks")).toHaveLength(0)
  })
})

describe("what an endpoint says about a rotation's grace", () => {
  it("names until when the replaced secret still signs, and nothing once that has passed", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    db.respond = () => ({ data: { ...ROW, previous_secret_expires_at: future } })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(res.json().data.previousSecretExpiresAt).toBe(future)

    db.respond = () => ({ data: { ...ROW, previous_secret_expires_at: "2026-01-01T00:00:00Z" } })
    const later = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}`, headers: as(OWNER) })
    expect(later.json().data.previousSecretExpiresAt).toBeNull()
  })
})

describe("events and the jobs list", () => {
  // The capture (migration 521, webhooks_record_job_event) skips exactly the
  // jobs GET /v1/jobs hides; the rule is written twice, once in SQL and once
  // here, so this holds the two together.
  it("the capture hides the same inner runs the jobs list hides", () => {
    const jobsRoute = readFileSync(join(__dirname, "..", "jobs.ts"), "utf8")
    const migration = readFileSync(join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "521_outbound_webhooks.sql"), "utf8")
    expect(jobsRoute).toContain(`return execution?.is_component_execution !== true && execution?.trigger_type !== "use_case"`)
    expect(migration).toContain(`AND (e.is_component_execution IS TRUE OR e.trigger_type = 'use_case')`)
  })
})

describe("GET /v1/webhook-endpoints/:id/deliveries", () => {
  it("pages the endpoint's delivery log, newest first", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : { data: [DELIVERY_ROW] })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries?limit=1&status=failed`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([{
      id: DELIVERY, webhookId: EP, event: "job.completed", jobId: DELIVERY_ROW.job_id, status: "failed", attempts: 8,
      responseStatus: 500, responseBody: "oops", durationMs: 120, error: "http_500",
      requestBody: '{"id":"x","type":"job.completed"}', createdAt: DELIVERY_ROW.created_at,
      lastAttemptAt: DELIVERY_ROW.last_attempt_at, nextAttemptAt: null, deliveredAt: null,
    }])
    expect(body.next).toBe(encodeCursor({ at: DELIVERY_ROW.created_at, id: DELIVERY }))

    const [log] = queries("webhook_deliveries")
    expect(has(log, "eq", "webhook_id", EP)).toBe(true)
    expect(has(log, "eq", "user_id", OWNER)).toBe(true)
    expect(has(log, "eq", "status", "failed")).toBe(true)
    expect(has(log, "order", "created_at", { ascending: false })).toBe(true)
    expect(has(log, "order", "id", { ascending: false })).toBe(true)
    expect(has(log, "limit", 1)).toBe(true)
  })

  it("continues after a cursor it issued, and refuses one it did not", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : { data: [] })
    const cursor = encodeCursor({ at: DELIVERY_ROW.created_at, id: DELIVERY })
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries?cursor=${cursor}`, headers: as(OWNER) })
    expect(res.statusCode).toBe(200)
    expect(res.json().next).toBeNull()
    expect(has(queries("webhook_deliveries")[0], "or",
      `created_at.lt."${DELIVERY_ROW.created_at}",and(created_at.eq."${DELIVERY_ROW.created_at}",id.lt."${DELIVERY}")`)).toBe(true)

    const bad = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries?cursor=forged`, headers: as(OWNER) })
    expect(bad.statusCode).toBe(400)
  })

  it("a pending delivery says when it is due; a delivered one keeps no body", async () => {
    db.respond = (q) =>
      q.table === "webhooks"
        ? { data: ROW }
        : { data: [
            { ...DELIVERY_ROW, status: "pending", next_retry_at: "2026-10-15T10:01:00+00:00", payload: null },
            { ...DELIVERY_ROW, id: "00000000-0000-4000-8000-0000000000d2", status: "delivered", next_retry_at: null, payload: null, delivered_at: "2026-10-15T10:00:01+00:00" },
          ] }
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries`, headers: as(OWNER) })
    const [pending, delivered] = res.json().data
    expect(pending).toMatchObject({ status: "pending", nextAttemptAt: "2026-10-15T10:01:00+00:00", requestBody: null })
    expect(delivered).toMatchObject({ status: "delivered", nextAttemptAt: null, requestBody: null })
  })

  it("404s an endpoint that is not the caller's, and reads no deliveries", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/webhook-endpoints/${EP}/deliveries`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
    expect(queries("webhook_deliveries")).toHaveLength(0)
  })
})

describe("POST /v1/webhook-endpoints/:id/test", () => {
  it("queues a ping for the endpoint", async () => {
    db.respond = (q) =>
      q.table === "webhooks"
        ? { data: ROW }
        : { data: { ...DELIVERY_ROW, event: "ping", job_id: null, status: "pending", attempts: 0, payload: null, next_retry_at: "2026-10-15T10:00:00+00:00", response_status: null, response_body: null, duration_ms: null, last_error: null } }
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/test`, headers: as(OWNER) })
    expect(res.statusCode).toBe(202)
    expect(res.json().data).toMatchObject({ event: "ping", status: "pending", jobId: null })
    const [insert] = queries("webhook_deliveries", "insert")
    const row = argOf(insert, "insert")![0] as Record<string, unknown>
    expect(row).toMatchObject({ webhook_id: EP, user_id: OWNER, event: "ping", status: "pending" })
    expect(typeof row.next_retry_at).toBe("string")
    expect(unknownColumns(Object.keys(row), DELIVERY_COLUMNS)).toEqual([])
  })

  it("an endpoint with no secret cannot be tested: 409", async () => {
    db.respond = () => ({ data: { ...ROW, secret_created_at: null } })
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/test`, headers: as(OWNER) })
    expect(res.statusCode).toBe(409)
    expect(queries("webhook_deliveries")).toHaveLength(0)
  })

  it("an endpoint whose stored address is no longer accepted cannot be tested: 409 url_invalid", async () => {
    db.respond = () => ({ data: { ...ROW, url: "https://10.0.0.5/hook" } })
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/test`, headers: as(OWNER) })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("url_invalid")
    expect(queries("webhook_deliveries")).toHaveLength(0)
  })

  it("404s what is not the caller's", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/test`, headers: as(OWNER) })
    expect(res.statusCode).toBe(404)
  })

  it("is rate-limited to 10 a minute", async () => {
    db.respond = (q) => (q.table === "webhooks" ? { data: ROW } : { data: { ...DELIVERY_ROW, event: "ping", status: "pending" } })
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      codes.push((await app.inject({ method: "POST", url: `/v1/webhook-endpoints/${EP}/test`, headers: as(OWNER) })).statusCode)
    }
    expect(codes.slice(0, 10).every((c) => c === 202)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})
