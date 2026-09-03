/**
 * The send path's contract, in the order the route enforces it.
 *
 * The assertions that matter most are the ones about ORDER and about what
 * exists after a failure: the row is written BEFORE the provider call, a
 * refused send still leaves a row, and a delivered email is never reported as a
 * failure just because our own bookkeeping update failed. Those are the reasons
 * the table is the record of truth rather than Loops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"

const ADMIN = "00000000-0000-4000-8000-000000000002"
const OTHER = "00000000-0000-4000-8000-000000000001"
const TARGET = "00000000-0000-4000-8000-000000000009"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const mockSendTransactional = vi.fn()
const mockIsLoopsConfigured = vi.fn(() => true)
const mockR2KeyFromOurUrl = vi.fn((url: string) =>
  url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null,
)
const mockGetR2ObjectSize = vi.fn(async (_key: string) => 1024)
const mockDailyLimit = vi.fn(async () => 50)

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
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
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (c: number) => { send: (b: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))
vi.mock("@/ee/lib/loops-client.js", () => ({
  isLoopsConfigured: () => mockIsLoopsConfigured(),
  sendTransactional: (...a: unknown[]) => mockSendTransactional(...a),
}))
vi.mock("@/lib/storage.js", () => ({
  r2KeyFromOurUrl: (u: string) => mockR2KeyFromOurUrl(u),
  getR2ObjectSize: (k: string) => mockGetR2ObjectSize(k),
}))
vi.mock("@/ee/lib/admin-message-config.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, getAdminMessagesDailyLimit: () => mockDailyLimit() }
})

import { adminMessagesRoutes } from "../admin-messages.js"

// ---------------------------------------------------------------------------
// Supabase chain mock — a per-table queue, plus a transcript so ORDER is
// assertable (the whole point of writing the row before the send).
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown; count?: number | null }
const queues = new Map<string, Result[]>()
const transcript: string[] = []

function queueTable(table: string, ...results: Result[]) {
  queues.set(table, [...(queues.get(table) ?? []), ...results])
}

type ChainCall = { table: string; method: string; args: unknown[]; order: number }
const chainCalls: ChainCall[] = []

/** A monotonic counter shared with vitest's own `invocationCallOrder`, so a
 *  builder call and a mocked function call can be ordered against each other. */
function nextOrder(): number {
  return (mockOrderProbe(), mockOrderProbe.mock.invocationCallOrder.at(-1) as number)
}
const mockOrderProbe = vi.fn()

function chainFor(table: string, result: Result) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      chainCalls.push({ table, method, args, order: nextOrder() })
      if (method === "insert" || method === "update") transcript.push(`${table}.${method}`)
      return chain
    })
  for (const m of ["select", "eq", "neq", "gte", "in", "order", "limit", "range", "insert", "update"]) {
    chain[m] = record(m)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.single = vi.fn(async () => result)
  chain.then = (resolve: (v: unknown) => void) => resolve(result)
  return chain
}

function argsFor(table: string, method: string): unknown[][] {
  return chainCalls.filter((c) => c.table === table && c.method === method).map((c) => c.args)
}

/** The payload the route handed `.insert()` on admin_messages. */
function insertedRow(): Record<string, unknown> {
  return (argsFor("admin_messages", "insert")[0]?.[0] ?? {}) as Record<string, unknown>
}

/** The payload the route handed `.update()` on admin_messages. */
function updatedRow(): Record<string, unknown> {
  return (argsFor("admin_messages", "update")[0]?.[0] ?? {}) as Record<string, unknown>
}

function orderOf(table: string, method: string): number {
  const call = chainCalls.find((c) => c.table === table && c.method === method)
  if (!call) throw new Error(`${table}.${method} was never called`)
  return call.order
}
const insertInvocationOrder = () => orderOf("admin_messages", "insert")
const updateInvocationOrder = () => orderOf("admin_messages", "update")

const PROFILE = {
  data: { id: TARGET, email: "user@test.com", full_name: "Ada Lovelace" },
  error: null,
}
const ADMIN_PROFILE = { data: { email: "admin@test.com" }, error: null }
const COUNT_OK = { data: null, error: null, count: 0 }
const ROW = {
  data: {
    id: "row-1",
    user_id: TARGET,
    recipient_email: "user@test.com",
    sent_by_admin_id: ADMIN,
    sent_by_admin_email: "admin@test.com",
    template_id: "issue_detected",
    variables: {},
    rendered_subject: "s",
    rendered_body: "b",
    image_url: null,
    loops_message_id: null,
    status: "sending",
    error_message: null,
    sent_at: "2026-09-03T00:00:00Z",
  },
  error: null,
}

/** The happy-path fixture order: profile, count, admin profile, insert, update. */
function queueHappyPath() {
  queueTable("profiles", PROFILE, ADMIN_PROFILE)
  queueTable("admin_messages", COUNT_OK, ROW, ROW)
}

const ISSUE_BODY = {
  templateId: "issue_detected",
  variables: { whatHappened: "It broke.", whatWeDid: "We fixed it.", nextStep: "Try again." },
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  queues.clear()
  chainCalls.length = 0
  transcript.length = 0
  mockIsLoopsConfigured.mockReturnValue(true)
  mockGetR2ObjectSize.mockResolvedValue(1024)
  mockDailyLimit.mockResolvedValue(50)
  mockSendTransactional.mockResolvedValue({ ok: true, status: 200, messageId: "loops-1" })
  mockFrom.mockImplementation((t: string) =>
    chainFor(
      t,
      // A missing fixture must FAIL the test, not sail past: `[]` is truthy,
      // so the old default slipped through `if (insertErr || !inserted)` and
      // let a test assert against a half-executed route.
      queues.get(t)?.shift() ?? { data: null, error: { message: `unqueued read of ${t}` }, count: 0 },
    ),
  )

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(async (instance) => {
    await adminMessagesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function send(body: unknown, userId = ADMIN) {
  return app.inject({
    method: "POST",
    url: `/v1/admin/users/${TARGET}/messages`,
    headers: { "x-user-id": userId },
    payload: body as Record<string, unknown>,
  })
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("access", () => {
  it("refuses a non-admin on every route, before touching the database", async () => {
    for (const [method, url] of [
      ["GET", `/v1/admin/users/${TARGET}/messages`],
      ["POST", `/v1/admin/users/${TARGET}/messages/preview`],
      ["POST", `/v1/admin/users/${TARGET}/messages`],
      ["GET", "/v1/admin/message-templates"],
    ] as const) {
      const res = await app.inject({ method, url, headers: { "x-user-id": OTHER }, payload: {} })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/message-templates
// ---------------------------------------------------------------------------

describe("GET /v1/admin/message-templates", () => {
  it("tells the UI whether email can work at all on this deployment", async () => {
    mockIsLoopsConfigured.mockReturnValue(false)
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/message-templates",
      headers: { "x-user-id": ADMIN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.loopsConfigured).toBe(false)
    expect(res.json().data.templates).toHaveLength(3)
  })

  it("never leaks the Loops transactional ids to the browser", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/message-templates",
      headers: { "x-user-id": ADMIN },
    })
    expect(res.body).not.toContain("cmtl3")
  })
})

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users/:id/messages", () => {
  it("reads every admin's messages for the user, newest first", async () => {
    queueTable("admin_messages", { data: [ROW.data], error: null, count: 1 })
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${TARGET}/messages`,
      headers: { "x-user-id": ADMIN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(1)
    // Scoped to the USER, never to the calling admin — the log is shared.
    const eqs = argsFor("admin_messages", "eq").map((a) => a[0])
    expect(eqs).toContain("user_id")
    expect(eqs).not.toContain("sent_by_admin_id")
    expect(argsFor("admin_messages", "order")[0]).toEqual(["sent_at", { ascending: false }])
  })

  it("serves an empty flagged history before the migration lands, not a 500", async () => {
    queueTable("admin_messages", {
      data: null,
      error: { code: "42P01", message: 'relation "admin_messages" does not exist' },
    })
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${TARGET}/messages`,
      headers: { "x-user-id": ADMIN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ data: [], total: 0, unavailable: true })
  })
})

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe("POST .../messages/preview", () => {
  it("renders without sending anything or writing a row", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${TARGET}/messages/preview`,
      headers: { "x-user-id": ADMIN },
      payload: ISSUE_BODY,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.bodyHtml).toContain("It broke.")
    expect(mockSendTransactional).not.toHaveBeenCalled()
    expect(argsFor("admin_messages", "insert")).toHaveLength(0)
  })

  it("rejects exactly what the send would reject", async () => {
    const bad = { templateId: "issue_detected", variables: { whatHappened: "x" } }
    const preview = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${TARGET}/messages/preview`,
      headers: { "x-user-id": ADMIN },
      payload: bad,
    })
    queueHappyPath()
    const sent = await send(bad)
    expect(preview.statusCode).toBe(400)
    expect(sent.statusCode).toBe(400)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

describe("POST .../messages", () => {
  it("writes the row BEFORE calling Loops, then records the outcome", async () => {
    queueHappyPath()
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(200)

    // The order this test exists for: the row is durable BEFORE the provider
    // call, so a process that dies mid-send leaves evidence. Compared against
    // the insert's own invocation order, not merely the first query's.
    expect(transcript).toEqual(["admin_messages.insert", "admin_messages.update"])
    const insertOrder = insertInvocationOrder()
    const updateOrder = updateInvocationOrder()
    const sendOrder = mockSendTransactional.mock.invocationCallOrder[0]
    expect(sendOrder).toBeGreaterThan(insertOrder)
    expect(updateOrder).toBeGreaterThan(sendOrder)

    expect(insertedRow()).toMatchObject({
      user_id: TARGET,
      recipient_email: "user@test.com",
      sent_by_admin_id: ADMIN,
      sent_by_admin_email: "admin@test.com",
      template_id: "issue_detected",
      status: "sending",
    })
    expect(updatedRow()).toMatchObject({ status: "sent", loops_message_id: "loops-1" })
  })

  it("sends the compiled transactional id and the camelCase variables", async () => {
    queueHappyPath()
    await send(ISSUE_BODY)
    const [transactionalId, email, vars] = mockSendTransactional.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
    ]
    expect(transactionalId).toBe("cmtl3elqj0b9k0i0bjfd4vtxp")
    expect(email).toBe("user@test.com")
    expect(Object.keys(vars).sort()).toEqual([
      "firstName",
      "nextStep",
      "whatHappened",
      "whatWeDid",
    ])
    // Proof the recipient reaches the renderer. Every Loops template opens with
    // this variable and refuses the send without it, and the only place the
    // name exists is the profile row this route reads.
    expect(vars.firstName).toBe("Ada")
  })

  it("stores the rendered subject and body — the record of what they saw", async () => {
    queueHappyPath()
    await send(ISSUE_BODY)
    const row = insertedRow()
    expect(String(row.rendered_subject).length).toBeGreaterThan(0)
    expect(String(row.rendered_body)).toContain("It broke.")
  })

  it("logs a FAILED row and answers 502 when Loops refuses", async () => {
    queueHappyPath()
    mockSendTransactional.mockResolvedValue({ ok: false, status: 422, error: "bad template" })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("send_failed")
    // The row still exists, and says what happened.
    expect(transcript).toEqual(["admin_messages.insert", "admin_messages.update"])
    expect(updatedRow()).toMatchObject({ status: "failed", error_message: "bad template" })
  })

  it("truncates a huge provider error instead of storing it whole", async () => {
    queueHappyPath()
    mockSendTransactional.mockResolvedValue({ ok: false, error: "x".repeat(5000) })
    await send(ISSUE_BODY)
    expect(String(updatedRow().error_message).length).toBe(500)
  })

  it("still reports success when the bookkeeping UPDATE fails — the email went", async () => {
    queueTable("profiles", PROFILE, ADMIN_PROFILE)
    queueTable("admin_messages", COUNT_OK, ROW, { data: null, error: { message: "update blew up" } })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("sent")
  })

  it("refuses before writing a row when Loops is not configured", async () => {
    mockIsLoopsConfigured.mockReturnValue(false)
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("email_not_configured")
    expect(argsFor("admin_messages", "insert")).toHaveLength(0)
  })

  it("404s a user with no email rather than sending nowhere", async () => {
    queueTable("profiles", { data: { id: TARGET, email: null }, error: null })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(404)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  // -- rate limit ----------------------------------------------------------

  it("counts this admin's non-failed sends since 00:00 UTC", async () => {
    queueHappyPath()
    await send(ISSUE_BODY)
    const eqs = argsFor("admin_messages", "eq")
    expect(eqs.some(([c, v]) => c === "sent_by_admin_id" && v === ADMIN)).toBe(true)
    expect(argsFor("admin_messages", "neq")[0]).toEqual(["status", "failed"])
    const gte = argsFor("admin_messages", "gte")[0] as [string, string]
    expect(gte[0]).toBe("sent_at")
    expect(gte[1]).toMatch(/T00:00:00\.000Z$/)
  })

  it("refuses with 429 at the limit, without writing a row or sending", async () => {
    mockDailyLimit.mockResolvedValue(3)
    queueTable("profiles", PROFILE)
    queueTable("admin_messages", { data: null, error: null, count: 3 })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("daily_limit_reached")
    expect(argsFor("admin_messages", "insert")).toHaveLength(0)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  it("a limit of 0 stops everyone — the off switch is reachable", async () => {
    mockDailyLimit.mockResolvedValue(0)
    queueTable("profiles", PROFILE)
    queueTable("admin_messages", COUNT_OK)
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(429)
  })

  // -- screenshot ----------------------------------------------------------

  const withImage = (imageUrl: string, imageLabel = "See the screenshot") => ({
    templateId: "general_followup",
    variables: { subjectLine: "Hi", bodyText: "Look at this.", imageUrl, imageLabel },
  })

  it("accepts a screenshot that is ours, under uploads/, and within the cap", async () => {
    queueHappyPath()
    const res = await send(withImage("https://cdn.test/uploads/abc.png"))
    expect(res.statusCode).toBe(200)
    expect(insertedRow().image_url).toBe("https://cdn.test/uploads/abc.png")
  })

  it("refuses a third-party image URL — our From domain must not carry it", async () => {
    queueTable("profiles", PROFILE)
    const res = await send(withImage("https://evil.test/tracker.png"))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("uploaded here")
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  it("refuses an object of ours from outside the upload prefix", async () => {
    queueTable("profiles", PROFILE)
    const res = await send(withImage("https://cdn.test/videos/someone-elses.png"))
    expect(res.statusCode).toBe(400)
  })

  it("refuses a non-image extension", async () => {
    queueTable("profiles", PROFILE)
    const res = await send(withImage("https://cdn.test/uploads/payload.svg"))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("Unsupported image type")
  })

  it("refuses an object that is no longer in storage", async () => {
    queueTable("profiles", PROFILE)
    mockGetR2ObjectSize.mockResolvedValue(0)
    const res = await send(withImage("https://cdn.test/uploads/gone.png"))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("no longer in storage")
  })

  it("refuses an object over the 5 MB cap", async () => {
    queueTable("profiles", PROFILE)
    mockGetR2ObjectSize.mockResolvedValue(6 * 1024 * 1024)
    const res = await send(withImage("https://cdn.test/uploads/huge.png"))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("too large")
  })

  it("refuses a screenshot on a template whose Loops design cannot show one", async () => {
    // The fixtures are the HAPPY path, so a 400 here can only come from the
    // image guard — not from an empty queue. (The cases above queue only the
    // recipient: the guard runs after that lookup and before the send-limit
    // read, so a 400 there is the guard and a 500 would be the queue.)
    queueHappyPath()
    const res = await send({
      templateId: "issue_detected",
      variables: { ...ISSUE_BODY.variables, imageUrl: "https://cdn.test/uploads/a.png" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("cannot carry a screenshot")
    // Refused, not silently sent without the screenshot the admin attached.
    expect(mockSendTransactional).not.toHaveBeenCalled()
    expect(argsFor("admin_messages", "insert")).toHaveLength(0)
  })

  // -- validation ----------------------------------------------------------

  it("rejects an unknown template id", async () => {
    const res = await send({ templateId: "made_up", variables: {} })
    expect(res.statusCode).toBe(400)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  it("rejects a malformed user id before any query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/users/not-a-uuid/messages",
      headers: { "x-user-id": ADMIN },
      payload: ISSUE_BODY,
    })
    expect(res.statusCode).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("tells the operator the migration is pending rather than 500ing", async () => {
    queueTable("profiles", PROFILE)
    queueTable("admin_messages", {
      data: null,
      error: { code: "42P01", message: 'relation "admin_messages" does not exist' },
      count: null,
    })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_migrated")
  })
})

// ---------------------------------------------------------------------------
// Router coexistence
// ---------------------------------------------------------------------------

describe("route registration", () => {
  it("still dispatches correctly with the sibling /v1/admin/users/:id routes present", async () => {
    // These routes live under the same parametric segment as
    // /v1/admin/users/:id/{storage,role,transactions,credits,tier}. This router
    // version tolerates a differently-named parameter in that position, so the
    // rename to `:id` is a consistency choice rather than a fix — what actually
    // needs proving is that adding these routes does not shadow a sibling or
    // get shadowed by one.
    const probe = Fastify({ logger: false })
    probe.addHook("preHandler", async (req) => {
      req.userId = ADMIN
    })
    probe.put("/v1/admin/users/:id/storage", async () => ({ who: "storage" }))
    probe.get("/v1/admin/users/:id/transactions", async () => ({ who: "transactions" }))
    await probe.register(async (i) => {
      await adminMessagesRoutes(i)
    })
    await probe.ready()

    queueTable("admin_messages", { data: [], error: null, count: 0 })
    const mine = await probe.inject({ method: "GET", url: `/v1/admin/users/${TARGET}/messages` })
    const sibling = await probe.inject({ method: "GET", url: `/v1/admin/users/${TARGET}/transactions` })

    expect(mine.statusCode).toBe(200)
    expect(mine.json()).toHaveProperty("total")
    expect(sibling.json()).toEqual({ who: "transactions" })
    await probe.close()
  })

  it("names the path parameter `id`, like every sibling under /v1/admin/users", () => {
    const src = readFileSync(new URL("../admin-messages.ts", import.meta.url), "utf8")
    expect(src).not.toContain("/v1/admin/users/:userId")
    expect(src).toContain("/v1/admin/users/:id/messages")
  })
})

// ---------------------------------------------------------------------------
// In-app only
// ---------------------------------------------------------------------------

describe("the send is in-app only", () => {
  it.each(["app_token", "api_token", "internal"] as const)(
    "refuses a %s caller even though it is an admin's identity",
    async (kind) => {
      // `requireAdmin` asks WHO the caller is, never HOW they authenticated. An
      // OAuth app the admin authorized for some unrelated scope would otherwise
      // be able to mail any user from our verified domain, invisibly.
      queueHappyPath()
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/users/${TARGET}/messages`,
        headers: { "x-user-id": ADMIN, "x-auth-kind": kind },
        payload: ISSUE_BODY,
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
      expect(mockSendTransactional).not.toHaveBeenCalled()
      expect(argsFor("admin_messages", "insert")).toHaveLength(0)
    },
  )
})

// ---------------------------------------------------------------------------
// An outcome we never learned
// ---------------------------------------------------------------------------

describe("when the provider never answers", () => {
  it.each(["timeout", "network"] as const)(
    "leaves the row 'sending' on a %s and does not call it failed",
    async (failureKind) => {
      // Loops may have accepted the message and simply been slow. Calling that
      // 'failed' tells the admin it was refused, hands back the daily-budget
      // slot (failed rows do not count), and invites a second email to someone
      // who already got the first.
      queueHappyPath()
      mockSendTransactional.mockResolvedValue({ ok: false, error: "aborted", failureKind })
      const res = await send(ISSUE_BODY)

      expect(res.statusCode).toBe(504)
      expect(res.json().error.code).toBe("send_unconfirmed")
      // The row is updated with the reason but its status is untouched.
      expect(updatedRow()).not.toHaveProperty("status")
      expect(updatedRow().error_message).toBe("aborted")
    },
  )

  it("tells the admin not to just send it again", async () => {
    queueHappyPath()
    mockSendTransactional.mockResolvedValue({ ok: false, error: "aborted", failureKind: "timeout" })
    const res = await send(ISSUE_BODY)
    expect(res.json().error.message).toMatch(/do not know whether this was delivered/i)
    expect(res.json().error.message).toMatch(/before sending it again/i)
  })

  it("still marks a PROVIDER rejection as failed — that one really did not go", async () => {
    queueHappyPath()
    mockSendTransactional.mockResolvedValue({
      ok: false,
      status: 422,
      error: "unknown transactionalId",
      failureKind: "provider",
    })
    const res = await send(ISSUE_BODY)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("send_failed")
    expect(updatedRow()).toMatchObject({ status: "failed" })
  })
})

// ---------------------------------------------------------------------------
// Preview / send equivalence — the claim the file header makes
// ---------------------------------------------------------------------------

describe("preview and send answer identically", () => {
  const CASES: ReadonlyArray<{ name: string; body: Record<string, unknown> }> = [
    { name: "a missing required field", body: { templateId: "issue_detected", variables: { whatHappened: "x" } } },
    {
      name: "a screenshot on a template that cannot show one",
      body: {
        templateId: "issue_detected",
        variables: { ...ISSUE_BODY.variables, imageUrl: "https://cdn.test/uploads/a.png" },
      },
    },
    {
      name: "half a call to action",
      body: { templateId: "general_followup", variables: { subjectLine: "s", bodyText: "b", ctaLabel: "Go" } },
    },
    {
      name: "link text with no screenshot",
      body: {
        templateId: "general_followup",
        variables: { subjectLine: "s", bodyText: "b", imageLabel: "See it" },
      },
    },
    {
      name: "a javascript: call-to-action",
      body: {
        templateId: "general_followup",
        variables: { subjectLine: "s", bodyText: "b", ctaLabel: "Go", ctaUrl: "javascript:alert(1)" },
      },
    },
    // Really unknown — a `templateId` the route's own z.enum rejects. The
    // entry here used to say "an unknown template" while passing
    // `issue_detected` with empty vars, which is a duplicate of the first case
    // and left the enum path untested under a name claiming it was covered.
    { name: "a template id the enum does not know", body: { templateId: "made_up", variables: {} } },
    { name: "no variables at all", body: { templateId: "issue_detected", variables: {} } },
  ]

  it.each(CASES)("both reject $name", async ({ body }) => {
    // The header claims "input the send would reject can never render clean
    // here". It used to be false for the screenshot case: the preview called
    // parseAdminMessage directly, whose schema silently STRIPPED the unknown
    // imageUrl, so preview answered 200 and send answered 400 for one input.
    const preview = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${TARGET}/messages/preview`,
      headers: { "x-user-id": ADMIN },
      payload: body,
    })
    queueHappyPath()
    const sent = await send(body)

    expect(preview.statusCode, "preview").toBe(400)
    expect(sent.statusCode, "send").toBe(400)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  it("both ACCEPT the same valid input, so the equivalence is not vacuous", async () => {
    const preview = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${TARGET}/messages/preview`,
      headers: { "x-user-id": ADMIN },
      payload: ISSUE_BODY,
    })
    queueHappyPath()
    const sent = await send(ISSUE_BODY)
    expect(preview.statusCode).toBe(200)
    expect(sent.statusCode).toBe(200)
  })
})
