/**
 * Copilot's edit_workflow starts a node it ADDS on a model the deployment
 * offers (lib/new-node-models.ts, decided 2026-11-10): where models are
 * restricted, an added node that names no model, whose default is withheld,
 * starts on the first row its menu offers, and the model is told. A node the
 * graph already holds keeps what it holds.
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from "vitest"
import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { VIDEO_GEN_MODELS } from "@nodaro/render-rules"

const { fromMock, rpcMock, graphState } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  graphState: { nodes: [] as unknown[], edges: [] as unknown[], version: 1 },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
vi.mock("@/ee/lib/free-video-limits-for.js", () => ({ freeVideoLimitsFor: async () => null }))

const { runEditWorkflow } = await import("../tools/edit-workflow.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
const { __availabilityUniverseReadyForTests } = await import("../../../lib/availability-override.js")
import type { CopilotToolContext } from "../tools/types.js"

const ctx = {
  userId: "u1",
  workflowId: "wf1",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
  fastify: {} as never,
  emit: () => {},
} as CopilotToolContext

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(() => {
  graphState.nodes = [{ id: "kept", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "old" } }]
  graphState.edges = []
  fromMock.mockReset()
  fromMock.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { nodes: graphState.nodes, edges: graphState.edges, version: graphState.version }, error: null }),
  }))
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [{ ok: true, version: 2, updated_at: "2026-11-10T10:00:00Z" }], error: null })
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: [DEFAULT_VIDEO_PROVIDER] } })
  __resetSurfaceProfileCacheForTests()
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const upserted = () => (rpcMock.mock.calls[0]![1] as { p_upsert_nodes: Array<{ id: string; data: Record<string, unknown> }> }).p_upsert_nodes

describe("edit_workflow — a node it adds starts on an offered model", () => {
  it("an added node that names no model moves to the menu's first offered row, and the model is told", async () => {
    const first = VIDEO_GEN_MODELS.map((m) => m.value).find((v) => v !== DEFAULT_VIDEO_PROVIDER)!
    const result = await runEditWorkflow(ctx, { note: "add a clip", upsertNodes: [{ id: "clip", type: "generate-video", data: { prompt: "a cat" } }] })
    expect(upserted().find((n) => n.id === "clip")!.data.provider).toBe(first)
    expect(result.adjustments.join("\n")).toContain(`clip: provider set to "${first}"`)
  })

  it("a node the graph already holds keeps what it holds", async () => {
    await runEditWorkflow(ctx, { note: "edit", upsertNodes: [{ id: "kept", type: "generate-video", data: { prompt: "new" } }] })
    expect(upserted().find((n) => n.id === "kept")!.data.provider).toBeUndefined()
  })

  it("a deployment that restricts nothing writes the node as the model sent it", async () => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    await runEditWorkflow(ctx, { note: "add a clip", upsertNodes: [{ id: "clip", type: "generate-video", data: { prompt: "a cat" } }] })
    expect(upserted().find((n) => n.id === "clip")!.data.provider).toBeUndefined()
  })
})
