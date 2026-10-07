/**
 * `/v1/component/execute` — the override lock (issue #1555).
 *
 * The route holds the component author's `snapshot_nodes` before it writes the
 * wrapper job, so an override map that re-points an outbound node inside the
 * component is refused with 400 BEFORE any row exists — the same rule as
 * `/v1/app/:slug/run`. Without the route check the caller got a 202 and the
 * run failed only in the background (the orchestrator's merge refuses too).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockExecuteAppRun, mockInsertJob, mockInsertJobIdempotent } = vi.hoisted(() => ({
  mockExecuteAppRun: vi.fn(),
  mockInsertJob: vi.fn(),
  mockInsertJobIdempotent: vi.fn(),
}))

vi.mock("@/services/app-execution.js", () => ({
  executeAppRun: mockExecuteAppRun,
}))

vi.mock("@/lib/insert-job.js", () => ({
  insertJob: mockInsertJob,
  insertJobIdempotent: mockInsertJobIdempotent,
  billingPairColumns: () => ({}),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/routes/_collect-component-outputs.js", () => ({
  collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }),
}))

vi.mock("@/lib/supabase.js", () => {
  const appRow = {
    id: "app-1",
    workflow_id: "wf-inner",
    name: "Deliver",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: [
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
      { id: "ugc-1", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false } },
      { id: "hook-1", type: "webhook-output", data: { url: "https://author.example/hook" } },
    ],
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
        return chain({ id: "row-1" })
      }),
    },
  }
})

import { componentExecuteRoutes } from "../component-execute.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockInsertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  mockExecuteAppRun.mockResolvedValue({ executionId: "exec-child", appRunId: "run-1" })

  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    req.authKind = "jwt"
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/component/execute — the override lock (issue #1555)", () => {
  it("refuses an override that re-points the component's Webhook Output — 400 locked_field, no wrapper job, no run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/component/execute",
      payload: {
        appSlug: "deliver",
        inputOverrides: {
          "text-1": { text: "a legitimate input" },
          "hook-1": { url: "https://attacker.example/collect" },
        },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('"url" on webhook-output node "hook-1"')
    expect(res.json().error.message).not.toContain("attacker")
    expect(mockInsertJob).not.toHaveBeenCalled()
    expect(mockInsertJobIdempotent).not.toHaveBeenCalled()
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("refuses an injected UGC run state — 400 locked_field, no wrapper job, no run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/component/execute",
      payload: { appSlug: "deliver", inputOverrides: { "ugc-1": { keepResult: true } } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('inputOverrides cannot set "keepResult" on a UGC node "ugc-1".')
    expect(mockInsertJob).not.toHaveBeenCalled()
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("still accepts an ordinary input on an input node", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/component/execute",
      payload: { appSlug: "deliver", inputOverrides: { "text-1": { text: "a legitimate input" } } },
    })

    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(mockExecuteAppRun).toHaveBeenCalledTimes(1))
    expect(mockExecuteAppRun).toHaveBeenCalledWith(
      expect.objectContaining({ inputOverrides: { "text-1": { text: "a legitimate input" } } }),
    )
  })
})
