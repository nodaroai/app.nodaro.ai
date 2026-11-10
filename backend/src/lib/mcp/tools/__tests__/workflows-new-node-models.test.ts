import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import Fastify from "fastify"
import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { VIDEO_GEN_MODELS } from "@nodaro/render-rules"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * The MCP workflow writes start a node they create on a model the deployment
 * offers (lib/new-node-models.ts, decided 2026-11-10): where models are
 * restricted, a NEW node that names no model, whose default is withheld,
 * starts on the first row its menu offers — and the answer says so. A node the
 * stored graph already holds, and a model the agent named, are kept.
 */

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../media-portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../media-portability.js")>()
  return {
    ...actual,
    rehostForeignMedia: async (nodes: readonly unknown[], userId: string, opts: { assets?: unknown; settings?: Record<string, unknown> } = {}) => {
      const { report } = await actual.rehostForeignMedia([], userId)
      return { nodes: [...nodes], ...(opts.assets ? { assets: opts.assets } : {}), ...(opts.settings ? { settings: opts.settings } : {}), report }
    },
  }
})
// The account's free-credit video limits: none (Cloud reads them through ee).
vi.mock("../../../../ee/lib/free-video-limits-for.js", () => ({ freeVideoLimitsFor: async () => null }))

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../surface-profile.js")
const { __availabilityUniverseReadyForTests } = await import("../../../availability-override.js")
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

/** Every read answers this row (the stored graph holds node "kept"). */
function chain() {
  const result = { data: { id: WORKFLOW_ID, name: "Flow", created_at: "x", updated_at: "t1", version: 2, user_id: "u1", nodes: [{ id: "kept" }] }, error: null }
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) obj[m] = vi.fn(() => obj)
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

function session(): McpSession {
  const s = newSession({ userId: "u1", scopes: ["workflows:read", "workflows:write"], clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

/** The node list of the first `insert` / `update` call that writes one. */
function writtenNodes(method: "insert" | "update"): Array<{ id: string; data: Record<string, unknown> }> {
  for (const r of fromMock.mock.results) {
    const fn = (r.value as Record<string, ReturnType<typeof vi.fn>>)[method]
    for (const call of fn?.mock.calls ?? []) {
      const arg = call[0] as Record<string, unknown>
      if (Array.isArray(arg?.nodes)) return arg.nodes as Array<{ id: string; data: Record<string, unknown> }>
    }
  }
  throw new Error(`no ${method} of nodes`)
}

const FIRST_OFFERED = VIDEO_GEN_MODELS.map((m) => m.value).find((v) => v !== DEFAULT_VIDEO_PROVIDER)!
const unnamed = (id: string) => ({ id, type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "a cat" } })

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() => chain())
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: [DEFAULT_VIDEO_PROVIDER] } })
  __resetSurfaceProfileCacheForTests()
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function tools() {
  const server = buildServer()
  registerWorkflows({ server, session: session(), fastify: Fastify() })
  return server
}

describe("MCP workflow writes start a new node on an offered model", () => {
  it("create_workflow: an unnamed default that is withheld moves to the menu's first offered row, and the answer says so", async () => {
    const result = await callTool(tools(), "create_workflow", { name: "Flow", nodes: [unnamed("v")], edges: [] })
    expect(result.isError).toBeUndefined()
    expect(writtenNodes("insert")[0]!.data.provider).toBe(FIRST_OFFERED)
    const text = (result.content as Array<{ text: string }>)[0]!.text
    expect(text).toContain(`provider "${FIRST_OFFERED}"`)
    expect(result.structuredContent).toMatchObject({ modelMoves: [{ nodeId: "v", from: DEFAULT_VIDEO_PROVIDER, to: FIRST_OFFERED }] })
  })

  it("create_workflow: a model the agent named is kept", async () => {
    const named = { ...unnamed("v"), data: { prompt: "a cat", provider: DEFAULT_VIDEO_PROVIDER } }
    await callTool(tools(), "create_workflow", { name: "Flow", nodes: [named], edges: [] })
    expect(writtenNodes("insert")[0]!.data.provider).toBe(DEFAULT_VIDEO_PROVIDER)
  })

  it("update_workflow_json: only the node new to the stored graph moves", async () => {
    const result = await callTool(tools(), "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: [unnamed("kept"), unnamed("added")], edges: [] })
    expect(result.isError).toBeUndefined()
    const nodes = writtenNodes("update")
    expect(nodes.find((n) => n.id === "kept")!.data.provider).toBeUndefined()
    expect(nodes.find((n) => n.id === "added")!.data.provider).toBe(FIRST_OFFERED)
  })

  it("import_workflow: every imported node is new here", async () => {
    const bundle = { version: 1, exportedAt: "2026-11-10T00:00:00Z", name: "Flow", nodes: [unnamed("v")], edges: [], settings: {} }
    const result = await callTool(tools(), "import_workflow", { workflow_json: JSON.stringify(bundle) })
    expect(result.isError).toBeUndefined()
    expect(writtenNodes("insert")[0]!.data.provider).toBe(FIRST_OFFERED)
  })

  it("a deployment that restricts nothing writes the node exactly as sent", async () => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    const result = await callTool(tools(), "create_workflow", { name: "Flow", nodes: [unnamed("v")], edges: [] })
    expect(writtenNodes("insert")[0]!.data.provider).toBeUndefined()
    expect(result.structuredContent).not.toHaveProperty("modelMoves")
  })
})
