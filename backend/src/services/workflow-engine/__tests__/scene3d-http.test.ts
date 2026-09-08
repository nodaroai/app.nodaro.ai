import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const mocks = vi.hoisted(() => ({ update: vi.fn(), queue: vi.fn(), fetch: vi.fn(), row: {} as Record<string, unknown> }))
vi.mock("../../../lib/supabase.js", () => {
  const chain = {
    select: () => chain, eq: () => chain,
    update: (value: unknown) => { mocks.update(value); return chain },
    single: async () => ({ data: mocks.row, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
  }
  return { supabase: { from: () => chain } }
})
vi.mock("../../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) }, hasCredits: () => true, isCloud: () => true, isBusiness: () => false, isCommunity: () => false }))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mocks.queue } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mocks.queue } }))
vi.mock("../../../ee/billing/credits.js", () => ({ CreditsService: {} }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
import { executeNode } from "../node-executor.js"
import { buildScene3DHttpBody } from "../scene3d-http.js"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"

const plan = {
  planType: "3d-scene", schemaVersion: 1, revisionId: "11111111-2222-4333-8444-555555555555",
  width: 1920, height: 1080, fps: 24, durationInFrames: 96, backgroundColor: "#eeeeee",
  camera: { position: [0, 2, 8], target: [0, 0, 0], focalLengthMm: 42, sensorWidthMm: 36 },
  lighting: { ambientIntensity: 1, keyIntensity: 2, keyPosition: [3, 5, 4] },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc3333" }],
}
const video = { id: "motion-reference", kind: "video", role: "motion", url: "https://example.com/motion.mp4" }
const context = (): OrchestratorContext => ({ executionId: "execution-1", workflowId: "workflow-1", userId: "user-1", triggerType: "manual", cancelled: false, billingContext: { payer: "user", userId: "user-1" } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.row = { status: "completed", credits_actual: 30, input_data: {}, output_data: { scenePlan: plan, analysisCredits: 4 } }
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ jobId: "scene-job" }) })
  vi.stubGlobal("fetch", mocks.fetch)
})

describe("Scene3D workflow authoring through its HTTP route", () => {
  it("routes a Pro v2 composition to Advanced while preserving its exact revision and locks", () => {
    const baked = planV2()
    const source: SimpleNode = { id: "source", type: "pro-3d-render", data: { scenePlan: baked } }
    const edit: SimpleNode = { id: "edit", type: "edit-3d-scene", data: {
      editPrompt: "Move the camera", scenePlan: plan, lockedObjectIds: ["e2"], selectedObjectIds: ["e1"],
    } }
    const body = buildScene3DHttpBody(edit, {}, context(), { nodes: [source, edit], edges: [
      { id: "edge", source: source.id, target: edit.id, sourceHandle: "composition", targetHandle: "scene" },
    ] })
    expect(body).toMatchObject({
      engine: "blender-cloud", acceptedSceneSchemaVersions: [1, 2], scenePlan: baked,
      expectedRevisionId: baked.revisionId, prompt: "Move the camera", lockedObjectIds: ["e2"], selectedObjectIds: ["e1"],
    })
  })

  it("does not fall back to an old v1 revision when the connected scene is invalid", () => {
    const source: SimpleNode = { id: "source", type: "pro-3d-render", data: { scenePlan: { planType: "3d-scene", schemaVersion: 3 } } }
    const edit: SimpleNode = { id: "edit", type: "edit-3d-scene", data: { editPrompt: "Move", scenePlan: plan } }
    expect(() => buildScene3DHttpBody(edit, {}, context(), { nodes: [source, edit], edges: [
      { id: "edge", source: source.id, target: edit.id, targetHandle: "scene" },
    ] })).toThrow(/unsupported version/)
  })

  it("keeps an explicit Advanced choice on generate transport", () => {
    const node: SimpleNode = { id: "scene", type: "generate-3d-scene", data: { scenePrompt: "A camera orbit", engine: "blender-cloud" } }
    expect(buildScene3DHttpBody(node, {}, context(), {})).toMatchObject({ engine: "blender-cloud", acceptedSceneSchemaVersions: [1, 2] })
  })

  it("refuses an explicit Basic edit of a retained v2 revision", () => {
    const node: SimpleNode = { id: "scene", type: "edit-3d-scene", data: { editPrompt: "Move", engine: "basic", scenePlan: planV2() } }
    expect(() => buildScene3DHttpBody(node, {}, context(), {})).toThrow(/cannot be edited on the Basic engine/)
  })
  it("sends video conditioning to the route, preserves privacy/payer and reports analysis spend", async () => {
    const node: SimpleNode = { id: "scene-node", type: "generate-3d-scene", data: { scenePrompt: "Match the camera", references: [video] } }
    const ctx = { ...context(), uploadDescendantIds: new Set([node.id]), onJobCreated: vi.fn() }
    const result = await executeNode(node, {}, [], [node], {}, ctx)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toMatch(/\/v1\/3d-scene\/generate$/)
    expect(JSON.parse(request.body)).toMatchObject({ prompt: "Match the camera", references: [video], userId: "user-1", workflowId: "workflow-1", nodeId: node.id, forcePrivate: true, fps: 24, durationSeconds: 4 })
    expect(request.headers["X-Internal-Orchestrator-Secret"]).toBe("x".repeat(40))
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(ctx.onJobCreated).toHaveBeenCalledWith(node.id, "scene-job")
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ workflow_execution_id: "execution-1" }))
    expect(result.output.plan).toEqual(plan)
    expect(result.creditsUsed).toBe(34)
  })
  it.each([
    ["generate-3d-scene", null, 40, 12, 52],
    ["edit-3d-scene", null, 40, 0, 40],
    ["generate-3d-scene", 0, 40, 12, 12],
    ["edit-3d-scene", 25, 40, 0, 25],
  ])("reports %s parent and analysis charges when actual is %s", async (type, actual, credits, analysisCredits, expected) => {
    mocks.row = { status: "completed", credits_actual: actual, credits, output_data: { scenePlan: plan, analysisCredits } }
    const node: SimpleNode = { id: "scene-node", type, data: { scenePrompt: "Match", editPrompt: "Move", scenePlan: plan } }
    const result = await executeNode(node, {}, [], [node], {}, context())
    expect(result.creditsUsed).toBe(expected)
  })
  it("resolves the fresh upstream scene into the edit route body", () => {
    const source: SimpleNode = { id: "source", type: "generate-3d-scene", data: {} }
    const edit: SimpleNode = { id: "edit", type: "edit-3d-scene", data: { editPrompt: "Move the box", references: [video] } }
    const body = buildScene3DHttpBody(edit, {}, context(), { nodes: [source, edit], edges: [{ id: "edge", source: source.id, target: edit.id, sourceHandle: "composition", targetHandle: "scene" }], nodeStates: { source: { status: "completed", output: { plan } } } })
    expect(body).toMatchObject({ scenePlan: plan, expectedRevisionId: plan.revisionId, prompt: "Move the box", references: [video] })
  })
  it("keeps source IDs and chosen roles on wired references", () => {
    const source: SimpleNode = { id: "image-source", type: "upload-image", data: {} }
    const node: SimpleNode = { id: "scene", type: "generate-3d-scene", data: { scenePrompt: "Match", referenceRoles: { "image-source": "layout" }, referenceObjectIds: { "image-source": "box" } } }
    const body = buildScene3DHttpBody(node, { referenceImageUrls: ["https://example.com/layout.png"] }, context(), { nodes: [source, node], edges: [{ id: "edge", source: source.id, target: node.id, sourceHandle: "image", targetHandle: "references" }], nodeStates: { [source.id]: { status: "completed", output: { imageUrl: "https://example.com/layout.png" } } } })
    expect(body.references).toEqual([{ id: source.id, url: "https://example.com/layout.png", kind: "image", role: "layout", objectId: "box" }])
  })
})
