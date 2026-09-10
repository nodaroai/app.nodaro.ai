/**
 * 3D Render Pro through the orchestrator.
 *
 * The properties a second execution surface must have, or it is a second
 * implementation pretending to be one:
 *
 *  - an in-graph run QUOTES and then submits to the SAME public routes, with a
 *    body the route's own schema accepts. The route is where every refusal
 *    lives, so a graph run that assembled a slightly different body would be
 *    exercising rules nobody tested;
 *  - the two source shapes mean the same thing on both engines. A scene wired
 *    into `scene` with no edit instruction is a render-only export here too,
 *    with its `editPrompt` absent and its timing untouched;
 *  - the settled job's TWO outputs are read the same way: `composition` yields
 *    the plan, `video` yields the MP4 URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrchestratorContext, SimpleNode } from "../types.js"
import { planV2 } from "../../../../../packages/shared/src/__tests__/scene3d-v2-fixtures.js"

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
import { buildNodeOutputFromJobData, getPrimaryOutput } from "../output-extractor.js"
import { pro3DRenderBody, pro3DRenderQuoteBody } from "../../../routes/pro-3d-render.js"

const VIDEO_URL = "https://r2.example/renders/pro.mp4"
const REVISION = "11111111-2222-4333-8444-555555555555"
const plan = {
  planType: "3d-scene", schemaVersion: 1, revisionId: REVISION,
  width: 1920, height: 1080, fps: 24, durationInFrames: 96, backgroundColor: "#eeeeee",
  camera: { position: [0, 2, 8], target: [0, 0, 0], focalLengthMm: 42, sensorWidthMm: 36 },
  lighting: { ambientIntensity: 1, keyIntensity: 2, keyPosition: [3, 5, 4] },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc3333" }],
}
const reference = { id: "look", kind: "image", role: "appearance", url: "https://example.com/look.png" }

const context = (): OrchestratorContext => ({
  executionId: "execution-1", workflowId: "workflow-1", userId: "user-1",
  triggerType: "manual", cancelled: false, billingContext: { payer: "user", userId: "user-1" },
})

/** The two request bodies the node posted: [quote, run]. */
function posted() {
  return mocks.fetch.mock.calls.map(([url, req]) => ({
    url: url as string,
    headers: (req as { headers: Record<string, string> }).headers,
    body: JSON.parse((req as { body: string }).body) as Record<string, unknown>,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.row = { status: "completed", credits: 500, input_data: {}, output_data: { scenePlan: plan, videoUrl: VIDEO_URL } }
  mocks.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.endsWith("/quote") ? { quoteId: "quote-1", maxCredits: 900 } : { jobId: "pro-job" }),
    text: async () => "",
  }))
  vi.stubGlobal("fetch", mocks.fetch)
})

describe("an in-graph run is the same transport as a direct call", () => {
  it("quotes then submits a route-valid body, references intact", async () => {
    const node: SimpleNode = {
      id: "pro-node", type: "pro-3d-render",
      data: {
        sourceMode: "prompt",
        scenePrompt: "A red suitcase rolls behind a pillar",
        references: [reference],
        fps: 24, durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1, quality: "standard", style: "clay",
      },
    }
    const ctx = { ...context(), uploadDescendantIds: new Set([node.id]), onJobCreated: vi.fn() }
    const result = await executeNode(node, {}, [], [node], {}, ctx)

    const [quote, run] = posted()
    expect(quote.url).toMatch(/\/v1\/pro-3d-render\/quote$/)
    expect(run.url).toMatch(/\/v1\/pro-3d-render$/)

    // The route's OWN schemas accept them — not bodies that merely look right.
    expect(pro3DRenderQuoteBody.safeParse(quote.body).success).toBe(true)
    expect(pro3DRenderBody.safeParse(run.body).success).toBe(true)

    expect(run.body.source).toEqual({ kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references: [reference] })
    // The table fixture's shape must be expressible from a graph too.
    expect(run.body).toMatchObject({
      engine: "blender-cloud", fps: 24, durationSeconds: 30, aspectRatio: "21:9",
      maxRepairPasses: 1, quoteId: "quote-1",
      userId: "user-1", workflowId: "workflow-1", nodeId: node.id, forcePrivate: true,
    })
    // The quote saw the identical request, minus the quote it produces.
    expect({ ...run.body, quoteId: undefined }).toEqual({ ...quote.body, quoteId: undefined })
    // A retry of the SAME execution must resolve to the same run, not buy another.
    expect(run.headers["Idempotency-Key"]).toBe(`wf-execution-1-${node.id}`)
    // No planner knobs are invented on the way in.
    for (const key of ["llmModel", "reasoningEffort", "prompt"]) expect(run.body).not.toHaveProperty(key)

    // Nothing was queued here: the route owns the job, exactly as for a direct call.
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(ctx.onJobCreated).toHaveBeenCalledWith(node.id, "pro-job")
    expect(result.output.plan).toEqual(plan)
    expect(result.output.videoUrl).toBe(VIDEO_URL)
  })

  it("sends a render-only scene source with no editPrompt and no timing", async () => {
    const upstream: SimpleNode = {
      id: "scene-node", type: "generate-3d-scene",
      data: { scenePlan: plan, sceneHistory: [{ revisionId: REVISION, jobId: "scene-job-9" }] },
    }
    const node: SimpleNode = {
      id: "pro-node", type: "pro-3d-render",
      // Node timing is set, and deliberately NOT sent: overriding a scene's own
      // timing has to be something the user asked for.
      data: { sourceMode: "scene", fps: 60, durationSeconds: 5, aspectRatio: "1:1" },
    }
    const edges = [{ source: upstream.id, target: node.id, targetHandle: "scene" }]
    await executeNode(node, {}, edges as never, [upstream, node], {}, context())

    const run = posted()[1]
    expect(run.body.source).toEqual({ kind: "scene", revisionId: REVISION, sourceJobId: "scene-job-9" })
    expect("editPrompt" in (run.body.source as object)).toBe(false)
    for (const key of ["durationSeconds", "fps", "aspectRatio"]) expect(run.body[key]).toBeUndefined()
    expect(pro3DRenderBody.safeParse(run.body).success).toBe(true)
  })

  it("sends the node's timing for a scene source only when re-timing is explicit", async () => {
    const upstream: SimpleNode = {
      id: "scene-node", type: "generate-3d-scene",
      data: { scenePlan: plan, sceneHistory: [{ revisionId: REVISION, jobId: "scene-job-9" }] },
    }
    const node: SimpleNode = {
      id: "pro-node", type: "pro-3d-render",
      data: { sourceMode: "scene", overrideSourceTiming: true, fps: 30, durationSeconds: 12, aspectRatio: "16:9" },
    }
    await executeNode(node, {}, [{ source: upstream.id, target: node.id, targetHandle: "scene" }] as never, [upstream, node], {}, context())
    expect(posted()[1].body).toMatchObject({ fps: 30, durationSeconds: 12, aspectRatio: "16:9" })
  })

  it("carries an edit instruction on a scene source", async () => {
    const upstream: SimpleNode = {
      id: "scene-node", type: "generate-3d-scene",
      data: { scenePlan: plan, sceneHistory: [{ revisionId: REVISION, jobId: "scene-job-9" }] },
    }
    const node: SimpleNode = {
      id: "pro-node", type: "pro-3d-render",
      data: { sourceMode: "scene", editPrompt: "Move the camera left" },
    }
    await executeNode(node, {}, [{ source: upstream.id, target: node.id, targetHandle: "scene" }] as never, [upstream, node], {}, context())
    expect(posted()[1].body.source).toEqual({
      kind: "scene", revisionId: REVISION, sourceJobId: "scene-job-9", editPrompt: "Move the camera left",
    })
  })

  it("lets the authoritative resolver locate a retained revision without a source job", async () => {
    const upstream: SimpleNode = { id: "scene-node", type: "generate-3d-scene", data: { scenePlan: plan } }
    const node: SimpleNode = { id: "pro-node", type: "pro-3d-render", data: { sourceMode: "scene" } }
    await executeNode(node, {}, [{ source: upstream.id, target: node.id, targetHandle: "scene" }] as never, [upstream, node], {}, context())
    expect(posted()[0].body.source).toEqual({ kind: "scene", revisionId: REVISION })
    expect(posted()[1].body.source).toEqual({ kind: "scene", revisionId: REVISION })
  })

  it("uses the scene edge and omits a later render job for a retained source", async () => {
    const retained = planV2()
    const upstream: SimpleNode = { id: "retained", type: "pro-3d-render", data: {
      scenePlan: retained, sceneHistory: [{ revisionId: retained.revisionId, jobId: "later-render-job" }],
    } }
    const referenceNode: SimpleNode = { id: "motion-ref", type: "pro-3d-render", data: {
      scenePlan: plan, generatedVideoUrl: VIDEO_URL,
    } }
    const node: SimpleNode = { id: "pro-node", type: "pro-3d-render", data: { sourceMode: "scene" } }
    await executeNode(node, {}, [
      { source: referenceNode.id, target: node.id, targetHandle: "referenceVideo" },
      { source: upstream.id, target: node.id, targetHandle: "scene" },
    ] as never, [referenceNode, upstream, node], {}, context())
    for (const call of posted()) expect(call.body.source).toEqual({ kind: "scene", revisionId: retained.revisionId })
  })

  it("refuses a briefless authoring node before either route is called", async () => {
    const node: SimpleNode = { id: "pro-node", type: "pro-3d-render", data: { sourceMode: "prompt", scenePrompt: "  " } }
    await expect(executeNode(node, {}, [], [node], {}, context())).rejects.toThrow(/no brief/i)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe("one job, three outputs", () => {
  const stills = [
    { shotIndex: 0, frame: 0, assetId: "a", url: "https://r2.example/renders/shot-0.png" },
    { shotIndex: 1, frame: 48, assetId: "b", url: "https://r2.example/renders/shot-1.png" },
  ]
  const output = buildNodeOutputFromJobData(
    { scenePlan: plan, videoUrl: VIDEO_URL, shotStills: stills }, "pro-3d-render")

  it("routes the video handle to the MP4", () => {
    expect(getPrimaryOutput(output, "pro-3d-render", "video")).toBe(VIDEO_URL)
  })

  it("routes the composition handle to the plan marker", () => {
    expect(getPrimaryOutput(output, "pro-3d-render", "composition")).toBe("plan-ready")
    expect(getPrimaryOutput(output, "pro-3d-render", undefined)).toBe("plan-ready")
    expect(output.plan).toEqual(plan)
  })

  it("carries the stills through, and routes their handle to the first one", () => {
    // Without the passthrough key the DAG drops the list and the handle is dark.
    expect(output.shotStills).toEqual(stills)
    expect(getPrimaryOutput(output, "pro-3d-render", "stills")).toBe(stills[0].url)
  })

  it("answers nothing on the stills handle when the run rendered none", () => {
    const bare = buildNodeOutputFromJobData({ scenePlan: plan, videoUrl: VIDEO_URL }, "pro-3d-render")
    expect(getPrimaryOutput(bare, "pro-3d-render", "stills")).toBeUndefined()
    // …and the other two handles are unaffected by the new one.
    expect(getPrimaryOutput(bare, "pro-3d-render", "video")).toBe(VIDEO_URL)
    expect(getPrimaryOutput(bare, "pro-3d-render", "composition")).toBe("plan-ready")
  })
})
