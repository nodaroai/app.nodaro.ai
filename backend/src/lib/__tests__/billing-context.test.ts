/**
 * E2/P14 — the payer seam. What these pin: absent/off/incapable/failing all
 * answer PERSONAL (the only pocket the caller always owns); a capable plugin
 * is delegated to verbatim, its RETURN shape-guarded like a throw; the
 * internal lane cannot re-run rung 1 (core strips, not the plugin); and the
 * per-request hook runs at the REAL preHandler stage on a REAL Fastify —
 * the review showed a fabricated app object let `preHandler → onRequest`
 * drift ship green while silently no-opping the whole seam in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  services: {} as Record<string, unknown>,
}))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasOrganizations: h.hasOrganizations,
}))
vi.mock("../private-plugins/load.js", () => ({ getPluginServices: () => h.services }))

const { resolveBillingContext, registerBillingContextHook, personalPayer, billingService } =
  await import("../billing-context.js")

const WF_UUID = "d0d0d0d0-1111-4222-8333-000000000001"
const WS_CTX = {
  payer: "workspace" as const,
  userId: "u-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  entitlements: {
    watermark: false as const,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business" as const,
    freeTierBlocklist: false as const,
    webFreeMode: false as const,
    appCreditsAllowance: false as const,
  },
  memberCap: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.hasOrganizations.mockReturnValue(true)
  h.services.billing = undefined
})

describe("resolveBillingContext — absent means personal, always", () => {
  it("flag off ⇒ personal, and the plugin is never consulted", async () => {
    const resolve = vi.fn()
    h.hasOrganizations.mockReturnValue(false)
    h.services.billing = { resolve }
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual(personalPayer("u-1"))
    expect(resolve).not.toHaveBeenCalled()
    expect(billingService()).toBeNull()
  })

  it("no billing service (older plugin) ⇒ personal", async () => {
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1" })
  })

  it("a garbage billing member (non-function resolve) ⇒ personal, no crash", async () => {
    h.services.billing = { resolve: "not-a-function" }
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1" })
  })

  it("a capable service is delegated to verbatim", async () => {
    const resolve = vi.fn(async () => WS_CTX)
    h.services.billing = { resolve }
    const input = { userId: "u-1", workflowId: WF_UUID, explicitWorkspaceId: "ws-1" }
    expect(await resolveBillingContext(input)).toBe(WS_CTX)
    expect(resolve).toHaveBeenCalledWith(input)
  })

  it("the internal rung-1 strip is CORE's invariant — a forgetful internal caller still cannot re-run rung 1", async () => {
    const resolve = vi.fn(async () => WS_CTX)
    h.services.billing = { resolve }
    await resolveBillingContext({ userId: "u-1", workflowId: WF_UUID, internal: true, explicitWorkspaceId: "ws-1" })
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: undefined, internal: true, explicitWorkspaceId: "ws-1" }),
    )
  })

  it("a resolver ERROR degrades to personal, marked — never to someone else's money", async () => {
    h.services.billing = { resolve: vi.fn(async () => { throw new Error("boom") }) }
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1", degraded: true })
  })

  it("a MALFORMED return degrades exactly like a throw — the shape guard is the contract's runtime half", async () => {
    // The additive drift the contract tolerates elsewhere: entitlements omitted.
    h.services.billing = {
      resolve: vi.fn(async () => ({ payer: "workspace", userId: "u-1", workspaceId: "ws-1", orgId: "org-1", memberCap: null })),
    }
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1", degraded: true })
    // And a well-shaped context passes the same guard untouched.
    h.services.billing = { resolve: vi.fn(async () => WS_CTX) }
    expect(await resolveBillingContext({ userId: "u-1" })).toBe(WS_CTX)
  })

  it("the NORMATIVE absent-field rule: a payload without billingContext reads personal, verbatim otherwise", async () => {
    const { payloadBillingContext } = await import("../billing-context.js")
    // Absent — a payload enqueued by pre-P14 code or a rollback window.
    expect(payloadBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1" })
    // Present — carried VERBATIM, the same object (workers never re-resolve).
    expect(payloadBillingContext({ userId: "u-1", billingContext: WS_CTX })).toBe(WS_CTX)
  })

  it("every gate literal the spend sites read is runtime-checked — a grade that relaxes one degrades", async () => {
    // P14/W4b made freeTierBlocklist / webFreeMode / appCreditsAllowance
    // load-bearing at the spend sites (org-entitlements.ts). They are
    // compile-time literals in the contract, but the value crosses a process
    // boundary from a build-arg-pinned plugin — runtime truth is this guard.
    for (const relaxed of [
      { freeTierBlocklist: true },
      { webFreeMode: true },
      { appCreditsAllowance: true },
      { watermark: true },
      { dailyCapCredits: 500 },
      { tierForGates: "free" },
    ]) {
      h.services.billing = {
        resolve: vi.fn(async () => ({ ...WS_CTX, entitlements: { ...WS_CTX.entitlements, ...relaxed } })),
      }
      expect(await resolveBillingContext({ userId: "u-1" }), JSON.stringify(relaxed)).toEqual({
        payer: "user",
        userId: "u-1",
        degraded: true,
      })
    }
  })
})

describe("registerBillingContextHook — real Fastify, real stage, real ordering", () => {
  let app: FastifyInstance
  let resolve: ReturnType<typeof vi.fn>
  const hookStages: string[] = []

  beforeEach(async () => {
    resolve = vi.fn(async () => WS_CTX)
    h.services.billing = { resolve }
    hookStages.length = 0

    app = Fastify()
    // The auth + orgs-context stand-ins, at their REAL stage (preHandler) and
    // in their REAL order — the billing hook registers AFTER them exactly as
    // app.ts does. If the billing hook drifted to onRequest it would run
    // before these and see no userId — every test below would fail.
    app.addHook("preHandler", async (req) => {
      const userId = req.headers["x-user-id"]
      if (typeof userId === "string") req.userId = userId
      const kind = req.headers["x-auth-kind"]
      if (typeof kind === "string") req.authKind = kind as never
      const ws = req.headers["x-test-workspace"]
      if (typeof ws === "string" && ws) req.workspaceId = ws
    })
    {
      const realAddHook = app.addHook.bind(app)
      ;(app as { addHook: unknown }).addHook = ((name: string, fn: never) => {
        hookStages.push(name)
        return realAddHook(name as never, fn)
      }) as never
      registerBillingContextHook(app)
      ;(app as { addHook: unknown }).addHook = realAddHook
    }
    app.post("/probe", async (req) => ({ ctx: req.billingContext ?? null }))
    app.get("/probe", async (req) => ({ ctx: req.billingContext ?? null }))
    await app.ready()
  })
  afterEach(() => app.close())

  const post = (headers: Record<string, string>, payload: unknown = {}) =>
    app.inject({ method: "POST", url: "/probe", headers, payload: payload as never })

  it("registers at preHandler — the stage is load-bearing, pinned", () => {
    expect(hookStages).toEqual(["preHandler"])
  })

  it("unauthenticated requests are untouched", async () => {
    const res = await post({})
    expect(res.json().ctx).toBeNull()
  })

  it("trivially personal (no workflow, no workspace): stamped personal, ZERO plugin calls", async () => {
    const res = await post({ "x-user-id": "u-1" }, { prompt: "x" })
    expect(res.json().ctx).toEqual({ payer: "user", userId: "u-1" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("a body-carried workflowId reaches the resolver (rung 1, untrusted, uuid-shaped only)", async () => {
    const res = await post({ "x-user-id": "u-1" }, { workflowId: WF_UUID })
    expect(res.json().ctx).toMatchObject({ payer: "workspace", workspaceId: "ws-1" })
    expect(resolve).toHaveBeenCalledWith({
      userId: "u-1",
      explicitWorkspaceId: undefined,
      workflowId: WF_UUID,
      isAppRun: false,
      internal: false,
    })
  })

  it("a NON-uuid workflowId is dropped, not resolved and not rejected", async () => {
    const res = await post({ "x-user-id": "u-1" }, { workflowId: "not-a-uuid" })
    expect(res.json().ctx).toEqual({ payer: "user", userId: "u-1" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("the validated req.workspaceId reaches the resolver (rung 2)", async () => {
    await post({ "x-user-id": "u-1", "x-test-workspace": "ws-1" })
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ explicitWorkspaceId: "ws-1", workflowId: undefined }))
  })

  it("the INTERNAL lane strips rung 1; no forwarded header means the parent decided personal", async () => {
    await post({ "x-user-id": "u-1", "x-auth-kind": "internal", "x-test-workspace": "ws-1" }, { workflowId: WF_UUID })
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ workflowId: undefined, internal: true, explicitWorkspaceId: "ws-1" }))
    resolve.mockClear()
    const res = await post({ "x-user-id": "u-1", "x-auth-kind": "internal" }, { workflowId: WF_UUID })
    expect(res.json().ctx).toEqual({ payer: "user", userId: "u-1" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("app_token and api_token lanes are NOT internal — rung 1 stays live for SDK/OAuth callers", async () => {
    for (const kind of ["app_token", "api_token"]) {
      resolve.mockClear()
      await post({ "x-user-id": "u-1", "x-auth-kind": kind }, { workflowId: WF_UUID })
      expect(resolve, kind).toHaveBeenCalledWith(expect.objectContaining({ workflowId: WF_UUID, internal: false }))
    }
  })

  it("GET never resolves — reads never spend, and the standing check already ran in the orgs hook", async () => {
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-user-id": "u-1", "x-test-workspace": "ws-1" } })
    expect(res.json().ctx).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("no capable service: the hook leaves the request untouched (absent = personal downstream)", async () => {
    h.services.billing = undefined
    const res = await post({ "x-user-id": "u-1", "x-test-workspace": "ws-1" })
    expect(res.json().ctx).toBeNull()
  })

  it("a string body (non-JSON content type) cannot smuggle rung-1 input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/probe",
      headers: { "x-user-id": "u-1", "content-type": "text/plain" },
      payload: `{"workflowId":"${WF_UUID}"}`,
    })
    expect([200, 415]).toContain(res.statusCode)
    expect(resolve).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Deployment payer (item 9) — the rung ABOVE the plugin gate
// ---------------------------------------------------------------------------

const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import("../deployment-payer.js")

const DEP_ENT = {
  watermark: false as const,
  dailyCapCredits: null,
  parallelism: 4,
  tierForGates: "basic",
}

describe("deployment payer rung — resolveBillingContext", () => {
  afterEach(() => __resetDeploymentPayerForTests())

  it("THE SINGLE-TENANT SHAPE, exactly: no orgs plugin at all + payer active ⇒ deployment context", async () => {
    // This placement is load-bearing: with the rung BELOW the `if (!svc)`
    // gate the whole feature silently no-ops on the one instance it exists
    // for (no orgs plugin ⇒ the gate returns personal first).
    h.hasOrganizations.mockReturnValue(false)
    __setDeploymentPayerForTests("payer-acct")
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({
      payer: "deployment",
      userId: "u-1",
      payerId: "payer-acct",
      entitlements: DEP_ENT,
    })
  })

  it("outranks a capable plugin: one payer per instance, nothing left to resolve", async () => {
    const resolve = vi.fn(async () => WS_CTX)
    h.services.billing = { resolve }
    __setDeploymentPayerForTests("payer-acct")
    const ctx = await resolveBillingContext({ userId: "u-1", workflowId: WF_UUID, explicitWorkspaceId: "ws-1" })
    expect(ctx).toMatchObject({ payer: "deployment", userId: "u-1", payerId: "payer-acct" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("inactive (mainline): byte-identical personal answers — the inert invariant", async () => {
    expect(await resolveBillingContext({ userId: "u-1" })).toEqual({ payer: "user", userId: "u-1" })
  })
})

describe("deployment payer rung — the per-request hook (real Fastify)", () => {
  let app: FastifyInstance
  let resolve: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    resolve = vi.fn(async () => WS_CTX)
    // No orgs plugin — the single-tenant shape. The deployment rung must fire anyway.
    h.hasOrganizations.mockReturnValue(false)
    h.services.billing = undefined
    __setDeploymentPayerForTests("payer-acct")

    app = Fastify()
    app.addHook("preHandler", async (req) => {
      const userId = req.headers["x-user-id"]
      if (typeof userId === "string") req.userId = userId
    })
    registerBillingContextHook(app)
    app.post("/probe", async (req) => ({ ctx: req.billingContext ?? null }))
    app.get("/probe", async (req) => ({ ctx: req.billingContext ?? null }))
    await app.ready()
  })
  afterEach(async () => {
    __resetDeploymentPayerForTests()
    await app.close()
  })

  it("a mutating authenticated request is stamped with the deployment payer, zero plugin calls", async () => {
    const res = await app.inject({ method: "POST", url: "/probe", headers: { "x-user-id": "u-1" }, payload: {} })
    expect(res.json().ctx).toEqual({ payer: "deployment", userId: "u-1", payerId: "payer-acct", entitlements: DEP_ENT })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("GET stays unstamped — reads never spend, deployment payer or not", async () => {
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-user-id": "u-1" } })
    expect(res.json().ctx).toBeNull()
  })

  it("unauthenticated requests are untouched", async () => {
    const res = await app.inject({ method: "POST", url: "/probe", payload: {} })
    expect(res.json().ctx).toBeNull()
  })
})
