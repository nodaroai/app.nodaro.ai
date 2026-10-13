/**
 * `/v1/component/execute` — a component whose UGC Creator is set to "My photo".
 *
 * Publishing strips the author's own photo from a component as from an app, so a
 * photo reaches a component's run only from its caller: an Upload Image the
 * component takes as an input, wired into the creator's photo pip. A run that
 * gives none would pay for the script before it and then stop at the creator, so
 * it is refused before the wrapper job exists or anything runs, with the app
 * runner's own refusal (`ugc_photo_required`). The URLs are placeholders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  executeAppRun: vi.fn(),
  insertJob: vi.fn(),
  insertJobIdempotent: vi.fn(),
  snapshotNodes: [] as Array<Record<string, unknown>>,
  snapshotEdges: [] as Array<Record<string, unknown>>,
  /** A sub-workflow's graph: the component author's own workflow. */
  child: null as { nodes: unknown[]; edges: unknown[] } | null,
}))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: h.insertJob, insertJobIdempotent: h.insertJobIdempotent, billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }) }))
vi.mock("@/lib/supabase.js", () => {
  function chain(result: () => unknown) {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit", "update", "insert"]) c[m] = vi.fn().mockReturnValue(c)
    c.single = vi.fn(async () => ({ data: result(), error: null }))
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [result()], error: null })
    return c
  }
  const appRow = () => ({
    id: "app-1",
    workflow_id: "wf-inner",
    creator_id: "author-1",
    name: "Presenter video",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: h.snapshotNodes,
    snapshot_edges: h.snapshotEdges,
  })
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) =>
        chain(table === "published_apps" ? appRow : table === "workflows" && h.child ? () => h.child : () => ({ id: "row-1" })),
      ),
    },
  }
})

import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { stripUgcPublishState } from "@nodaro/render-rules"
import { componentExecuteRoutes } from "../component-execute.js"

const PHOTO = "https://cdn.example/caller.png"

/** A published component: script → My photo creator → clips, as publishing stripped it; an upload wired into the photo pip on request. */
function publish(opts: { photoUpload?: boolean; source?: string } = {}) {
  h.snapshotNodes = [
    { id: "script", type: "ugc-script", data: { targetDurationSec: 15, keepResult: false } },
    { id: "creator", type: "ugc-creator", data: { source: opts.source ?? "photo", gender: "woman", keepResult: false } },
    { id: "clips", type: "ugc-clips", data: {} },
    ...(opts.photoUpload ? [{ id: "upload", type: "upload-image", data: { label: "Your photo" } }] : []),
  ]
  h.snapshotEdges = [
    { source: "script", target: "creator", sourceHandle: "category", targetHandle: "category" },
    { source: "script", target: "clips", sourceHandle: "plan", targetHandle: "plan" },
    { source: "creator", target: "clips", sourceHandle: "creator", targetHandle: "creator" },
    ...(opts.photoUpload ? [{ source: "upload", target: "creator", sourceHandle: null, targetHandle: "photo" }] : []),
  ]
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  h.executeAppRun.mockResolvedValue({ executionId: "exec-child", appRunId: "run-1" })
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

const run = (inputOverrides?: Record<string, Record<string, unknown>>) =>
  app.inject({ method: "POST", url: "/v1/component/execute", payload: { appSlug: "presenter-video", ...(inputOverrides ? { inputOverrides } : {}) } })

describe("POST /v1/component/execute — a My photo creator needs the caller's photo", () => {
  it("a run that gives no photo is refused: 400 ugc_photo_required, no wrapper job, no run", async () => {
    publish()
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { code: "ugc_photo_required", message: "This app needs a photo of you. Add one, then run it again." } })
    expect(h.insertJob).not.toHaveBeenCalled()
    expect(h.insertJobIdempotent).not.toHaveBeenCalled()
    expect(h.executeAppRun).not.toHaveBeenCalled()
  })

  it("an upload the component takes as an input, given the caller's photo, runs", async () => {
    publish({ photoUpload: true })
    const res = await run({ upload: { url: PHOTO } })
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(h.executeAppRun).toHaveBeenCalledTimes(1))
  })

  it("the same upload given nothing is refused", async () => {
    publish({ photoUpload: true })
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
  })

  it("a creator the caller switches to an AI creator needs no photo", async () => {
    publish()
    const res = await run({ creator: { source: "sampled" } })
    expect(res.statusCode).toBe(202)
  })

  it("an AI creator needs no photo", async () => {
    publish({ source: "sampled" })
    const res = await run()
    expect(res.statusCode).toBe(202)
  })

  it("the author's photo left in the upload wired into the creator never counts: publishing empties it, and a run with none of the caller's is refused", async () => {
    const AUTHOR = "https://cdn.example/author.png"
    publish({ photoUpload: true })
    h.snapshotNodes = stripUgcPublishState(
      h.snapshotNodes.map((node) => (node.id === "upload" ? { ...node, data: { label: "Your photo", url: AUTHOR, r2Url: AUTHOR, assetId: "asset-author", generatedResults: [{ url: AUTHOR }], activeResultIndex: 0 } } : node)),
      h.snapshotEdges as Array<{ source: string; target: string; targetHandle?: string | null }>,
    )
    expect(JSON.stringify(h.snapshotNodes)).not.toContain(AUTHOR)
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.insertJob).not.toHaveBeenCalled()
  })

  it("the author's photo behind a step (an upscale) never counts: publishing empties the path, and a run with none of the caller's is refused; the caller's on the upload runs", async () => {
    const AUTHOR = "https://cdn.example/author.png"
    const UPSCALED = "https://cdn.example/author-upscaled.png"
    publish()
    const nodes = [
      ...h.snapshotNodes,
      { id: "upload", type: "upload-image", data: { label: "Your photo", url: AUTHOR, r2Url: AUTHOR, assetId: "asset-author", generatedResults: [{ url: AUTHOR }], activeResultIndex: 0 } },
      { id: "step", type: "upscale-image", data: { upscaleFactor: 2, generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED }], activeResultIndex: 0 } },
    ]
    h.snapshotEdges = [...h.snapshotEdges, { source: "upload", target: "step", targetHandle: "image" }, { source: "step", target: "creator", targetHandle: "photo" }]
    h.snapshotNodes = stripUgcPublishState(nodes, h.snapshotEdges as Array<{ source: string; target: string; targetHandle?: string | null }>)
    for (const own of [AUTHOR, UPSCALED]) expect(JSON.stringify(h.snapshotNodes), own).not.toContain(own)
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.insertJob).not.toHaveBeenCalled()
    expect((await run({ upload: { url: PHOTO } })).statusCode).toBe(202)
  })

  it("a creator whose photo comes from a sub-workflow: refused when its output comes from an upload inside it, or from a node inside it that makes the image; the caller's photo on the creator runs", async () => {
    h.snapshotNodes = [{ id: "sub", type: "sub-workflow", data: { workflowId: "wf-child" } }, { id: "creator", type: "ugc-creator", data: { source: "photo", gender: "woman" } }]
    h.snapshotEdges = [{ source: "sub", target: "creator", sourceHandle: "out_p1", targetHandle: "photo" }]
    const out = { id: "out", type: "sub-workflow-output", data: { ports: [{ id: "p1", mediaType: "image" }] } }
    h.child = { nodes: [{ id: "up", type: "upload-image", data: { url: "https://cdn.example/author.png" } }, out], edges: [{ source: "up", target: "out", targetHandle: "p1" }] }
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.insertJob).not.toHaveBeenCalled()
    h.child = { nodes: [{ id: "gen", type: "generate-image", data: {} }, out], edges: [{ source: "gen", target: "out", targetHandle: "p1" }] }
    expect((await run()).statusCode).toBe(400)
    expect((await run({ creator: { photoUrl: "https://cdn.example/caller.png" } })).statusCode).toBe(202)
  })

  it("a My photo creator inside a sub-workflow the component runs needs the caller's photo", async () => {
    h.snapshotNodes = [{ id: "sub", type: "sub-workflow", data: { workflowId: "wf-child" } }]
    h.snapshotEdges = []
    h.child = {
      nodes: [{ id: "creator", type: "ugc-creator", data: { source: "photo", gender: "man", photoUrl: "https://cdn.example/author.png" } }],
      edges: [],
    }
    try {
      const res = await run()
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("ugc_photo_required")
      expect(h.insertJob).not.toHaveBeenCalled()
      // Fed through the sub-workflow's input: a photo once the caller gives a value to what feeds the sub-workflow node.
      h.child = {
        nodes: [{ id: "creator", type: "ugc-creator", data: { source: "photo", gender: "man" } }, { id: "in", type: "sub-workflow-input", data: {} }],
        edges: [{ source: "in", target: "creator", targetHandle: "photo" }],
      }
      expect((await run()).statusCode).toBe(400)
      h.snapshotNodes = [{ id: "sub", type: "sub-workflow", data: { workflowId: "wf-child" } }, { id: "up", type: "upload-image", data: {} }]
      h.snapshotEdges = [{ source: "up", target: "sub", targetHandle: "in_i1" }]
      expect((await run()).statusCode).toBe(400)
      expect((await run({ up: { url: "https://cdn.example/caller.png" } })).statusCode).toBe(202)
    } finally {
      h.child = null
    }
  })

  it("the template's own wiring, published as a component: the author's photo in \"Your photo\" never counts; the caller's does", async () => {
    const AUTHOR = "https://cdn.example/author.png"
    const doc = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json"), "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: Array<Record<string, unknown>>
    }
    const authors = doc.nodes.map((x) =>
      x.id === "photo"
        ? { ...x, data: { ...x.data, url: AUTHOR, r2Url: AUTHOR, assetId: "asset-author", generatedResults: [{ url: AUTHOR }], activeResultIndex: 0 } }
        : x.id === "creator" ? { ...x, data: { ...x.data, source: "photo" } } : x,
    )
    h.snapshotNodes = stripUgcPublishState(authors, doc.edges as Array<{ source?: string; target?: string; targetHandle?: string | null }>)
    h.snapshotEdges = doc.edges
    expect(JSON.stringify(h.snapshotNodes)).not.toContain(AUTHOR)
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.insertJob).not.toHaveBeenCalled()
    expect((await run({ creator: { photoUrl: PHOTO } })).statusCode).toBe(202)
  })

  it("the caller's photo on the creator itself counts", async () => {
    publish()
    const res = await run({ creator: { photoUrl: PHOTO } })
    expect(res.statusCode).toBe(202)
  })
})
