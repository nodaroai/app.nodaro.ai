/**
 * A published app's or component's run, or a share link's viewer's — whoever runs it
 * (`ctx.runsAsPublished`) — runs every sub-workflow it reaches as published: the graph
 * `executeSubWorkflow` loads is stripped as the run's own graph is (`stripUgcPublishState`), at
 * every depth, so no nested UGC node hands on the author's photo, kept creator, script or renders,
 * and the Upload Image holding the author's photo is empty. Each graph is stripped by its part of
 * the run's strip set (`ctx.ugcStripSet`, read by the orchestrator over the run's graph and every
 * graph it references, keyed by the sub-workflow path the handler threads down its own recursion);
 * a graph the set was not read for runs with every node emptied. The orchestrator's up-front checks
 * load the same stripped graphs (`loadNestedRunGraphs`). The author's own runs are unchanged.
 *
 * The REAL `executeSubWorkflow` and the REAL funnel (`ugcPublishedGraph`), with only the database
 * read and the node dispatch mocked. The URLs are placeholders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SimpleNode, SimpleEdge, OrchestratorContext } from "../types.js"

const db = vi.hoisted(() => ({ workflows: new Map<string, { nodes: unknown[]; edges: unknown[] }>(), owners: new Map<string, string>() }))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return chain
          },
          single: async () => {
            const id = filters.id as string
            const row = db.workflows.get(id)
            return row && db.owners.get(id) === filters.user_id ? { data: row, error: null } : { data: null, error: { message: "not found" } }
          },
        }
        return chain
      },
    }),
  },
}))
vi.mock("../../../lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("../node-executor.js", () => ({
  executeNode: vi.fn().mockResolvedValue({ output: { text: "done" } }),
}))

import { executeSubWorkflow, loadNestedRunGraphs, subWorkflowLoadOptions } from "../sub-workflow-handler.js"
import { ugcPublishedGraph } from "../../../lib/ugc-composed-graph.js"
import { executeNode } from "../node-executor.js"

const OWNER = "owner-1"
const VIEWER = "viewer-1"
const PHOTO = "https://cdn.example/author.png"
const TAKE = "https://cdn.example/take.mp4"
const UPSCALED = "https://cdn.example/upscaled-face.png"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string | null, targetHandle: string | null): SimpleEdge => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })

/** The author's child workflow after a My photo run: their photo in an upload, the script and creator kept, a take, an upscale of the creator's image. */
function child(): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  return {
    nodes: [
      node("upload", "upload-image", { url: PHOTO, r2Url: PHOTO, assetId: "asset-author", generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 }),
      node("script", "ugc-script", { targetDurationSec: 15, keepResult: true, result: { plan: { v: 1, hook: "h" } }, ugcOutputs: { plan: "{}" } }),
      node("creator", "ugc-creator", {
        source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, generatedImageUrl: PHOTO,
        ugcOutputs: { creator: "{}", image: PHOTO }, result: { v: 1, identityImages: [PHOTO] },
      }),
      node("clips", "ugc-clips"),
      node("clip", "ugc-clip", { generatedVideoUrl: TAKE, generatedResults: [{ url: TAKE, jobId: "job-take", timestamp: "t" }], activeResultIndex: 0 }),
      node("upscale", "upscale-image", { generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED, jobId: "job-up", timestamp: "t" }], activeResultIndex: 0 }),
    ],
    edges: [
      edge("upload", "creator", "image", "photo"),
      edge("script", "creator", "category", "category"),
      edge("script", "clips", "plan", "plan"),
      edge("creator", "clips", "creator", "creator"),
      edge("clips", "clip", "clips", "clip"),
      edge("creator", "upscale", "image", "image"),
    ],
  }
}

function ctx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-parent",
    userId: VIEWER,
    workflowOwnerId: OWNER,
    triggerType: "manual",
    billingContext: { payer: "user", userId: VIEWER },
    cancelled: false,
    ...overrides,
  }
}

/** The nodes every dispatch inside the sub-workflow was handed: the graph it ran. */
const ranGraphs = () => vi.mocked(executeNode).mock.calls.map((call) => call[3] as SimpleNode[])
const dispatched = (id: string) => vi.mocked(executeNode).mock.calls.find((call) => (call[0] as SimpleNode).id === id)

beforeEach(() => {
  vi.clearAllMocks()
  db.workflows.clear()
  db.owners.clear()
  db.workflows.set("wf-child", child())
  db.owners.set("wf-child", OWNER)
})

describe("a sub-workflow in a run of a published app, a component or a share link", () => {
  it("runs the child graph as published: no photo, no kept creator or script, no take, no render made from them", async () => {
    await executeSubWorkflow(node("sub", "sub-workflow", { workflowId: "wf-child" }), {}, ctx({ runsAsPublished: true }))
    expect(ranGraphs().length).toBeGreaterThan(0)
    for (const graph of ranGraphs()) {
      for (const own of [PHOTO, TAKE, UPSCALED, "asset-author"]) expect(JSON.stringify(graph), own).not.toContain(own)
    }
    // The creator makes a fresh one — and its photo wire hands it nothing.
    const creator = dispatched("creator")
    expect(creator, "the creator ran").toBeDefined()
    expect((creator![0] as SimpleNode).data).toMatchObject({ source: "photo", keepResult: false })
    expect((creator![1] as { ugc?: Record<string, unknown> }).ugc?.photo).toBeUndefined()
    expect(dispatched("script"), "the script ran").toBeDefined()
  })

  it("at every depth: a child's own sub-workflow is run as published too", async () => {
    db.workflows.set("wf-middle", { nodes: [node("inner", "sub-workflow", { workflowId: "wf-child" })], edges: [] })
    db.owners.set("wf-middle", OWNER)
    // The inner sub-workflow node is dispatched by the real executor, recursively.
    vi.mocked(executeNode).mockImplementation(async () => ({ output: { text: "done" } }))
    await executeSubWorkflow(node("sub", "sub-workflow", { workflowId: "wf-middle" }), {}, ctx({ runsAsPublished: true }))
    const deepest = ranGraphs().filter((graph) => graph.some((n) => n.id === "creator"))
    expect(deepest.length).toBeGreaterThan(0)
    for (const graph of deepest) expect(JSON.stringify(graph)).not.toContain(PHOTO)
  })

  it("the up-front checks load the same graph the run executes", async () => {
    const parent = [node("sub", "sub-workflow", { workflowId: "wf-child" })]
    const [loaded] = await loadNestedRunGraphs(parent, OWNER, 0, new Set(), [], subWorkflowLoadOptions(ctx({ runsAsPublished: true })))
    expect(JSON.stringify(loaded!.nodes)).not.toContain(PHOTO)
    await executeSubWorkflow(parent[0]!, {}, ctx({ runsAsPublished: true }))
    expect(ranGraphs()[0]).toEqual(loaded!.nodes)
  })
})

describe("the author's own run", () => {
  it("runs the child graph as it is: what it keeps is handed on", async () => {
    await executeSubWorkflow(node("sub", "sub-workflow", { workflowId: "wf-child" }), {}, ctx({ userId: OWNER, billingContext: { payer: "user", userId: OWNER } }))
    // The creator is handed its kept result (the node executor hands it on without a call).
    expect((dispatched("creator")![0] as SimpleNode).data).toMatchObject({ keepResult: true, photoUrl: PHOTO })
    expect(JSON.stringify(ranGraphs())).toContain(TAKE)
  })
})

describe("a sub-workflow whose output feeds a creator's photo, in a run of a published app, a component or a share link", () => {
  /** The author's child workflow: their photo in an upload, an upscale of it, handed out through the output node. No UGC node. */
  function photoChild(): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
    return {
      nodes: [
        node("in", "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }] }),
        node("upload", "upload-image", { url: PHOTO, r2Url: PHOTO, assetId: "asset-author", generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 }),
        node("step", "upscale-image", { upscaleFactor: 2, generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED, jobId: "job-up", timestamp: "t" }], activeResultIndex: 0 }),
        node("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] }),
      ],
      edges: [edge("upload", "step", "image", "image"), edge("step", "out", "image", "p1")],
    }
  }
  const sub = (workflowId = "wf-photo") => node("sub", "sub-workflow", { workflowId })
  const creator = () => node("creator", "ugc-creator", { source: "photo", gender: "woman" })
  /** The run's graph: the sub-workflow's output into a creator's photo, or (`feedsPhoto: false`) into nothing. */
  const parentGraph = (workflowId = "wf-photo", feedsPhoto = true) => ({
    nodes: [sub(workflowId), creator()],
    edges: feedsPhoto ? [edge("sub", "creator", "out_p1", "photo")] : [],
  })
  /** The context of a run read as published, with the set the orchestrator reads at pickup (the one funnel). */
  async function publishedCtx(graph: { nodes: SimpleNode[]; edges: SimpleEdge[] }): Promise<OrchestratorContext> {
    const published = await ugcPublishedGraph(graph.nodes, graph.edges, OWNER)
    return ctx({ runsAsPublished: true, ugcStripSet: published.sets })
  }
  beforeEach(() => {
    db.workflows.set("wf-photo", photoChild())
    db.owners.set("wf-photo", OWNER)
  })

  it("everything its output can come from is emptied: the upload hands nothing on, and the step is dispatched with no image", async () => {
    await executeSubWorkflow(sub(), {}, await publishedCtx(parentGraph()))
    for (const graph of ranGraphs()) for (const own of [PHOTO, UPSCALED, "asset-author"]) expect(JSON.stringify(graph), own).not.toContain(own)
    expect(dispatched("step"), "the step ran").toBeDefined()
    expect((dispatched("step")![1] as { imageUrl?: string }).imageUrl).toBeUndefined()
  })

  it("one whose output feeds no photo runs its graph as it is: the upload hands on its image", async () => {
    await executeSubWorkflow(sub(), {}, await publishedCtx(parentGraph("wf-photo", false)))
    expect((dispatched("step")![1] as { imageUrl?: string }).imageUrl).toBe(PHOTO)
  })

  it("the author's own run is unchanged", async () => {
    await executeSubWorkflow(sub(), {}, ctx({ userId: OWNER, billingContext: { payer: "user", userId: OWNER } }))
    expect((dispatched("step")![1] as { imageUrl?: string }).imageUrl).toBe(PHOTO)
  })

  it("at every depth, down the handler's own recursion: a sub-workflow on that path inside it is emptied the same way", async () => {
    db.workflows.set("wf-middle", { nodes: [node("inner", "sub-workflow", { workflowId: "wf-photo" }), node("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })], edges: [edge("inner", "out", "out_p1", "p1")] })
    db.owners.set("wf-middle", OWNER)
    const run = await publishedCtx(parentGraph("wf-middle"))
    expect([...(run.ugcStripSet?.photo.get(JSON.stringify(["sub", "inner"])) ?? [])].sort()).toEqual(["in", "out", "step", "upload"])
    await executeSubWorkflow(sub("wf-middle"), {}, run)
    expect(dispatched("step"), "the step ran").toBeDefined()
    expect((dispatched("step")![1] as { imageUrl?: string }).imageUrl).toBeUndefined()
    for (const graph of ranGraphs()) expect(JSON.stringify(graph)).not.toContain(PHOTO)
  })

  it("a node naming one workflow to the editor and another to the run: the graph the run loads is not the one the set was read for, and runs with every node emptied", async () => {
    db.workflows.set("wf-plain", { nodes: [node("g", "generate-image", { prompt: "plain" }), node("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })], edges: [edge("g", "out", "image", "p1")] })
    db.owners.set("wf-plain", OWNER)
    // The set is read over the editor's reference; the run loads the one it reads (`workflowId`).
    const twoNames = node("sub", "sub-workflow", { workflowId: "wf-photo", referencedWorkflowId: "wf-plain" })
    const published = await ugcPublishedGraph([twoNames, creator()], [edge("sub", "creator", "out_p1", "photo")], OWNER)
    await executeSubWorkflow(twoNames, {}, ctx({ runsAsPublished: true, ugcStripSet: published.sets }))
    expect(dispatched("step"), "the step ran").toBeDefined()
    for (const graph of ranGraphs()) for (const own of [PHOTO, UPSCALED, "asset-author"]) expect(JSON.stringify(graph), own).not.toContain(own)
  })

  it("the up-front checks load the same graph the run executes", async () => {
    const run = await publishedCtx(parentGraph())
    const [loaded] = await loadNestedRunGraphs([sub()], OWNER, 0, new Set(), [], subWorkflowLoadOptions(run))
    expect(JSON.stringify(loaded!.nodes)).not.toContain(PHOTO)
    await executeSubWorkflow(sub(), {}, run)
    expect(ranGraphs()[0]).toEqual(loaded!.nodes)
  })
})

describe("a frozen sub-workflow inside a sub-workflow, whose own graph holds a UGC video", () => {
  const RENDER = "https://cdn.example/frozen-ugc-take.mp4"
  /** The child: a frozen sub-workflow (its saved take the author's UGC render) read by a trim, by `mode`; the grandchild holds the UGC video. */
  function setUp(mode: "item" | "all") {
    db.workflows.set("wf-holds-frozen", {
      nodes: [
        node("frozen", "sub-workflow", { workflowId: "wf-ugc", skipped: true, outputResults: { p1: RENDER }, generatedResults: [{ url: RENDER, jobId: "j", timestamp: "t" }], activeResultIndex: 0 }),
        node("trim", "trim-video", { keepFirstSeconds: 5 }),
      ],
      edges: [{ ...edge("frozen", "trim", "out_p1", "video"), data: { outputMode: mode, itemIndex: "1" } } as SimpleEdge],
    })
    db.owners.set("wf-holds-frozen", OWNER)
    db.workflows.set("wf-ugc", { nodes: [node("clip", "ugc-clip", { generatedVideoUrl: RENDER })], edges: [] })
    db.owners.set("wf-ugc", OWNER)
  }
  const outer = node("outer", "sub-workflow", { workflowId: "wf-holds-frozen" })

  it.each(["item", "all"] as const)("a %s edge: the trim is handed none of its saved take, nor is the graph it runs in", async (mode) => {
    setUp(mode)
    const published = await ugcPublishedGraph([outer], [], OWNER)
    await executeSubWorkflow(outer, {}, ctx({ runsAsPublished: true, ugcStripSet: published.sets }))
    const trim = dispatched("trim")
    expect(trim, "the trim ran").toBeDefined()
    expect(JSON.stringify(trim![1]), "what the trim was handed").not.toContain(RENDER)
    expect(JSON.stringify(trim![3]), "the graph it ran in").not.toContain(RENDER)
  })

  it("the author's own run is unchanged: the frozen node stands in with its take", async () => {
    setUp("all")
    await executeSubWorkflow(outer, {}, ctx({ userId: OWNER, billingContext: { payer: "user", userId: OWNER } }))
    expect(JSON.stringify(dispatched("trim")![3])).toContain(RENDER)
  })
})
