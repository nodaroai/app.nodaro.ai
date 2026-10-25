import { beforeEach, describe, expect, it, vi } from "vitest"

const prefs = { enabled: true }
vi.mock("../../user-preferences.js", () => ({ mcpFlowsEnabled: vi.fn(async () => prefs.enabled) }))
const resolveConversation = vi.fn(async () => ({ workflowId: "wf-1", hubId: "hub-1", isNew: true }))
vi.mock("../conversation-store.js", async (importOriginal) => ({ ...(await importOriginal<object>()), resolveConversation }))
const hydrate = vi.fn(async () => undefined)
vi.mock("../hydrate.js", () => ({ hydrateFlowNodeForJob: hydrate }))
type Build = (flow: { nodes: Record<string, unknown>[]; settings: Record<string, unknown> }) => Record<string, unknown> | null
const deltas: Array<Record<string, unknown> | null> = []
let stored: { nodes: Record<string, unknown>[]; settings: Record<string, unknown> } = { nodes: [], settings: {} }
const deletes: Array<Record<string, unknown>> = []
vi.mock("../../../supabase.js", () => {
  const chain = (filters: Record<string, unknown>) => ({
    eq: (col: string, val: unknown) => {
      const next = { ...filters, [col]: val }
      if (col === "version") deletes.push(next)
      return chain(next)
    },
  })
  return { supabase: { from: () => ({ delete: () => chain({}) }) } }
})
const importOutsideImages = vi.fn(async (_user: string, _inputs: unknown[]) => new Map<string, unknown>())
vi.mock("../import-inputs.js", () => ({ importOutsideImages }))
vi.mock("../workflow-delta.js", () => ({
  loadFlow: vi.fn(async () => ({ id: "wf-1", version: 1, ...stored })),
  applyFlowDelta: vi.fn(async (_id: string, _user: string, build: Build) => {
    deltas.push(build(stored))
    return true
  }),
}))

const { prepareFlowNode, commitFlowNode, abandonFlowNode, flowJobFields, flowLinkText } = await import("../record.js")
const { newSession } = await import("../../session.js")

const BODY = { prompt: "two dolphins", provider: "nano-banana-pro", aspectRatio: "16:9", mcp_client: "Claude Code", userId: "u1" }

function session(withConversation = true) {
  const s = newSession({
    userId: "u1",
    scopes: [],
    clientName: "Claude Code",
    ...(withConversation ? { conversation: { client: "claude-code" as const, key: "s-1" } } : {}),
  })
  s.userRequest = "make me two dolphins"
  s.currentTool = "generate_image"
  return s
}

beforeEach(() => {
  prefs.enabled = true
  deltas.length = 0
  stored = { nodes: [], settings: { mcpConversation: { client: "claude-code", clientName: "Claude Code", key: "s-1", startedAt: "t0", lastActivityAt: "t0" } } }
  resolveConversation.mockClear()
  hydrate.mockClear()
  importOutsideImages.mockClear()
})

describe("prepareFlowNode", () => {
  it("resolves the conversation and mints a node for a mapped call", async () => {
    const prepared = await prepareFlowNode(session(), "/v1/generate-image", BODY)
    expect(prepared).toMatchObject({ workflowId: "wf-1", tool: "generate_image", userRequest: "make me two dolphins", client: "claude-code" })
    expect(prepared?.nodeId).toMatch(/^mcp-wf-1-/)
    expect(flowJobFields(prepared)).toEqual({ nodeId: prepared!.nodeId })
    expect(resolveConversation).toHaveBeenCalledWith(expect.anything(), { client: "claude-code", key: "s-1" }, expect.any(Date), {
      firstRequest: "make me two dolphins",
      prompt: "two dolphins",
    }, undefined)
  })

  it("does nothing outside a /mcp conversation (the in-app Copilot), for an unmapped call, or when the user turned it off", async () => {
    expect(await prepareFlowNode(session(false), "/v1/generate-image", BODY)).toBeNull()
    expect(await prepareFlowNode(session(), "/v1/lip-sync", BODY)).toBeNull()
    // A tool that does not take user_request makes no node, even on a mapped route.
    const other = session()
    other.currentTool = "modify_video"
    expect(await prepareFlowNode(other, "/v1/text-to-video", { prompt: "x", provider: "seedance" })).toBeNull()
    prefs.enabled = false
    expect(await prepareFlowNode(session(), "/v1/generate-image", BODY)).toBeNull()
    expect(resolveConversation).not.toHaveBeenCalled()
  })

  it("never throws: a failed resolve leaves the call as it was", async () => {
    resolveConversation.mockRejectedValueOnce(new Error("db down"))
    expect(await prepareFlowNode(session(), "/v1/generate-image", BODY, () => undefined)).toBeNull()
  })
})

describe("commitFlowNode", () => {
  it("writes the running node with where it came from, and stamps the conversation's activity", async () => {
    const prepared = (await prepareFlowNode(session(), "/v1/generate-image", BODY))!
    expect(await commitFlowNode(prepared, "job-1")).toBe(true)
    const delta = deltas[0] as { upsertNodes: Array<Record<string, unknown>>; settings: { mcpConversation: Record<string, unknown> } }
    const node = delta.upsertNodes.find((n) => n.id === prepared.nodeId)!
    expect(node.type).toBe("generate-image")
    expect(node.data).toMatchObject({
      prompt: "two dolphins",
      executionStatus: "running",
      currentJobId: "job-1",
      mcpProvenance: { tool: "generate_image", outputKey: "generatedImageUrl", client: "claude-code", clientName: "Claude Code", userRequest: "make me two dolphins", jobId: "job-1" },
    })
    expect(delta.settings.mcpConversation).toMatchObject({ key: "s-1", firstRequest: "make me two dolphins", steps: 1 })
    expect(delta.settings.mcpConversation.lastActivityAt).not.toBe("t0")
    expect(hydrate).toHaveBeenCalledWith("job-1")
    expect(flowLinkText(prepared)).toContain("wf-1")
  })

  it("counts the steps from the nodes it writes into", async () => {
    stored = { ...stored, nodes: [{ id: "a", data: { mcpProvenance: { jobId: "j0" } } }, { id: "mine", data: {} }] }
    const prepared = (await prepareFlowNode(session(), "/v1/generate-image", BODY))!
    await commitFlowNode(prepared, "job-2")
    expect((deltas[0] as { settings: { mcpConversation: { steps: number } } }).settings.mcpConversation.steps).toBe(2)
  })

  it("answers before an outside image is stored, then points its upload node at the stored copy", async () => {
    const outside = "https://example.com/cat.png"
    let release: () => void = () => {}
    importOutsideImages.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve(new Map([[outside, { url: "https://media.nodaro.ai/uploads/cat.png", assetId: "asset-1", thumbnailUrl: null }]]))
      }),
    )
    const s = session()
    s.currentTool = "image_to_image"
    const prepared = (await prepareFlowNode(s, "/v1/image-to-image", { imageUrl: outside, prompt: "night", provider: "nano-banana-edit", userId: "u1" }))!
    expect(await commitFlowNode(prepared, "job-3")).toBe(true)
    // The node is written with the link the call used; the import has not finished.
    const first = deltas[0] as { upsertNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> }
    const upload = first.upsertNodes.find((n) => n.type === "upload-image")!
    expect(upload.data).toMatchObject({ url: outside })
    expect(deltas).toHaveLength(1)
    stored = { ...stored, nodes: first.upsertNodes }
    release()
    await vi.waitFor(() => expect(deltas).toHaveLength(2))
    const second = deltas[1] as { upsertNodes: Array<{ id: string; data: Record<string, unknown> }> }
    expect(second.upsertNodes).toHaveLength(1)
    expect(second.upsertNodes[0]).toMatchObject({ id: upload.id, data: { url: "https://media.nodaro.ai/uploads/cat.png", externalUrl: outside, assetId: "asset-1" } })
  })

  it("adds no second node for the same job (a client retry)", async () => {
    stored = { ...stored, nodes: [{ id: "old", type: "generate-image", data: { mcpProvenance: { jobId: "job-1" } } }] }
    const prepared = (await prepareFlowNode(session(), "/v1/generate-image", BODY))!
    await commitFlowNode(prepared, "job-1")
    expect(deltas[0]).toBeNull()
  })
})

describe("abandonFlowNode", () => {
  it("removes a conversation created for a refused call, at the version it read", async () => {
    deletes.length = 0
    const prepared = (await prepareFlowNode(session(), "/v1/generate-image", BODY))!
    await abandonFlowNode(prepared, () => undefined, 0)
    expect(deletes).toEqual([{ id: "wf-1", user_id: "u1", version: 1 }])
  })

  it("keeps a conversation that already holds a step, or that the call did not create", async () => {
    deletes.length = 0
    stored = { ...stored, nodes: [{ id: "n", data: {} }] }
    await abandonFlowNode((await prepareFlowNode(session(), "/v1/generate-image", BODY))!, () => undefined, 0)
    stored = { ...stored, nodes: [] }
    resolveConversation.mockResolvedValueOnce({ workflowId: "wf-1", hubId: "hub-1", isNew: false })
    await abandonFlowNode((await prepareFlowNode(session(), "/v1/generate-image", BODY))!, () => undefined, 0)
    expect(deletes).toEqual([])
  })
})
