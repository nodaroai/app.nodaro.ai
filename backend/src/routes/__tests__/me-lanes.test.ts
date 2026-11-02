// GET /v1/me/lanes: whether lanes are enforced, and the sizes of the caller's
// own lines — the personal one, and the one the request is billed to when that
// is another (a workspace, or an install's deployment payer).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { BillingContext, RequestBillingInput } from "../../lib/billing-context.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"

const USER = "00000000-0000-4000-8000-0000000000a1"
const WORKSPACE = "0b9a6f8e-1111-4222-8333-444455556666"
const PAYER = "7c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff"
const ALLOWED_WORKFLOW = "22222222-2222-4222-8222-222222222222"

const h = vi.hoisted(() => ({
  credits: false,
  /** Stands in for the payer decision; null = the real one. */
  resolve: null as null | ((input: RequestBillingInput) => Promise<BillingContext | undefined>),
  resolveInputs: [] as RequestBillingInput[],
  /** The Cloud plan reader's sizes for a subject; every subject it was asked about. */
  cloudSizes: null as null | ((subject: { payer: string; tier: string | null }) => Promise<LaneSizes>),
  cloudSubjects: [] as Array<{ userId: string; payer: string; tier: string | null }>,
  gateCalls: 0,
  /** Workflows the caller may run; every id asked about. */
  runnable: new Set<string>(),
  canRunAsked: [] as string[],
  canRunThrows: false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => { throw new Error("no database in this test") }, auth: { getUser: vi.fn() } },
}))
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => h.credits,
}))
vi.mock("../../lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/billing-context.js")>()
  return {
    ...actual,
    requestBillingContext: (input: RequestBillingInput) => {
      h.resolveInputs.push(input)
      return h.resolve ? h.resolve(input) : actual.requestBillingContext(input)
    },
  }
})
vi.mock("../../ee/concurrency-lanes/plan-sizes.js", () => ({
  cloudLaneSizesFor: (subject: { userId: string; payer: string; tier: string | null }) => {
    h.cloudSubjects.push(subject)
    return h.cloudSizes ? h.cloudSizes(subject) : Promise.reject(new Error("no stand-in"))
  },
}))
vi.mock("../../lib/workflow-access.js", () => ({
  canRunWorkflow: async (_userId: string, id: string) => {
    h.canRunAsked.push(id)
    if (h.canRunThrows) throw new Error("database down")
    return h.runnable.has(id)
  },
}))
// The route must never ask the gate (Redis): a call here would show up.
vi.mock("../../lib/concurrency-lanes/instance.js", () => ({
  concurrencyGate: () => {
    h.gateCalls++
    throw new Error("Redis is down")
  },
}))

const { meLanesRoutes, DEPLOYMENT_LINE_KEY } = await import("../me-lanes.js")
const { noteEnforcedApplied, resetLastMirroredEnforcedForTests } = await import("../../lib/concurrency-lanes/sizes.js")
const { registerTokenWorkflowScopeGuard, LIMITED_KEY_MESSAGE } = await import("../../middleware/token-workflow-scope.js")

let app: FastifyInstance

beforeEach(async () => {
  h.credits = false
  h.resolve = null
  h.resolveInputs = []
  h.cloudSizes = null
  h.cloudSubjects = []
  h.gateCalls = 0
  h.runnable = new Set()
  h.canRunAsked = []
  h.canRunThrows = false
  resetLastMirroredEnforcedForTests()

  app = Fastify({ logger: false })
  // Auth stand-in: `x-user-id` signs in with a session; `x-limited-key` makes
  // it a personal API key limited to one workflow. `x-workspace` is the
  // workspace the orgs hook validated.
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId !== "string") return
    req.userId = userId
    if (req.headers["x-limited-key"]) {
      req.authKind = "api_token"
      req.apiToken = { workflowIds: [ALLOWED_WORKFLOW] } as never
    } else if (req.headers["x-full-key"]) {
      req.authKind = "api_token"
      req.apiToken = { workflowIds: [] } as never
    } else if (req.headers["x-app-token"]) {
      req.authKind = "app_token"
      req.appAuthorization = { appId: "app-1", authorizationId: "auth-1", scopes: [] } as never
    } else {
      req.authKind = "jwt"
    }
    const workspace = req.headers["x-workspace"]
    if (typeof workspace === "string") req.workspaceId = workspace
  })
  registerTokenWorkflowScopeGuard(app)
  await app.register(meLanesRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  resetLastMirroredEnforcedForTests()
})

const signedIn = { "x-user-id": USER }

describe("GET /v1/me/lanes", () => {
  it("refuses a caller who is not signed in", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/lanes" })
    expect(res.statusCode).toBe(401)
  })

  it("community returns env sizes", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        enforced: false,
        lines: [{ payer: `user:${USER}`, current: true, sizes: { provider: 12, llm: 24, local: 24, run: 12 } }],
      },
    })
    // Asked as a spend request from this client would be: no workflow named.
    expect(h.resolveInputs).toEqual([
      { userId: USER, workspaceId: undefined, workflowId: undefined, isAppRun: false, internal: false, inAppSession: true },
    ])
  })

  it("me/lanes returns the personal and current payer lines", async () => {
    h.credits = true
    h.resolve = async (input) => ({
      payer: "workspace",
      userId: input.userId,
      workspaceId: input.workspaceId!,
      orgId: "org-1",
      entitlements: { tierForGates: "business" } as never,
      memberCap: null,
    })
    h.cloudSizes = async (s) =>
      s.payer.startsWith("workspace:") ? { provider: 12, llm: 24, local: 24, run: 12 } : { provider: 4, llm: 8, local: 8, run: 4 }

    const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: { ...signedIn, "x-workspace": WORKSPACE } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      enforced: false,
      lines: [
        { payer: `user:${USER}`, current: false, sizes: { provider: 4, llm: 8, local: 8, run: 4 } },
        { payer: `workspace:${WORKSPACE}`, current: true, sizes: { provider: 12, llm: 24, local: 24, run: 12 } },
      ],
    })
    expect(h.resolveInputs[0].workspaceId).toBe(WORKSPACE)
    // Each line sized as its requests are: the personal tier read from the
    // account (null here), the workspace at its entitlement grade.
    expect(h.cloudSubjects).toEqual([
      { userId: USER, payer: `user:${USER}`, tier: null },
      { userId: USER, payer: `workspace:${WORKSPACE}`, tier: "business" },
    ])
  })

  it("answers one line when the request is billed to the caller", async () => {
    h.credits = true
    h.resolve = async (input) => ({ payer: "user", userId: input.userId })
    h.cloudSizes = async () => ({ provider: 2, llm: 4, local: 4, run: 2 })

    const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })

    expect(res.json().data.lines).toEqual([{ payer: `user:${USER}`, current: true, sizes: { provider: 2, llm: 4, local: 4, run: 2 } }])
  })

  it("shows a deployment payer's line without naming the paying account", async () => {
    h.credits = true
    h.resolve = async (input) => ({
      payer: "deployment",
      userId: input.userId,
      payerId: PAYER,
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 6, tierForGates: "standard" },
    })
    h.cloudSizes = async (s) =>
      s.payer.startsWith("deployment:") ? { provider: 6, llm: 12, local: 12, run: 6 } : { provider: 2, llm: 4, local: 4, run: 2 }

    const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })

    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain(PAYER)
    expect(res.json().data.lines).toEqual([
      { payer: `user:${USER}`, current: false, sizes: { provider: 2, llm: 4, local: 4, run: 2 } },
      { payer: DEPLOYMENT_LINE_KEY, current: true, sizes: { provider: 6, llm: 12, local: 12, run: 6 } },
    ])
    // Sized by the real line, at the payer's grade.
    expect(h.cloudSubjects[1]).toEqual({ userId: USER, payer: `deployment:${PAYER}`, tier: "standard" })
  })

  it("answers the personal line when the payer cannot be resolved", async () => {
    h.resolve = async () => {
      throw new Error("plugin down")
    }
    const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.lines).toEqual([{ payer: `user:${USER}`, current: true, sizes: { provider: 12, llm: 24, local: 24, run: 12 } }])
  })

  describe("?workflowId=", () => {
    const WORKFLOW = "33333333-3333-4333-8333-333333333333"
    const FOREIGN = "44444444-4444-4444-8444-444444444444"
    const MISSING = "55555555-5555-4555-8555-555555555555"
    const WORKFLOW_HOME = "66666666-6666-4666-8666-666666666666"

    // The resolver as the job routes meet it: a named workflow's home wins
    // over the header (rung 1), else the header's workspace, else personal.
    beforeEach(() => {
      h.credits = true
      h.resolve = async (input) => {
        const workspaceId = input.workflowId === WORKFLOW ? WORKFLOW_HOME : input.workspaceId
        if (!workspaceId) return { payer: "user", userId: input.userId }
        return { payer: "workspace", userId: input.userId, workspaceId, orgId: "org-1", entitlements: { tierForGates: "business" } as never, memberCap: null }
      }
      h.cloudSizes = async (s) =>
        s.payer.startsWith("workspace:") ? { provider: 12, llm: 24, local: 24, run: 12 } : { provider: 4, llm: 8, local: 8, run: 4 }
    })

    it("a workflow the caller may run decides the line its jobs count in, over the header", async () => {
      h.runnable.add(WORKFLOW)
      const res = await app.inject({
        method: "GET",
        url: `/v1/me/lanes?workflowId=${WORKFLOW}`,
        headers: { ...signedIn, "x-workspace": WORKSPACE },
      })

      expect(res.statusCode).toBe(200)
      expect(h.canRunAsked).toEqual([WORKFLOW])
      expect(h.resolveInputs[0]).toMatchObject({ workflowId: WORKFLOW, workspaceId: WORKSPACE })
      expect(res.json().data.lines).toEqual([
        { payer: `user:${USER}`, current: false, sizes: { provider: 4, llm: 8, local: 8, run: 4 } },
        { payer: `workspace:${WORKFLOW_HOME}`, current: true, sizes: { provider: 12, llm: 24, local: 24, run: 12 } },
      ])
    })

    it("another user's workflow and a missing one are ignored alike: the header's answer, nothing about the id", async () => {
      const ask = (id: string) =>
        app.inject({ method: "GET", url: `/v1/me/lanes?workflowId=${id}`, headers: { ...signedIn, "x-workspace": WORKSPACE } })
      const foreign = await ask(FOREIGN)
      const missing = await ask(MISSING)
      const none = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: { ...signedIn, "x-workspace": WORKSPACE } })

      expect(foreign.statusCode).toBe(200)
      expect(foreign.body).toBe(missing.body)
      expect(foreign.body).toBe(none.body)
      expect(foreign.json().data.lines[1]).toMatchObject({ payer: `workspace:${WORKSPACE}`, current: true })
      // The resolver never saw either id.
      expect(h.resolveInputs.map((i) => i.workflowId)).toEqual([undefined, undefined, undefined])
    })

    it("a failed access check ignores the workflow and still answers the header's line", async () => {
      h.runnable.add(WORKFLOW)
      h.canRunThrows = true
      const res = await app.inject({
        method: "GET",
        url: `/v1/me/lanes?workflowId=${WORKFLOW}`,
        headers: { ...signedIn, "x-workspace": WORKSPACE },
      })
      expect(res.statusCode).toBe(200)
      expect(h.resolveInputs[0].workflowId).toBeUndefined()
      expect(res.json().data.lines[1]).toMatchObject({ payer: `workspace:${WORKSPACE}`, current: true })
    })

    it("refuses a workflowId that is not a uuid", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/me/lanes?workflowId=not-a-uuid", headers: signedIn })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(h.canRunAsked).toEqual([])
    })
  })

  it("marks exactly one line current", async () => {
    h.credits = true
    h.cloudSizes = async () => ({ provider: 4, llm: 8, local: 8, run: 4 })
    for (const ctx of [
      undefined,
      { payer: "user", userId: USER },
      { payer: "workspace", userId: USER, workspaceId: WORKSPACE, orgId: "o", entitlements: { tierForGates: "business" }, memberCap: null },
      { payer: "deployment", userId: USER, payerId: PAYER, entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" } },
    ] as Array<BillingContext | undefined>) {
      h.resolve = async () => ctx
      const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
      const lines = res.json().data.lines as Array<{ current: boolean }>
      expect(lines.filter((l) => l.current)).toHaveLength(1)
      expect(lines[lines.length - 1].current).toBe(true)
    }
  })

  it("reports enforcement from this process's copy of the switch, never asking the gate", async () => {
    const off = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
    expect(off.json().data.enforced).toBe(false)

    noteEnforcedApplied(true)
    const on = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
    expect(on.statusCode).toBe(200)
    expect(on.json().data.enforced).toBe(true)

    expect(h.gateCalls).toBe(0)
  })

  it("is refused to an API key limited to some workflows, and answered for a session, a full key and an app token", async () => {
    const limited = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: { ...signedIn, "x-limited-key": "1" } })
    expect(limited.statusCode).toBe(403)
    expect(limited.json()).toEqual({ error: { code: "forbidden", message: LIMITED_KEY_MESSAGE } })
    expect(h.resolveInputs).toEqual([])

    const session = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: signedIn })
    expect(session.statusCode).toBe(200)

    // Any other credential that signs in as the account: a full-access key, an app token with no scope.
    for (const extra of [{ "x-full-key": "1" }, { "x-app-token": "1" }]) {
      const res = await app.inject({ method: "GET", url: "/v1/me/lanes", headers: { ...signedIn, ...extra } })
      expect(res.statusCode).toBe(200)
    }
  })
})
