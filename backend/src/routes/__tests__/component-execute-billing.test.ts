// P14/W4d — /v1/component/execute and the forwarded payer.
//
// The orchestrator's component dispatch forwards the PARENT execution's
// resolved context in the BODY (the route replies 202 and starts a separate
// execution — a header dies with the wrapper request). The route honors that
// body field ONLY on the internal-secret lane, shape-guarded: this route also
// serves ordinary authenticated users, and accepting the field from them
// would let any JWT caller forge a workspace payer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockExecuteAppRun, mockInsertJob } = vi.hoisted(() => ({
  mockExecuteAppRun: vi.fn(),
  mockInsertJob: vi.fn(),
}))

vi.mock("@/services/app-execution.js", () => ({
  executeAppRun: mockExecuteAppRun,
}))

vi.mock("@/lib/insert-job.js", () => ({
  insertJob: mockInsertJob,
  billingPairColumns: (ctx?: { payer?: string; workspaceId?: string; orgId?: string }) =>
    ctx?.payer === "workspace" ? { workspace_id: ctx.workspaceId, org_id: ctx.orgId } : {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/routes/_collect-component-outputs.js", () => ({
  collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }),
}))

vi.mock("@/lib/supabase.js", () => {
  // published_apps lookup resolves one component row; workflow_executions
  // polls answer "completed" immediately so the background loop exits fast.
  const appRow = {
    id: "app-1",
    workflow_id: "wf-inner",
    name: "Comp",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: [],
    snapshot_edges: [],
  }
  function chain(result: unknown) {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit", "update", "insert"]) {
      c[m] = vi.fn().mockReturnValue(c)
    }
    c.single = vi.fn().mockResolvedValue({ data: result, error: null })
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [result], error: null })
    return c
  }
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "published_apps") return chain(appRow)
        if (table === "workflow_executions")
          return chain({ status: "completed", completed_nodes: 1, total_nodes: 1, total_credits_used: 0 })
        return chain({ id: "row-1" })
      }),
    },
  }
})

import { componentExecuteRoutes } from "../component-execute.js"
import type { BillingContext } from "../../lib/billing-context.js"

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "user-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

let app: FastifyInstance
let authKind: "internal" | "jwt" = "jwt"
let hookCtx: BillingContext | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  authKind = "jwt"
  hookCtx = undefined
  mockInsertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  mockExecuteAppRun.mockResolvedValue({ executionId: "exec-child", appRunId: "run-1" })

  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    req.authKind = authKind
    if (hookCtx) req.billingContext = hookCtx
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function postExecute(body: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/v1/component/execute", payload: body })
  // The inner run starts inside setImmediate — wait for it before asserting.
  await vi.waitFor(() => expect(mockExecuteAppRun).toHaveBeenCalledTimes(1))
  return res
}

describe("POST /v1/component/execute — the forwarded payer (P14)", () => {
  it("INTERNAL lane: the body's context reaches the child execution verbatim", async () => {
    authKind = "internal"
    const res = await postExecute({ appSlug: "comp", billingContext: WS_CTX })
    expect(res.statusCode).toBe(202)
    expect(mockExecuteAppRun.mock.calls[0]?.[0]).toMatchObject({ billingContext: WS_CTX })
    // The WRAPPER JOB carries the honored context's pair too — this is the
    // one lane whose payer rides the body, where the request-level stamp
    // cannot see it (the review's M4a pin).
    expect(mockInsertJob.mock.calls[0]?.[1]).toMatchObject({ workspace_id: "ws-1", org_id: "org-1" })
  })

  it("JWT lane: a forged body context is IGNORED — the request's own resolved payer rides instead", async () => {
    authKind = "jwt"
    hookCtx = { payer: "user", userId: "user-1" }
    const res = await postExecute({ appSlug: "comp", billingContext: WS_CTX })
    expect(res.statusCode).toBe(202)
    const params = mockExecuteAppRun.mock.calls[0]?.[0] as { billingContext?: BillingContext }
    expect(params.billingContext).toBe(hookCtx)
    expect(params.billingContext).not.toEqual(WS_CTX)
  })

  it("INTERNAL lane: a MALFORMED body context degrades to the request's own — never a trusted cast", async () => {
    authKind = "internal"
    const res = await postExecute({
      appSlug: "comp",
      billingContext: { payer: "workspace", workspaceId: "evil" }, // missing everything else
    })
    expect(res.statusCode).toBe(202)
    const params = mockExecuteAppRun.mock.calls[0]?.[0] as { billingContext?: BillingContext }
    expect(params.billingContext).toBeUndefined()
  })
})
