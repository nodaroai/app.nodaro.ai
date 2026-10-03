/**
 * `POST /v1/component/estimate-credits` — the price a Component node quotes.
 *
 * It used to keep its own sum of base prices, so a component quoted below what
 * its run is charged. It now applies the exposed-setting overrides to the
 * author's snapshot and asks the shared workflow estimate — the one a
 * published app quotes, at the prices a run is charged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockEstimate, appRow } = vi.hoisted(() => ({
  mockEstimate: vi.fn(),
  appRow: {
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    snapshot_nodes: [
      { id: "img-1", type: "generate-image", data: { provider: "nano-banana-2", resolution: "1K" } },
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
    ],
    snapshot_edges: [{ source: "text-1", target: "img-1", targetHandle: "prompt" }],
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({ estimateWorkflowCredits: mockEstimate }))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: vi.fn() }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/supabase.js", () => {
  function chain(result: unknown) {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit"]) c[m] = vi.fn().mockReturnValue(c)
    c.single = vi.fn().mockResolvedValue({ data: result, error: null })
    return c
  }
  return { supabase: { from: vi.fn().mockImplementation(() => chain(appRow)) } }
})

import { componentExecuteRoutes } from "../component-execute.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockEstimate.mockResolvedValue(33)
  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

describe("POST /v1/component/estimate-credits", () => {
  it("quotes the shared workflow estimate over the snapshot, with the exposed overrides applied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/component/estimate-credits",
      payload: { appSlug: "deliver", exposedSettings: { "img-1:resolution": "4K", "ghost:resolution": "2K", noSeparator: 1 } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ estimatedCredits: 33 })

    const [nodes, edges] = mockEstimate.mock.calls[0]!
    expect(nodes).toEqual([
      { id: "img-1", type: "generate-image", data: { provider: "nano-banana-2", resolution: "4K" } },
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
    ])
    expect(edges).toEqual(appRow.snapshot_edges)
    // The author's snapshot is read, never written.
    expect(appRow.snapshot_nodes[0]!.data.resolution).toBe("1K")
  })
})
