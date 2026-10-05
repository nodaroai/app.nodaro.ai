import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Taking free signup credits back, and restoring them (migration 458), at the
 * route:
 *
 *  - POST /v1/admin/free-grants/:userId/revoke — platform-operator gated (it
 *    moves money); every RPC refusal answers its own code (404 for a missing
 *    account, 409 otherwise) with a message for the admin; a deployment-payer
 *    instance has no free grant to take (409 not_applicable); a database
 *    without the function answers 503 not_available_yet; a done take-back is
 *    written to admin_actions.
 *  - POST /v1/admin/free-grants/:userId/activate — a REVOKED account is
 *    reinstated (exactly what was taken, in the state it was taken from), never
 *    card-activated; a withheld one is activated as before.
 *  - GET /v1/admin/free-grants?state= — every FREE_GRANT_STATES value lists.
 *
 * The operator gate is the REAL `requirePlatformOperator`: on mainline it is
 * `requireAdmin` (mocked here), on a payer instance it checks the operator
 * allowlist — so the ordering "operator gate first, then not_applicable" is
 * exercised, not assumed.
 */

const ADMIN = "00000000-0000-4000-8000-0000000000a1"
const OPERATOR = "00000000-0000-4000-8000-0000000000a2"
const NON_ADMIN = "00000000-0000-4000-8000-0000000000a3"
const USER = "00000000-0000-4000-8000-000000000001"
const PAYER = "00000000-0000-4000-8000-0000000000c3"

const fake = vi.hoisted(() => {
  interface Call {
    table: string
    action: "select" | "insert"
    values: unknown
    filters: Array<[string, unknown]>
  }
  type Result = { data: unknown; error: unknown; count?: number | null }
  const state = {
    calls: [] as Call[],
    /** Per-table answer for reads; inserts answer `insertError`. */
    reads: new Map<string, Result>(),
    insertError: null as unknown,
    authUsers: new Map<string, { email: string; app_metadata: Record<string, unknown> }>(),
  }
  function from(table: string) {
    const call: Call = { table, action: "select", values: null, filters: [] }
    const resolve = (): Result => {
      state.calls.push(call)
      if (call.action === "insert") return { data: null, error: state.insertError }
      return state.reads.get(table) ?? { data: [], error: null, count: 0 }
    }
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (values: unknown) => {
        call.action = "insert"
        call.values = values
        return builder
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value])
        return builder
      },
      in: () => builder,
      order: () => builder,
      range: () => builder,
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      then: (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve().then(resolve).then(onFulfilled, onRejected),
    }
    return builder
  }
  const getUserById = vi.fn(async (id: string) => {
    const user = state.authUsers.get(id)
    return user ? { data: { user: { id, ...user } }, error: null } : { data: { user: null }, error: { message: "not found" } }
  })
  return { state, from, getUserById }
})

const grant = vi.hoisted(() => ({
  revokeSignupGrant: vi.fn(),
  reinstateSignupGrant: vi.fn(),
  activateSignupGrant: vi.fn(),
  readFreeGrantState: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => fake.from(table),
    rpc: vi.fn(),
    auth: { admin: { getUserById: fake.getUserById } },
  },
}))
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    if (req.userId !== ADMIN && req.userId !== OPERATOR) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))
vi.mock("@/lib/admin-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-check.js")>()),
  checkIsAdmin: async (id: string) => id === ADMIN || id === OPERATOR,
}))
// The money functions are the unit under test elsewhere (signup-grant-revoke.test.ts);
// FREE_GRANT_STATES stays REAL — the list route's enum is built from it at import.
vi.mock("@/ee/billing/signup-grant.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/billing/signup-grant.js")>()),
  ...grant,
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn() } }))

import { adminFreeGrantRoutes } from "../admin-free-grants.js"
import { FREE_GRANT_STATES } from "../../billing/signup-grant.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import { __flushHttpErrorTelemetry, __resetHttpErrorTelemetry } from "../../../lib/http-errors.js"

const ENV_KEYS = ["PLATFORM_OPERATOR_EMAILS", "PLATFORM_OWNER_EMAIL"] as const
let savedEnv: Record<string, string | undefined> = {}
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // A resolved value set by one case must not answer the next one.
  for (const fn of Object.values(grant)) fn.mockReset()
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.PLATFORM_OPERATOR_EMAILS = "operator@nodaro.test"
  process.env.PLATFORM_OWNER_EMAIL = ""
  fake.state.calls = []
  fake.state.reads = new Map()
  fake.state.insertError = null
  fake.state.authUsers = new Map([
    [ADMIN, { email: "admin@customer.test", app_metadata: {} }],
    [OPERATOR, { email: "operator@nodaro.test", app_metadata: {} }],
  ])

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => {
    await adminFreeGrantRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await __flushHttpErrorTelemetry()
  __resetHttpErrorTelemetry()
  __resetDeploymentPayerForTests()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.restoreAllMocks()
  await app.close()
})

function post(path: string, userId = ADMIN) {
  return app.inject({ method: "POST", url: path, headers: { "x-user-id": userId } })
}

function adminActions() {
  return fake.state.calls.filter((c) => c.table === "admin_actions" && c.action === "insert").map((c) => c.values)
}

/** Payer instance: requirePlatformOperator logs every refusal on purpose. */
function payerInstance() {
  __setDeploymentPayerForTests(PAYER)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
}

// ---------------------------------------------------------------------------
// POST /v1/admin/free-grants/:userId/revoke
// ---------------------------------------------------------------------------

describe("POST /v1/admin/free-grants/:userId/revoke", () => {
  const url = `/v1/admin/free-grants/${USER}/revoke`

  it("refuses a non-admin before anything moves", async () => {
    const res = await post(url, NON_ADMIN)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(grant.revokeSignupGrant).not.toHaveBeenCalled()
  })

  it("rejects a user id that is not a uuid", async () => {
    const res = await post("/v1/admin/free-grants/not-a-uuid/revoke")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(grant.revokeSignupGrant).not.toHaveBeenCalled()
  })

  it("takes the grant back: the acting admin is passed, the answer carries state + credits, and it is audited", async () => {
    grant.revokeSignupGrant.mockResolvedValue({ changed: true, state: "revoked", credits: 1500, refusal: null })

    const res = await post(url)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { userId: USER, state: "revoked", credits: 1500 } })
    expect(grant.revokeSignupGrant).toHaveBeenCalledWith(USER, ADMIN)
    expect(adminActions()).toEqual([
      {
        admin_user_id: ADMIN,
        action: "free_grant_revoke",
        target_type: "user",
        target_id: USER,
        reason: null,
        payload: { credits: 1500 },
      },
    ])
  })

  it("a failed audit write does not turn a done take-back into a failure", async () => {
    grant.revokeSignupGrant.mockResolvedValue({ changed: true, state: "revoked", credits: 0, refusal: null })
    fake.state.insertError = { code: "XX000", message: "audit table down" }

    const res = await post(url)

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ userId: USER, state: "revoked", credits: 0 })
  })

  it.each([
    ["not_found", 404],
    ["not_revocable", 409],
    ["paid_account", 409],
    ["reservations_open", 409],
  ] as const)("refusal %s → %i with that code and an admin-readable message; nothing audited", async (refusal, status) => {
    grant.revokeSignupGrant.mockResolvedValue({ changed: false, state: null, credits: 0, refusal })

    const res = await post(url)

    expect(res.statusCode).toBe(status)
    const { error } = res.json()
    expect(error.code).toBe(refusal)
    expect(typeof error.message).toBe("string")
    expect(error.message.length).toBeGreaterThan(0)
    expect(error.message).not.toMatch(/revoke_signup_grant|rpc|profiles/i)
    expect(adminActions()).toEqual([])
  })

  it("every refusal has its own message", async () => {
    const messages = new Set<string>()
    for (const refusal of ["not_found", "not_revocable", "not_revoked", "paid_account", "reservations_open"]) {
      grant.revokeSignupGrant.mockResolvedValueOnce({ changed: false, state: null, credits: 0, refusal })
      messages.add((await post(url)).json().error.message)
    }
    expect(messages.size).toBe(5)
  })

  it("an unchanged answer with no refusal reads as not_found (404), never as success", async () => {
    grant.revokeSignupGrant.mockResolvedValue({ changed: false, state: null, credits: 0, refusal: null })
    const res = await post(url)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it.each([
    ["PGRST202 (PostgREST: not in the schema cache)", { code: "PGRST202", message: "Could not find the function" }],
    ["42883 (Postgres: undefined function)", { code: "42883", message: "function does not exist" }],
    ["a message alone", { message: "Could not find the function public.revoke_signup_grant(p_admin_id, p_grant_amount, p_user_id)" }],
  ])("503 not_available_yet before migration 458 — %s", async (_label, err) => {
    grant.revokeSignupGrant.mockRejectedValue(err)

    const res = await post(url)

    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available_yet")
    expect(adminActions()).toEqual([])
  })

  it("any other failure is a sanitized 500 — the raw database message never reaches the wire", async () => {
    grant.revokeSignupGrant.mockRejectedValue({ code: "XX000", message: "relation free_grant_revocations is broken" })

    const res = await post(url)

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: "internal_error", message: "Failed to take back the free grant" })
    expect(res.body).not.toContain("free_grant_revocations")
    expect(adminActions()).toEqual([])
  })

  describe("on a deployment-payer instance", () => {
    it("the operator is answered 409 not_applicable — there is no free grant to take", async () => {
      payerInstance()

      const res = await post(url, OPERATOR)

      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("not_applicable")
      expect(grant.revokeSignupGrant).not.toHaveBeenCalled()
    })

    it("a customer admin who is not an operator is stopped by the operator gate first", async () => {
      payerInstance()

      const res = await post(url, ADMIN)

      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("operator_required")
      expect(grant.revokeSignupGrant).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// POST /v1/admin/free-grants/:userId/activate
// ---------------------------------------------------------------------------

describe("POST /v1/admin/free-grants/:userId/activate", () => {
  const url = `/v1/admin/free-grants/${USER}/activate`

  it("a REVOKED account is reinstated — never card-activated — and the restore is audited", async () => {
    grant.readFreeGrantState.mockResolvedValue("revoked")
    grant.reinstateSignupGrant.mockResolvedValue({ changed: true, state: "granted", credits: 1500, refusal: null })

    const res = await post(url)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { userId: USER, state: "granted", credits: 1500 } })
    expect(grant.reinstateSignupGrant).toHaveBeenCalledWith(USER, ADMIN)
    expect(grant.activateSignupGrant).not.toHaveBeenCalled()
    expect(adminActions()).toEqual([
      {
        admin_user_id: ADMIN,
        action: "free_grant_restore",
        target_type: "user",
        target_id: USER,
        reason: null,
        payload: { credits: 1500, state: "granted" },
      },
    ])
  })

  it("a revoked account taken back from 'withheld' goes back to withheld with nothing moved", async () => {
    grant.readFreeGrantState.mockResolvedValue("revoked")
    grant.reinstateSignupGrant.mockResolvedValue({ changed: true, state: "withheld", credits: 0, refusal: null })

    const res = await post(url)

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ userId: USER, state: "withheld", credits: 0 })
    expect(grant.activateSignupGrant).not.toHaveBeenCalled()
  })

  it("a refused reinstate answers 409 with the refusal's code, and nothing is audited", async () => {
    grant.readFreeGrantState.mockResolvedValue("revoked")
    grant.reinstateSignupGrant.mockResolvedValue({ changed: false, state: "revoked", credits: 0, refusal: "paid_account" })

    const res = await post(url)

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("paid_account")
    expect(grant.activateSignupGrant).not.toHaveBeenCalled()
    expect(adminActions()).toEqual([])
  })

  it("a WITHHELD account is still activated as before (not reinstated)", async () => {
    grant.readFreeGrantState.mockResolvedValue("withheld")
    grant.activateSignupGrant.mockResolvedValue({ activated: true, state: "granted" })

    const res = await post(url)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { userId: USER, state: "granted" } })
    expect(grant.activateSignupGrant).toHaveBeenCalledWith(USER, "Free signup grant (restored by admin)")
    expect(grant.reinstateSignupGrant).not.toHaveBeenCalled()
  })

  it("an account that is neither withheld nor revoked answers 409 not_withheld", async () => {
    grant.readFreeGrantState.mockResolvedValue("granted")
    grant.activateSignupGrant.mockResolvedValue({ activated: false, state: "granted" })

    const res = await post(url)

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_withheld")
    expect(grant.reinstateSignupGrant).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/free-grants?state=
// ---------------------------------------------------------------------------

describe("GET /v1/admin/free-grants?state=", () => {
  function list(query: string) {
    return app.inject({ method: "GET", url: `/v1/admin/free-grants${query}`, headers: { "x-user-id": ADMIN } })
  }
  const stateFilters = () =>
    fake.state.calls
      .filter((c) => c.table === "profiles")
      .flatMap((c) => c.filters.filter(([column]) => column === "free_grant_state").map(([, v]) => v))

  it.each([...FREE_GRANT_STATES])("lists accounts in state '%s'", async (state) => {
    const res = await list(`?state=${state}`)
    expect(res.statusCode).toBe(200)
    expect(stateFilters()).toEqual([state])
  })

  it("defaults to the withheld list", async () => {
    const res = await list("")
    expect(res.statusCode).toBe(200)
    expect(stateFilters()).toEqual(["withheld"])
  })

  it("rejects a state outside the vocabulary", async () => {
    const res = await list("?state=bogus")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
