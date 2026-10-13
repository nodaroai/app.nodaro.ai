/**
 * A presentation share link gets a published app's protection: the author's
 * photo and the author's UGC renders never reach anyone else.
 *
 * - `GET /v1/present/:token`: anyone but the owner receives every UGC node, and
 *   everything made from the UGC video, empty — never the creator's photo
 *   (`photoUrl`), image (`generatedImageUrl`) or the Upload Image wired into its
 *   photo input, never a take, a joined video, cards, Notes or a render or copy
 *   made from them — and the price they are shown is that graph's.
 * - `POST /v1/present/:token/run`: a viewer's run of a UGC Creator set to "My
 *   photo" with no photo of the viewer's own is refused before anything is
 *   written or queued, as the app runner refuses it (`ugc_photo_required`); the
 *   author's own stored photo never counts as the viewer's. A run that goes ahead
 *   is marked a share-link viewer's, so the orchestrator runs it on that same
 *   graph. The owner's own run through the link is theirs, as before.
 *
 * The URLs and text are placeholders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  queueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  estimate: vi.fn().mockResolvedValue(0),
  inserts: [] as Array<{ table: string; row: unknown }>,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: h.queueAdd } }))
vi.mock("@/ee/billing/credits.js", () => ({ estimateWorkflowCredits: h.estimate }))

import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"

const OWNER_ID = "00000000-0000-4000-8000-000000000001"
const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const EXEC_ID = "00000000-0000-4000-8000-000000000060"
const TOKEN = "share-token-abc"

const PHOTO = "https://cdn.example/author.png"
const VIEWERS_PHOTO = "https://cdn.example/viewer.png"
const TAKE = "https://cdn.example/take.mp4"
const JOINED = "https://cdn.example/joined.mp4"
const OUTRO = "https://cdn.example/outro.mp4"
const NOTES = "Clip 2 ran long."
const STAMP = { resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-09T09:00:40.000Z" }
const video = (url: string) => ({ generatedVideoUrl: url, generatedResults: [{ url, jobId: "job-1", timestamp: "2026-10-09T09:00:40.000Z" }], activeResultIndex: 0, ...STAMP })

/** The author's photo as the editor stores an upload of it. */
const authorsUpload = () => ({
  assetId: "asset-author", url: PHOTO, r2Url: PHOTO, thumbnailUrl: `${PHOTO}.jpg`, filename: "author.png",
  generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "2026-10-09T09:00:00.000Z" }], activeResultIndex: 0,
})

/**
 * The owner's live graph after a My photo run, Keep on: a UGC video, an upload wired into the
 * creator's photo pip on request (empty, or holding the author's photo as the template's "Your
 * photo" does), and on request a Preview of the creator's image and an outro after the join.
 */
function liveGraph(opts: { photoUpload?: boolean; authorsPhotoUpload?: boolean; madeFromIt?: boolean } = {}) {
  const nodes = [
    { id: "script", type: "ugc-script", position: { x: 0, y: 0 }, data: { label: "script", targetDurationSec: 15, keepResult: true, result: { plan: { v: 1, hook: "h" } }, ugcOutputs: { plan: '{"v":1}' }, ...STAMP } },
    {
      id: "creator", type: "ugc-creator", position: { x: 0, y: 0 },
      data: {
        label: "creator", source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, generatedImageUrl: PHOTO,
        ugcOutputs: { creator: '{"v":1}', image: PHOTO }, result: { v: 1, identityImages: [PHOTO] }, ...STAMP,
      },
    },
    { id: "clips", type: "ugc-clips", position: { x: 0, y: 0 }, data: { label: "clips", result: { tickets: [] }, ugcOutputs: { clips: "[]" } } },
    { id: "clip", type: "ugc-clip", position: { x: 0, y: 0 }, data: { label: "clip", ...video(TAKE), ugcOutputs: { "video-out": TAKE } } },
    { id: "cards", type: "ugc-cards", position: { x: 0, y: 0 }, data: { label: "cards", result: { report: NOTES }, ugcOutputs: { report: NOTES }, generatedText: NOTES } },
    { id: "join", type: "combine-videos", position: { x: 0, y: 0 }, data: { label: "join", transition: "cut", ...video(JOINED) } },
    ...(opts.photoUpload || opts.authorsPhotoUpload
      ? [{ id: "upload", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Your photo", ...(opts.authorsPhotoUpload ? authorsUpload() : {}) } }]
      : []),
    ...(opts.madeFromIt
      ? [
          { id: "outro", type: "combine-videos", position: { x: 0, y: 0 }, data: { label: "outro", transition: "cut", ...video(OUTRO) } },
          {
            id: "preview", type: "preview", position: { x: 0, y: 0 },
            data: { label: "preview", previewItems: [{ type: "image", value: PHOTO, itemKey: "creator:image", sourceNodeId: "creator", sourceHandle: "image", sourceNodeLabel: "creator", visible: true }], itemOrder: ["creator:image"] },
          },
        ]
      : []),
  ]
  const edges = [
    { id: "e1", source: "script", target: "creator", sourceHandle: "category", targetHandle: "category" },
    { id: "e2", source: "script", target: "clips", sourceHandle: "plan", targetHandle: "plan" },
    { id: "e3", source: "creator", target: "clips", sourceHandle: "creator", targetHandle: "creator" },
    { id: "e4", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
    { id: "e5", source: "clip", target: "join", sourceHandle: null, targetHandle: "in" },
    { id: "e6", source: "clips", target: "cards", sourceHandle: "plan-out", targetHandle: "plan" },
    { id: "e7", source: "join", target: "cards", sourceHandle: null, targetHandle: "video" },
    ...(opts.photoUpload || opts.authorsPhotoUpload ? [{ id: "e8", source: "upload", target: "creator", sourceHandle: null, targetHandle: "photo" }] : []),
    ...(opts.madeFromIt
      ? [
          { id: "e9", source: "join", target: "outro", sourceHandle: null, targetHandle: "in" },
          { id: "e10", source: "creator", target: "preview", sourceHandle: "image", targetHandle: "in" },
        ]
      : []),
  ]
  return { nodes, edges }
}

/** Every chained call returns the chain; awaiting it, or `.single()`, resolves `value`. Inserts are recorded. */
function chainResolving(table: string, value: unknown) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(value)
      if (prop === "insert") {
        return (row: unknown) => {
          h.inserts.push({ table, row })
          return new Proxy({}, handler)
        }
      }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

function serve(graph: { nodes: unknown[]; edges: unknown[]; settings?: unknown }) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") {
      return chainResolving(table, {
        data: { id: WORKFLOW_ID, name: "UGC", user_id: OWNER_ID, workspace_id: null, nodes: graph.nodes, edges: graph.edges, settings: graph.settings ?? {}, is_presentation_enabled: true },
        error: null,
      }) as never
    }
    // workflow_executions: the already-running probe reads `.length` off the data (none running); the insert's `.single()` reads `.id`.
    return chainResolving(table, { data: { id: EXEC_ID }, error: null }) as never
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.inserts.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const view = (userId?: string) =>
  app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers: userId ? { "x-user-id": userId } : {} })
const run = (userId: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `/v1/present/${TOKEN}/run`, headers: { "x-user-id": userId }, payload })

describe("GET /v1/present/:token — the author's UGC video never reaches anyone else", () => {
  it.each([
    ["a signed-out reader", undefined],
    ["a signed-in viewer", VIEWER_ID],
  ])("%s receives every UGC node and the video's join empty, with no photo, image, take, joined video or Notes", async (_who, userId) => {
    serve(liveGraph())
    const res = await view(userId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }>; isOwner: boolean }
    expect(body.isOwner).toBe(false)
    for (const own of [PHOTO, TAKE, JOINED, NOTES]) expect(res.body, own).not.toContain(own)
    const byId = new Map(body.nodes.map((n) => [n.id, n.data]))
    expect(byId.get("creator")).toEqual({ label: "creator", source: "photo", gender: "man", keepResult: false })
    expect(byId.get("script")).toEqual({ label: "script", targetDurationSec: 15, keepResult: false })
    expect(byId.get("join")).toEqual({ label: "join", transition: "cut" })
  })

  it.each([
    ["a signed-out reader", undefined],
    ["a signed-in viewer", VIEWER_ID],
  ])("%s never receives the author's photo from the upload wired into the creator, or anything made from the video", async (_who, userId) => {
    serve(liveGraph({ authorsPhotoUpload: true, madeFromIt: true }))
    const res = await view(userId)
    expect(res.statusCode).toBe(200)
    for (const own of [PHOTO, "asset-author", TAKE, JOINED, OUTRO, NOTES]) expect(res.body, own).not.toContain(own)
    const byId = new Map((res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.map((n) => [n.id, n.data]))
    expect(byId.get("upload")).toEqual({ label: "Your photo" })
    expect(byId.get("outro")).toEqual({ label: "outro", transition: "cut" })
    expect(byId.get("preview")).toEqual({ label: "preview", previewItems: [], itemOrder: ["creator:image"] })
    // And the price shown is that graph's.
    expect(JSON.stringify(h.estimate.mock.calls[0]![0])).not.toContain(PHOTO)
  })

  it("a viewer is shown the price of the graph they would run: nothing kept", async () => {
    serve(liveGraph())
    await view(VIEWER_ID)
    const priced = h.estimate.mock.calls[0]![0] as Array<{ id: string; data: Record<string, unknown> }>
    const creator = priced.find((n) => n.id === "creator")!
    expect(creator.data.keepResult).toBe(false)
    expect(JSON.stringify(priced)).not.toContain(PHOTO)
  })

  it("the owner receives their own graph whole", async () => {
    serve(liveGraph())
    const res = await view(OWNER_ID)
    const body = res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }>; isOwner: boolean }
    expect(body.isOwner).toBe(true)
    expect(body.nodes.find((n) => n.id === "creator")!.data.photoUrl).toBe(PHOTO)
    expect(body.nodes.find((n) => n.id === "clip")!.data.generatedVideoUrl).toBe(TAKE)
  })
})

describe("POST /v1/present/:token/run — a My photo creator needs the viewer's own photo", () => {
  it("a viewer who gives no photo is refused before anything is written or queued — the author's stored photo is not theirs", async () => {
    serve(liveGraph())
    const res = await run(VIEWER_ID)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { code: "ugc_photo_required", message: "This app needs a photo of you. Add one, then run it again." } })
    expect(h.inserts).toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("a viewer who gives their own photo runs, marked a share-link viewer's run", async () => {
    serve(liveGraph())
    const res = await run(VIEWER_ID, { inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })
    expect(res.statusCode).toBe(202)
    expect(h.queueAdd).toHaveBeenCalledTimes(1)
    expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ userId: VIEWER_ID, shareLinkViewer: true })
  })

  it("a viewer who gives no photo is refused even when the author's photo sits in the upload wired into the creator", async () => {
    serve(liveGraph({ authorsPhotoUpload: true }))
    const res = await run(VIEWER_ID)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.inserts).toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("a viewer's own photo runs over that upload, on the creator's card or on the upload", async () => {
    serve(liveGraph({ authorsPhotoUpload: true }))
    expect((await run(VIEWER_ID, { inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })).statusCode).toBe(202)
    expect((await run(VIEWER_ID, { inputOverrides: { upload: { url: VIEWERS_PHOTO } } })).statusCode).toBe(202)
  })

  it("a viewer's photo given to an upload wired into the creator's photo counts", async () => {
    serve(liveGraph({ photoUpload: true }))
    const res = await run(VIEWER_ID, { inputOverrides: { upload: { url: VIEWERS_PHOTO } } })
    expect(res.statusCode).toBe(202)
  })

  it("a viewer who switches the creator away from My photo needs none", async () => {
    serve(liveGraph())
    const res = await run(VIEWER_ID, { inputOverrides: { creator: { source: "sampled" } } })
    expect(res.statusCode).toBe(202)
  })

  it("the owner's own run through the link is theirs: their photo counts, and it is not a viewer's run", async () => {
    serve(liveGraph())
    const res = await run(OWNER_ID)
    expect(res.statusCode).toBe(202)
    expect(h.queueAdd.mock.calls[0]![1]).not.toHaveProperty("shareLinkViewer")
  })
})

describe("the template's own wiring: the author's photo in \"Your photo\" never reaches a viewer", () => {
  /** The template as its author left it: their photo in "Your photo", the creator on My photo, the video rendered. */
  async function authorsTemplate() {
    const doc = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json"), "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: unknown[]
    }
    const nodes = doc.nodes.map((n) =>
      n.id === "photo"
        ? { ...n, data: { ...n.data, ...authorsUpload() } }
        : n.id === "creator"
          ? { ...n, data: { ...n.data, source: "photo", photoUrl: PHOTO, keepResult: true, generatedImageUrl: PHOTO, ugcOutputs: { creator: '{"v":1}', image: PHOTO }, result: { v: 1, identityImages: [PHOTO] } } }
          : n.id === "captions"
            ? { ...n, data: { ...n.data, ...video(JOINED) } }
            : n,
    )
    return { nodes, edges: doc.edges }
  }

  it("the view of anyone but the owner carries no photo and no render", async () => {
    serve(await authorsTemplate())
    const res = await view(VIEWER_ID)
    expect(res.statusCode).toBe(200)
    for (const own of [PHOTO, "asset-author", JOINED]) expect(res.body, own).not.toContain(own)
  })

  it("a viewer's run with no photo of their own is refused; their own photo runs", async () => {
    serve(await authorsTemplate())
    const refused = await run(VIEWER_ID)
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.code).toBe("ugc_photo_required")
    expect(h.queueAdd).not.toHaveBeenCalled()
    expect((await run(VIEWER_ID, { inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })).statusCode).toBe(202)
  })
})

describe("POST /v1/present/:token/run — a sub-workflow the viewer's run executes is read as published", () => {
  /** The parent: one sub-workflow node, unless told otherwise. The child (the author's own workflow) is served by its id. */
  function serveWithChild(
    child: { nodes: unknown[]; edges: unknown[] },
    parentGraph: { nodes: unknown[]; edges: unknown[] } = { nodes: [{ id: "sub", type: "sub-workflow", position: { x: 0, y: 0 }, data: { label: "sub", workflowId: "wf-child" } }], edges: [] },
  ) {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      let id: string | undefined
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop) {
          if (prop === "then") {
            const value =
              table !== "workflows"
                ? { data: { id: EXEC_ID }, error: null }
                : id === "wf-child"
                  ? { data: { nodes: child.nodes, edges: child.edges }, error: null }
                  : {
                      data: {
                        id: WORKFLOW_ID, name: "Parent", user_id: OWNER_ID, workspace_id: null, settings: {}, is_presentation_enabled: true,
                        nodes: parentGraph.nodes,
                        edges: parentGraph.edges,
                      },
                      error: null,
                    }
            return (resolve: (v: unknown) => void) => resolve(value)
          }
          if (prop === "insert") {
            return (row: unknown) => {
              h.inserts.push({ table, row })
              return new Proxy({}, handler)
            }
          }
          if (prop === "eq") {
            return (column: string, value: unknown) => {
              if (column === "id") id = value as string
              return new Proxy({}, handler)
            }
          }
          return () => new Proxy({}, handler)
        },
      }
      return new Proxy({}, handler) as never
    })
  }
  const creator = { id: "creator", type: "ugc-creator", data: { label: "creator", source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, result: { v: 1, identityImages: [PHOTO] } } }

  it("a nested My photo creator with only the author's photo is refused, before anything is written", async () => {
    serveWithChild({
      nodes: [creator, { id: "upload", type: "upload-image", data: { label: "Your photo", ...authorsUpload() } }],
      edges: [{ id: "c1", source: "upload", target: "creator", sourceHandle: "image", targetHandle: "photo" }],
    })
    const res = await run(VIEWER_ID, { runTarget: "sub-workflow", subWorkflowNodeId: "sub" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("ugc_photo_required")
    expect(h.inserts).toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("a nested creator fed through the sub-workflow's input: refused with nothing of the viewer's above it; runs once the viewer fills what feeds the sub-workflow node", async () => {
    const child = {
      nodes: [creator, { id: "in", type: "sub-workflow-input", data: { label: "in" } }],
      edges: [{ id: "c1", source: "in", target: "creator", sourceHandle: "image", targetHandle: "photo" }],
    }
    serveWithChild(child)
    expect((await run(VIEWER_ID)).statusCode).toBe(400)
    const parentGraph = {
      nodes: [
        { id: "sub", type: "sub-workflow", position: { x: 0, y: 0 }, data: { label: "sub", workflowId: "wf-child" } },
        { id: "upload", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Your photo", ...authorsUpload() } },
      ],
      edges: [{ id: "s1", source: "upload", target: "sub", sourceHandle: "image", targetHandle: "in_i1" }],
    }
    serveWithChild(child, parentGraph)
    // The author's image in the upload is not the viewer's.
    expect((await run(VIEWER_ID)).statusCode).toBe(400)
    expect(h.inserts).toEqual([])
    expect((await run(VIEWER_ID, { inputOverrides: { upload: { url: VIEWERS_PHOTO } } })).statusCode).toBe(202)
  })

  it("the owner's own run through the link is theirs", async () => {
    serveWithChild({ nodes: [creator], edges: [] })
    const res = await run(OWNER_ID)
    expect(res.statusCode).toBe(202)
  })

  it("a creator whose photo comes from a sub-workflow: refused when its output comes from an upload inside it, or from a node inside it that makes the image; the viewer's photo on the creator runs", async () => {
    const parentGraph = {
      nodes: [
        { id: "sub", type: "sub-workflow", position: { x: 0, y: 0 }, data: { label: "sub", workflowId: "wf-child" } },
        { id: "creator", type: "ugc-creator", position: { x: 0, y: 0 }, data: { label: "creator", source: "photo", gender: "man" } },
      ],
      edges: [{ id: "s1", source: "sub", target: "creator", sourceHandle: "out_p1", targetHandle: "photo" }],
    }
    const out = { id: "out", type: "sub-workflow-output", data: { ports: [{ id: "p1", mediaType: "image" }] } }
    serveWithChild({ nodes: [{ id: "upload", type: "upload-image", data: { label: "Your photo", ...authorsUpload() } }, out], edges: [{ id: "c1", source: "upload", target: "out", sourceHandle: "image", targetHandle: "p1" }] }, parentGraph)
    const refused = await run(VIEWER_ID)
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.code).toBe("ugc_photo_required")
    expect(h.inserts).toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
    serveWithChild({ nodes: [{ id: "gen", type: "generate-image", data: {} }, out], edges: [{ id: "c1", source: "gen", target: "out", sourceHandle: "image", targetHandle: "p1" }] }, parentGraph)
    expect((await run(VIEWER_ID)).statusCode).toBe(400)
    expect((await run(VIEWER_ID, { inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })).statusCode).toBe(202)
  })
})

describe("every node on a path to the creator's photo: what anyone but the owner is shown, and what a viewer's run needs", () => {
  const UPSCALED_FACE = "https://cdn.example/upscaled-author.png"
  const SENT = "https://cdn.example/teleported-author.png"
  const LINK_TEXT = "https://cdn.example/author-face-by-link.png"
  /** The creator's photo comes from the author's upload through a step (an upscale) or a teleport pair; on request the upload is one of the link's inputs. */
  function photoPath(via: "step" | "teleport", asInput = false) {
    const { nodes, edges } = liveGraph()
    const extra =
      via === "step"
        ? [{ id: "step", type: "upscale-image", position: { x: 0, y: 0 }, data: { label: "step", upscaleFactor: 2, ...video(UPSCALED_FACE) } }]
        : [
            { id: "send", type: "teleport-send", position: { x: 0, y: 0 }, data: { label: "send", channel: "P", result: SENT } },
            { id: "recv", type: "teleport-receive", position: { x: 0, y: 0 }, data: { label: "recv", channel: "P", result: SENT } },
          ]
    const wires =
      via === "step"
        ? [{ id: "p1", source: "upload", target: "step", sourceHandle: "image", targetHandle: "image" }, { id: "p2", source: "step", target: "creator", sourceHandle: "image", targetHandle: "photo" }]
        : [{ id: "p1", source: "upload", target: "send", sourceHandle: "image", targetHandle: "in" }, { id: "p2", source: "recv", target: "creator", sourceHandle: "out", targetHandle: "photo" }]
    return {
      nodes: [
        ...nodes,
        { id: "upload", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Your photo", ...authorsUpload() } },
        // The upload takes the photo's link from a Text node.
        { id: "linkText", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "linkText", text: LINK_TEXT } },
        ...extra,
      ],
      edges: [...edges, ...wires, { id: "p9", source: "linkText", target: "upload", sourceHandle: "prompt", targetHandle: "in" }],
      // The link shows the creator (as the UGC template does), and on request the upload too.
      settings: { presentationSettings: { runTarget: "workflow", inputItems: [...(asInput ? [{ type: "node", nodeId: "upload" }] : []), { type: "node", nodeId: "creator" }] } },
    }
  }
  const OWN = [PHOTO, "asset-author", UPSCALED_FACE, SENT, LINK_TEXT]

  it.each([
    ["a signed-out reader", "step", undefined],
    ["a signed-in viewer", "step", VIEWER_ID],
    ["a signed-out reader", "teleport", undefined],
    ["a signed-in viewer", "teleport", VIEWER_ID],
  ] as const)("%s, the photo through a %s: none of it is shown, nor priced", async (_who, via, userId) => {
    serve(photoPath(via))
    const res = await view(userId)
    expect(res.statusCode).toBe(200)
    for (const own of OWN) expect(res.body, own).not.toContain(own)
    const byId = new Map((res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.map((n) => [n.id, n.data]))
    expect(byId.get("upload")).toEqual({ label: "Your photo" })
    // The Text node handing the upload its link loses the link.
    expect(byId.get("linkText")).toEqual({ label: "linkText" })
    if (via === "step") expect(byId.get("step")).toEqual({ label: "step", upscaleFactor: 2 })
    else expect(byId.get("recv")).toEqual({ label: "recv", channel: "P" })
    for (const own of OWN) expect(JSON.stringify(h.estimate.mock.calls[0]![0]), own).not.toContain(own)
  })

  it("the upload as one of the link's inputs is still shown empty: it is the viewer's to fill, and what feeds it is empty too", async () => {
    const graph = photoPath("step", true)
    const LINK = "https://cdn.example/a-link.png"
    graph.nodes.push({ id: "linker", type: "llm-chat", position: { x: 0, y: 0 }, data: { label: "linker", userInput: "a link", generatedText: LINK } } as never)
    graph.edges.push({ id: "p0", source: "linker", target: "upload", sourceHandle: "text", targetHandle: "in" })
    serve(graph)
    const res = await view(VIEWER_ID)
    for (const own of [...OWN, LINK]) expect(res.body, own).not.toContain(own)
    const byId = new Map((res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.map((n) => [n.id, n.data]))
    expect(byId.get("upload")).toEqual({ label: "Your photo" })
    expect(byId.get("linker")).toEqual({ label: "linker", userInput: "a link" })
    expect(byId.get("linkText")).toEqual({ label: "linkText" })
  })

  it.each(["step", "teleport"] as const)("a viewer's run with the photo through a %s: refused with none of their own; their photo on the upload or the creator runs", async (via) => {
    serve(photoPath(via, true))
    const refused = await run(VIEWER_ID)
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.code).toBe("ugc_photo_required")
    expect(h.inserts).toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
    expect((await run(VIEWER_ID, { inputOverrides: { upload: { url: VIEWERS_PHOTO } } })).statusCode).toBe(202)
    expect((await run(VIEWER_ID, { inputOverrides: { creator: { photoUrl: VIEWERS_PHOTO } } })).statusCode).toBe(202)
  })

  it("the owner sees their own graph whole", async () => {
    serve(photoPath("step"))
    const res = await view(OWNER_ID)
    expect(res.body).toContain(UPSCALED_FACE)
  })
})

describe("GET /v1/present/:token — a sub-workflow whose graph holds a UGC video is read as one of the video's nodes", () => {
  const NESTED_RENDER = "https://cdn.example/nested-ugc.mp4"
  const AFTER = "https://cdn.example/after-nested.mp4"
  /** The parent holds no UGC node of its own: a sub-workflow holding its last run's render, and a join made from it. The child is served by its id. */
  function serveParent(child: { nodes: unknown[]; edges: unknown[] }) {
    const parent = {
      id: WORKFLOW_ID, name: "Parent", user_id: OWNER_ID, workspace_id: null, settings: {}, is_presentation_enabled: true,
      nodes: [
        { id: "nested", type: "sub-workflow", position: { x: 0, y: 0 }, data: { label: "nested", workflowId: "wf-child", outputResults: { out: NESTED_RENDER }, generatedResults: [{ url: NESTED_RENDER, jobId: "sub-1", timestamp: "t" }], activeResultIndex: 0 } },
        { id: "after", type: "combine-videos", position: { x: 0, y: 0 }, data: { label: "after", transition: "cut", ...video(AFTER) } },
      ],
      edges: [{ id: "n1", source: "nested", target: "after", sourceHandle: "out", targetHandle: "in" }],
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      let id: string | undefined
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop) {
          if (prop === "then") {
            const value = table !== "workflows" ? { data: { id: EXEC_ID }, error: null } : id === "wf-child" ? { data: child, error: null } : { data: parent, error: null }
            return (resolve: (v: unknown) => void) => resolve(value)
          }
          if (prop === "eq") {
            return (column: string, value: unknown) => {
              if (column === "id") id = value as string
              return new Proxy({}, handler)
            }
          }
          return () => new Proxy({}, handler)
        },
      }
      return new Proxy({}, handler) as never
    })
  }
  const UGC_CHILD = { nodes: [{ id: "c", type: "ugc-creator", data: { source: "sampled" } }, { id: "k", type: "ugc-clip", data: {} }], edges: [] }

  it.each([
    ["a signed-out reader", undefined],
    ["a signed-in viewer", VIEWER_ID],
  ])("%s receives it and what is made from it empty, and is priced on that graph", async (_who, userId) => {
    serveParent(UGC_CHILD)
    const res = await view(userId)
    expect(res.statusCode).toBe(200)
    for (const own of [NESTED_RENDER, AFTER]) expect(res.body, own).not.toContain(own)
    const byId = new Map((res.json() as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.map((n) => [n.id, n.data]))
    expect(byId.get("nested")).toEqual({ label: "nested", workflowId: "wf-child" })
    expect(byId.get("after")).toEqual({ label: "after", transition: "cut" })
    for (const own of [NESTED_RENDER, AFTER]) expect(JSON.stringify(h.estimate.mock.calls[0]![0]), own).not.toContain(own)
  })

  it("the owner receives it whole; a sub-workflow holding no UGC node keeps its outputs for anyone", async () => {
    serveParent(UGC_CHILD)
    expect((await view(OWNER_ID)).body).toContain(NESTED_RENDER)
    serveParent({ nodes: [{ id: "x", type: "generate-video", data: {} }], edges: [] })
    expect((await view(VIEWER_ID)).body).toContain(NESTED_RENDER)
  })
})
