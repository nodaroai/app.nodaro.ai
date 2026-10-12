/**
 * A share link's viewer runs the owner's graph — the REAL orchestrator path.
 *
 * `POST /v1/present/:token/run` marks a run by anyone but the workflow's owner
 * (`shareLinkViewer`). The worker runs it on the graph a viewer is shown, as an
 * app's runner runs its stripped snapshot: no UGC node hands on the author's
 * photo, kept creator, kept script or renders; each renders fresh for the
 * viewer, and the viewer's own photo lands on the emptied creator. The owner's
 * own runs are untouched.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * ugc-pick-first-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const outputs = new Map<string, Record<string, unknown>>()
  /** Each node's state while it runs, as the run persists it. */
  const runningStates = new Map<string, Record<string, unknown>>()
  /** A node that fails, by id: what it throws. */
  const failures = new Map<string, unknown>()
  const executeNode = vi.fn(async (node: { id: string }, _inputs: unknown, _edges: unknown, _nodes: unknown, nodeStates: Record<string, Record<string, unknown>>) => {
    executeNodeCalls.push(node.id)
    runningStates.set(node.id, { ...nodeStates[node.id] })
    if (failures.has(node.id)) throw failures.get(node.id)
    return { output: outputs.get(node.id) ?? { text: `${node.id} done` }, creditsUsed: 1 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const workflows = new Map<string, Record<string, unknown>>()
  /** Workflows whose next reads fail with an error (a statement timeout), by id: how many more. */
  const failing = new Map<string, number>()
  const apps = new Map<string, Record<string, unknown>>()
  const execSelectRow = { status: "queued", node_states: {} as Record<string, unknown> }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const left = failing.get(filters.id as string) ?? 0
        if (left > 0) {
          failing.set(filters.id as string, left - 1)
          return { data: null, error: { code: "57014", message: "statement timeout" } }
        }
        const row = workflows.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: (row: Record<string, unknown>) => {
      directUpdates.push(row)
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))
  const cancelInFlightChildJobs = vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() })

  return { executeNode, executeNodeCalls, outputs, failures, runningStates, updateExecutionWithRetry, directUpdates, from, workflows, failing, apps, execSelectRow, cancelInFlightChildJobs }
})

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({ cancelInFlightChildJobs: mocks.cancelInFlightChildJobs }))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ugcCreatorBody } from "@nodaro/shared"
import { stripUgcPublishState } from "@nodaro/render-rules"
import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"
const VIEWER = "viewer-1"
const PHOTO = "https://cdn.example/author.png"
const VIEWERS_PHOTO = "https://cdn.example/viewer.png"
const TAKE = "https://cdn.example/take.mp4"
const UPSCALED = "https://cdn.example/upscaled-face.png"

/** The owner's live graph after a My photo run, with the script and the creator kept. */
function liveGraph(opts: { authorsPhotoUpload?: boolean } = {}) {
  return {
    nodes: [
      ...(opts.authorsPhotoUpload
        ? [{
            id: "upload", type: "upload-image",
            data: { label: "Your photo", assetId: "asset-author", url: PHOTO, r2Url: PHOTO, generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 },
          }]
        : []),
      { id: "script", type: "ugc-script", data: { label: "script", targetDurationSec: 15, keepResult: true, result: { plan: { v: 1, hook: "h" } }, ugcOutputs: { plan: "{}" } } },
      {
        id: "creator", type: "ugc-creator",
        data: { label: "creator", source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, generatedImageUrl: PHOTO, ugcOutputs: { creator: "{}", image: PHOTO }, result: { v: 1, identityImages: [PHOTO] } },
      },
      { id: "clips", type: "ugc-clips", data: { label: "clips" } },
      { id: "clip", type: "ugc-clip", data: { label: "clip", generatedVideoUrl: TAKE, generatedResults: [{ url: TAKE }] } },
      ...(opts.authorsPhotoUpload
        ? [{ id: "upscale", type: "upscale-image", data: { label: "upscale", generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED }] } }]
        : []),
    ],
    edges: [
      ...(opts.authorsPhotoUpload
        ? [
            { id: "e0", source: "upload", target: "creator", sourceHandle: "image", targetHandle: "photo" },
            { id: "e5", source: "creator", target: "upscale", sourceHandle: "image", targetHandle: "image" },
          ]
        : []),
      { id: "e1", source: "script", target: "creator", sourceHandle: "category", targetHandle: "category" },
      { id: "e2", source: "script", target: "clips", sourceHandle: "plan", targetHandle: "plan" },
      { id: "e3", source: "creator", target: "clips", sourceHandle: "creator", targetHandle: "creator" },
      { id: "e4", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
    ],
    settings: {},
    user_id: OWNER,
  }
}

async function runJob(data: Record<string, unknown>, graph = liveGraph()) {
  mocks.workflows.set("wf-1", graph)
  await processWorkflowExecution({ data: { executionId: "exec-1", workflowId: "wf-1", triggerType: "manual", reviewerPresent: false, ...data } } as unknown as Job<WorkflowExecutionJob>)
}

/** The nodes the run handed its first dispatched node: the graph it ran. */
function ranGraph(): Array<{ id: string; data: Record<string, unknown> }> {
  const call = mocks.executeNode.mock.calls[0]
  if (!call) throw new Error("nothing was dispatched")
  return call[3] as unknown as Array<{ id: string; data: Record<string, unknown> }>
}
const dataOf = (id: string) => ranGraph().find((n) => n.id === id)!.data

/** What the dispatched UGC Creator asks for: its body, from its data and the photo its wire resolved to. */
function creatorBody() {
  const call = mocks.executeNode.mock.calls.find(([node]) => (node as { id: string }).id === "creator")
  expect(call, "the creator was dispatched").toBeDefined()
  const [creator, inputs] = call! as unknown as [{ data: Record<string, unknown> }, { ugc?: Record<string, unknown> }]
  return { wired: inputs.ugc?.photo, body: ugcCreatorBody({ data: creator.data as never, photoUrl: inputs.ugc?.photo as string | undefined }) }
}

/** The template as its author left it after a My photo run: their photo in "Your photo", the script and creator kept. */
async function authorsTemplate() {
  const doc = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json"), "utf8")) as {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
    edges: unknown[]
    settings: unknown
  }
  const nodes = doc.nodes.map((n) =>
    n.id === "photo"
      ? { ...n, data: { ...n.data, assetId: "asset-author", url: PHOTO, r2Url: PHOTO, generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 } }
      : n.id === "creator"
        ? { ...n, data: { ...n.data, source: "photo", gender: "man", keepResult: true, generatedImageUrl: PHOTO, ugcOutputs: { creator: "{}", image: PHOTO }, result: { v: 1, identityImages: [PHOTO] } } }
        : n,
  )
  return { nodes, edges: doc.edges, settings: doc.settings }
}

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.outputs.clear()
  mocks.updateExecutionWithRetry.mockClear()
  mocks.workflows.clear()
  mocks.failing.clear()
  mocks.apps.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
})

describe("a share link's viewer runs the graph a viewer is shown", () => {
  it("no UGC node hands on the author's photo, kept creator, kept script or take; the viewer's photo lands on the creator", async () => {
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })
    expect(JSON.stringify(ranGraph())).not.toContain(PHOTO)
    expect(JSON.stringify(ranGraph())).not.toContain(TAKE)
    expect(dataOf("creator")).toMatchObject({ source: "photo", photoUrl: VIEWERS_PHOTO, keepResult: false })
    expect(dataOf("creator").result).toBeUndefined()
    expect(dataOf("script").keepResult).toBe(false)
    expect(dataOf("script").result).toBeUndefined()
  })

  it("the author's photo in the upload wired into the creator never reaches the viewer's run: the viewer's own photo is the creator's", async () => {
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } }, liveGraph({ authorsPhotoUpload: true }))
    expect(JSON.stringify(ranGraph())).not.toContain(PHOTO)
    expect(JSON.stringify(ranGraph())).not.toContain(UPSCALED)
    expect(dataOf("upload")).toEqual({ label: "Your photo" })
    // The wire from the emptied upload hands the creator nothing, so the creator reads the viewer's photo.
    const call = mocks.executeNode.mock.calls.find(([node]) => (node as { id: string }).id === "creator")
    expect(call, "the creator was dispatched").toBeDefined()
    const [creator, inputs] = call! as unknown as [{ data: Record<string, unknown> }, { ugc?: Record<string, unknown> }]
    expect(inputs.ugc?.photo).toBeUndefined()
    const body = ugcCreatorBody({ data: creator.data as never, photoUrl: inputs.ugc?.photo as string | undefined })
    expect(body).toEqual({ body: { source: { kind: "photo", imageUrl: VIEWERS_PHOTO, gender: "man" } } })
  })

  it("a viewer who fills the upload wired into the creator: that photo is the creator's", async () => {
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { upload: { url: VIEWERS_PHOTO } } }, liveGraph({ authorsPhotoUpload: true }))
    expect(JSON.stringify(ranGraph())).not.toContain(PHOTO)
    const { wired, body } = creatorBody()
    expect(wired).toBe(VIEWERS_PHOTO)
    expect(body).toEqual({ body: { source: { kind: "photo", imageUrl: VIEWERS_PHOTO, gender: "man" } } })
  })

  it("the owner's own run reads the upload wired into the creator as before", async () => {
    const graph = liveGraph({ authorsPhotoUpload: true })
    const unkept = graph.nodes.map((n) => (n.id === "creator" ? { ...n, data: { ...n.data, keepResult: false } } : n)) as typeof graph.nodes
    await runJob({ userId: OWNER }, { ...graph, nodes: unkept })
    expect(creatorBody().wired).toBe(PHOTO)
  })

  it("the template's own wiring: a viewer's run never carries the author's photo, and the viewer's photo is the creator's", async () => {
    const template = await authorsTemplate()
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } }, { ...template, user_id: OWNER } as never)
    expect(JSON.stringify(ranGraph())).not.toContain(PHOTO)
    const { wired, body } = creatorBody()
    expect(wired).toBeUndefined()
    expect(body).toEqual({ body: { source: { kind: "photo", imageUrl: VIEWERS_PHOTO, gender: "man" } } })
  })

  it("the template's own wiring, published as an app: the runner's photo on the Creator card is the creator's", async () => {
    const template = await authorsTemplate()
    mocks.apps.set("app-v1", {
      snapshot_nodes: stripUgcPublishState(template.nodes, template.edges as never),
      snapshot_edges: template.edges,
      snapshot_settings: template.settings,
      creator_id: OWNER,
      publish_type: "app",
    })
    await runJob({ userId: VIEWER, appVersionId: "app-v1", triggerType: "app_run", inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } }, { ...template, user_id: OWNER } as never)
    expect(JSON.stringify(ranGraph())).not.toContain(PHOTO)
    const { wired, body } = creatorBody()
    expect(wired).toBeUndefined()
    expect(body).toEqual({ body: { source: { kind: "photo", imageUrl: VIEWERS_PHOTO, gender: "man" } } })
  })

  it("a viewer's run and an app's run load their sub-workflows as published; the owner's own run does not", async () => {
    const ranAsPublished = () => ((mocks.executeNode.mock.calls[0] as unknown as unknown[])[5] as { runsAsPublished?: boolean }).runsAsPublished
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })
    expect(ranAsPublished()).toBe(true)
    mocks.executeNode.mockClear()
    const template = await authorsTemplate()
    mocks.apps.set("app-v1", { snapshot_nodes: stripUgcPublishState(template.nodes, template.edges as never), snapshot_edges: template.edges, snapshot_settings: template.settings, creator_id: OWNER, publish_type: "app" })
    await runJob({ userId: VIEWER, appVersionId: "app-v1", triggerType: "app_run", inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })
    expect(ranAsPublished()).toBe(true)
    mocks.executeNode.mockClear()
    await runJob({ userId: OWNER })
    expect(ranAsPublished()).toBe(false)
  })

  it("the owner's own run is untouched: what they keep is handed on", async () => {
    await runJob({ userId: OWNER })
    expect(dataOf("creator")).toMatchObject({ keepResult: true, photoUrl: PHOTO })
    expect(dataOf("script").keepResult).toBe(true)
  })
})

describe("a viewer's run never carries the author's photo from any node on a path into the creator's photo", () => {
  const PRE = "https://cdn.example/author-upscaled-before.png"
  const SENT = "https://cdn.example/author-teleported.png"
  /** The author's photo reaches the creator's photo through a step (an upscale) or a teleport pair; on request the upload is one of the link's inputs. */
  function photoPath(via: "step" | "teleport", asInput = false) {
    const graph = liveGraph({ authorsPhotoUpload: true })
    const nodes = graph.nodes.filter((n) => n.id !== "upscale")
    const edges = graph.edges.filter((e) => e.id !== "e0" && e.id !== "e5")
    if (via === "step") {
      nodes.push({ id: "pre", type: "upscale-image", data: { label: "pre", upscaleFactor: 2, generatedImageUrl: PRE, generatedResults: [{ url: PRE }] } } as never)
      edges.push({ id: "p1", source: "upload", target: "pre", sourceHandle: "image", targetHandle: "image" }, { id: "p2", source: "pre", target: "creator", sourceHandle: "image", targetHandle: "photo" })
    } else {
      nodes.push(
        { id: "send", type: "teleport-send", data: { label: "send", channel: "P", result: SENT } } as never,
        { id: "recv", type: "teleport-receive", data: { label: "recv", channel: "P", result: SENT } } as never,
      )
      edges.push({ id: "p1", source: "upload", target: "send", sourceHandle: "image", targetHandle: "in" }, { id: "p2", source: "recv", target: "creator", sourceHandle: "out", targetHandle: "photo" })
    }
    const settings = asInput ? { presentationSettings: { runTarget: "workflow", inputItems: [{ type: "node", nodeId: "upload" }, { type: "node", nodeId: "creator" }] } } : {}
    return { ...graph, nodes, edges, settings }
  }

  it.each(["step", "teleport"] as const)("through a %s: the graph the viewer runs holds none of it, and the viewer's photo is the creator's", async (via) => {
    // The executor is a stand-in: the pair passes on what the emptied upload gives, which is nothing.
    mocks.outputs.set("send", {})
    mocks.outputs.set("recv", {})
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } }, photoPath(via))
    for (const own of [PHOTO, PRE, SENT, "asset-author"]) expect(JSON.stringify(ranGraph()), own).not.toContain(own)
    expect(dataOf("upload")).toEqual({ label: "Your photo" })
    if (via === "step") expect(dataOf("pre")).toEqual({ label: "pre", upscaleFactor: 2 })
    else expect(dataOf("recv")).toEqual({ label: "recv", channel: "P" })
    expect(creatorBody().body).toEqual({ body: { source: { kind: "photo", imageUrl: VIEWERS_PHOTO, gender: "man" } } })
  })

  it("the link's upload input filled by the viewer: the step makes the creator's photo from the viewer's, and what feeds the input is empty too", async () => {
    const LINK = "https://cdn.example/a-link.png"
    const graph = photoPath("step", true)
    graph.nodes.push({ id: "linker", type: "llm-chat", data: { label: "linker", userInput: "a link", generatedText: LINK } } as never)
    graph.edges.push({ id: "p0", source: "linker", target: "upload", sourceHandle: "text", targetHandle: "in" })
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { upload: { url: VIEWERS_PHOTO } } }, graph)
    for (const own of [PHOTO, PRE, LINK]) expect(JSON.stringify(ranGraph()), own).not.toContain(own)
    expect(dataOf("linker")).toEqual({ label: "linker", userInput: "a link" })
    const step = mocks.executeNode.mock.calls.find(([node]) => (node as { id: string }).id === "pre")
    expect(step, "the step was dispatched").toBeDefined()
    expect((step![1] as { imageUrl?: string }).imageUrl).toBe(VIEWERS_PHOTO)
  })

  it("the owner's own run reads the path as before", async () => {
    await runJob({ userId: OWNER }, photoPath("step"))
    expect(JSON.stringify(ranGraph())).toContain(PRE)
  })
})

describe("a viewer's run reads a sub-workflow whose graph holds a UGC video as one of the video's nodes", () => {
  const NESTED_RENDER = "https://cdn.example/nested-ugc.mp4"
  const AFTER = "https://cdn.example/after-nested.mp4"
  /** No UGC node of its own: a sub-workflow holding its last run's render, and a join made from it. */
  const parent = () => ({
    nodes: [
      { id: "nested", type: "sub-workflow", data: { label: "nested", workflowId: "wf-child", outputResults: { out: NESTED_RENDER }, generatedResults: [{ url: NESTED_RENDER }], activeResultIndex: 0, generatedVideoUrl: NESTED_RENDER } },
      { id: "after", type: "combine-videos", data: { label: "after", transition: "cut", generatedVideoUrl: AFTER, generatedResults: [{ url: AFTER }] } },
    ],
    edges: [{ id: "n1", source: "nested", target: "after", sourceHandle: "out", targetHandle: "in" }],
    settings: {},
    user_id: OWNER,
  })

  it("a run of only what follows it is never handed the stored render, nor the render made from it", async () => {
    mocks.workflows.set("wf-child", { nodes: [{ id: "c", type: "ugc-creator", data: { source: "sampled" } }], edges: [] })
    await runJob({ userId: VIEWER, shareLinkViewer: true, nodeIds: ["after"] }, parent() as never)
    const call = mocks.executeNode.mock.calls.find(([node]) => (node as { id: string }).id === "after")
    expect(call, "the join was dispatched").toBeDefined()
    for (const own of [NESTED_RENDER, AFTER]) {
      expect(JSON.stringify(call![1]), `its inputs: ${own}`).not.toContain(own)
      expect(JSON.stringify(call![3]), `the graph it ran in: ${own}`).not.toContain(own)
    }
  })

  it("the owner's own run hands it on as before", async () => {
    mocks.workflows.set("wf-child", { nodes: [{ id: "c", type: "ugc-creator", data: { source: "sampled" } }], edges: [] })
    await runJob({ userId: OWNER, nodeIds: ["after"] }, parent() as never)
    const call = mocks.executeNode.mock.calls.find(([node]) => (node as { id: string }).id === "after")
    expect(JSON.stringify(call![3])).toContain(NESTED_RENDER)
  })
})

describe("a viewer's run draws no picture of a character definition a node on the photo's path names", () => {
  const MINE = "https://cdn.example/author-character.png"
  const BRAND = "https://cdn.example/brand-mascot.png"
  /** The live graph with a Scene naming the author's character wired into the creator's photo, and a mascot generator elsewhere. */
  function graphWithCharacters() {
    const g = liveGraph()
    return {
      ...g,
      nodes: [
        ...g.nodes,
        { id: "scene", type: "scene", data: { label: "scene", characters: [{ assetId: "def-me", mood: "calm" }] } },
        { id: "mascot", type: "generate-image", data: { label: "mascot", prompt: "a mascot", characterDefinitionIds: ["def-brand"] } },
      ],
      edges: [...g.edges, { id: "s1", source: "scene", target: "creator", sourceHandle: "image", targetHandle: "photo" }],
      settings: {
        characterDefinitions: [
          { id: "def-me", name: "Me", type: "reference", referenceImageUrl: MINE },
          { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
        ],
      },
    }
  }
  /** The settings the run handed the nodes it dispatched. */
  const runSettings = () => ((mocks.executeNode.mock.calls[0] as unknown[])[5] as { workflowSettings?: { characterDefinitions?: unknown } }).workflowSettings

  it("the viewer's run: the one on the path has no picture; the other keeps its own", async () => {
    await runJob({ userId: VIEWER, shareLinkViewer: true, inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } }, graphWithCharacters())
    expect(runSettings()?.characterDefinitions).toEqual([
      { id: "def-me", name: "Me", type: "reference" },
      { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
    ])
  })

  it("the owner's own run draws on both as they are", async () => {
    await runJob({ userId: OWNER }, graphWithCharacters())
    expect(JSON.stringify(runSettings()?.characterDefinitions)).toContain(MINE)
  })
})

describe("a viewer's run whose referenced graph fails to load", () => {
  const LOGO = "https://cdn.example/brand-logo.png"
  /** A brief feeding a sub-workflow whose graph holds the brand's logo: no UGC video anywhere. */
  function briefIntoChild() {
    mocks.workflows.set("wf-child", { nodes: [{ id: "logo", type: "upload-image", data: { label: "logo", url: LOGO } }], edges: [] })
    return {
      nodes: [
        { id: "brief", type: "text-prompt", data: { label: "brief", text: "a red bike" } },
        { id: "sub", type: "sub-workflow", data: { label: "sub", workflowId: "wf-child" } },
      ],
      edges: [{ id: "b1", source: "brief", target: "sub", sourceHandle: "text", targetHandle: "in_i1" }],
      settings: {},
      user_id: OWNER,
    }
  }

  it("asks once more: a load that fails once is read, and nothing that feeds it is emptied", async () => {
    mocks.failing.set("wf-child", 1)
    await runJob({ userId: VIEWER, shareLinkViewer: true }, briefIntoChild())
    expect(dataOf("brief")).toEqual({ label: "brief", text: "a red bike" })
  })

  it("a load that fails twice is read as holding a UGC video: what feeds it runs emptied", async () => {
    mocks.failing.set("wf-child", 2)
    await runJob({ userId: VIEWER, shareLinkViewer: true }, briefIntoChild())
    expect(dataOf("brief")).toEqual({ label: "brief" })
  })
})
