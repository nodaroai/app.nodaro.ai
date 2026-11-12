/**
 * A component node placed in a workflow keeps running when that workflow runs,
 * whoever owns the component — also on a deployment that does not allow public
 * work (`outputs.allowPublic: false`), where the component is otherwise its
 * creator's alone (decided 2026-11-11, lib/published-app-access.ts).
 *
 * End to end through the real seams: the orchestrator's component dispatch
 * (`executeNode` → `executeComponentNode`) sends its request, and that exact
 * request — headers and body as the node executor built them — goes through
 * the real auth hook into the real `POST /v1/component/execute`. The lane the
 * route keeps open is the one the dispatch names (`x-nodaro-parent-execution`
 * on an internal call: `parentExecutionIdOf`); the same component asked for by
 * its name — the shape MCP `run_component` sends, an internal call that names
 * no execution — is refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const CREATOR = "00000000-0000-4000-8000-0000000000c1"
const RUNNER = "00000000-0000-4000-8000-0000000000a1"

const h = vi.hoisted(() => ({
  appRow: null as Record<string, unknown> | null,
  executeAppRun: vi.fn(),
  insertJob: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => {
  function chain(table: string) {
    const rows = table === "published_apps" && h.appRow ? [h.appRow] : []
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
          if (prop === "single" || prop === "maybeSingle") return async () => ({ data: rows[0] ?? null, error: null })
          return () => proxy
        },
      },
    )
    return proxy
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)), rpc: vi.fn() } }
})
vi.mock("@/lib/availability-viewer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability-viewer.js")>()),
  assertNodeAvailableForUser: vi.fn(async () => undefined),
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.executeAppRun }))
vi.mock("@/lib/insert-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insert-job.js")>()),
  insertJob: h.insertJob,
  insertJobIdempotent: h.insertJob,
}))
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/credit-guard.js")>()),
  resolveWebSurfaceFlag: vi.fn(async () => false),
}))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn(async () => ({ output: {} })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))

const { executeNode } = await import("../node-executor.js")
const { registerAuthHook } = await import("@/middleware/auth.js")
const { componentExecuteRoutes } = await import("@/routes/component-execute.js")
const { __resetSurfaceProfileCacheForTests } = await import("@/lib/surface-profile.js")
import type { OrchestratorContext, SimpleNode } from "../types.js"

const COMPONENT_NODE: SimpleNode = {
  id: "comp-1",
  type: "component",
  data: { appSlug: "someone-elses-component", componentMetadata: { inputs: [], outputs: [], exposedSettings: [] } },
}

const ctx = (): OrchestratorContext =>
  ({
    executionId: "00000000-0000-4000-8000-0000000000e1",
    workflowId: "00000000-0000-4000-8000-0000000000f1",
    userId: RUNNER,
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    billingContext: { payer: "user", userId: RUNNER },
    onJobCreated: vi.fn(),
  }) as unknown as OrchestratorContext

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let api: FastifyInstance
/** What the route answered the node executor's own request. */
const answers: Array<{ status: number; body: unknown; headers: Record<string, string> }> = []

beforeEach(async () => {
  vi.clearAllMocks()
  answers.length = 0
  h.appRow = {
    id: "app-1",
    workflow_id: "wf-inner",
    creator_id: CREATOR,
    name: "Someone else's component",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: [],
    snapshot_edges: [],
    snapshot_settings: {},
  }
  h.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  h.executeAppRun.mockResolvedValue({ executionId: "exec-inner", appRunId: "run-inner" })
  setProfile({ outputs: { allowPublic: false } })

  api = Fastify({ logger: false })
  registerAuthHook(api)
  await api.register(componentExecuteRoutes)
  await api.ready()

  // The node executor's loopback call lands on the real route: its headers and
  // body as sent. The executor is then stopped there (the assertions are on the
  // route's answer, not on the inner run's poll).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method?: string; headers: Record<string, string>; body: string }) => {
      const res = await api.inject({ method: (init.method ?? "POST") as "POST", url: new URL(url).pathname, headers: init.headers, payload: init.body })
      answers.push({ status: res.statusCode, body: res.json(), headers: init.headers })
      return { ok: false, status: 599, json: async () => ({ error: { message: "stop-sentinel" } }) }
    }),
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await api.close()
  setProfile(null)
})

describe("a full run of a workflow holding another person's component, with outputs.allowPublic false", () => {
  it("the orchestrator's dispatch reaches the component route and the component starts (202)", async () => {
    await executeNode(COMPONENT_NODE, {}, [], [COMPONENT_NODE], {}, ctx()).catch(() => null)

    expect(answers).toHaveLength(1)
    expect(answers[0]!.headers["x-nodaro-parent-execution"]).toBe(ctx().executionId)
    expect(answers[0]!.status).toBe(202)
    expect(answers[0]!.body).toEqual({ jobId: "wrapper-1" })
    // The inner run starts in the background after the 202.
    await vi.waitFor(() => expect(h.executeAppRun).toHaveBeenCalledTimes(1))
    expect(h.executeAppRun.mock.calls[0]![0]).toMatchObject({ parentExecutionId: ctx().executionId, userId: RUNNER })
  })

  it("the same component asked for by its name on the internal lane (MCP run_component's shape: no execution named) is not found", async () => {
    const res = await api.inject({
      method: "POST",
      url: "/v1/component/execute",
      headers: { "x-internal-orchestrator-secret": process.env.INTERNAL_ORCHESTRATOR_SECRET!, "x-internal-user-id": RUNNER },
      payload: { appSlug: "someone-elses-component", userId: RUNNER },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Component not found" } })
    expect(h.executeAppRun).not.toHaveBeenCalled()
  })

  it("a forged execution header from outside the internal lane opens nothing", async () => {
    // No internal secret: the auth hook never makes it internal, so the header is not believed.
    const res = await api.inject({
      method: "POST",
      url: "/v1/component/execute",
      headers: { "x-nodaro-parent-execution": ctx().executionId },
      payload: { appSlug: "someone-elses-component" },
    })
    expect(res.statusCode).toBe(401)
    expect(h.executeAppRun).not.toHaveBeenCalled()
  })
})

describe("with public outputs allowed (no profile)", () => {
  it("the same component asked for by its name starts, as before", async () => {
    setProfile(null)
    const res = await api.inject({
      method: "POST",
      url: "/v1/component/execute",
      headers: { "x-internal-orchestrator-secret": process.env.INTERNAL_ORCHESTRATOR_SECRET!, "x-internal-user-id": RUNNER },
      payload: { appSlug: "someone-elses-component", userId: RUNNER },
    })
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(h.executeAppRun).toHaveBeenCalledTimes(1))
  })
})
