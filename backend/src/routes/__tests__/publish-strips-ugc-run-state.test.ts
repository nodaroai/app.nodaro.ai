import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * A published snapshot is read by every runner (an app or a component) or cloned
 * by every user (a template). A UGC node's run state — the publisher's kept
 * creator, the last plan, the clip tickets, the takes, the cards and Notes — and
 * everything made from the UGC video are the publisher's, and so is the photo in
 * the Upload Image wired into the creator's photo input: publishing strips them
 * from every lane, so published UGC nodes start empty and render fresh for each
 * user. No lane's fallback preview may pick a stripped render or the author's
 * photo; a preview the author chooses is theirs and ships as they chose it,
 * whatever it shows. The listing is
 * priced on what is published — what its runners run. The values below are
 * placeholders.
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

// A template's preview is a durable copy of its source: the copy names the source it was made from.
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage.js")>()),
  copyToTemplatePreview: vi.fn(async (source: string) => `durable:${source}`),
}))

// The UGC node types are registered by a later task; the availability guard
// only needs to let them through here.
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-deny.js")>()),
  findUnpublishableNodeTypes: () => [],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { estimateWorkflowListingCredits } from "../../ee/billing/credits.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

const PHOTO = "https://cdn.example/author.png"
const PHOTO_THUMB = "https://cdn.example/author-thumb.png"
const TAKE = "https://cdn.example/take.mp4"
const OUTRO = "https://cdn.example/outro.mp4"
const JOINED = "https://cdn.example/joined.mp4"
const CARDED = "https://cdn.example/carded.mp4"
const CAPTIONED = "https://cdn.example/captioned.mp4"
const NOTES = "Clip 2 ran long."
const OUTSIDE = "https://cdn.example/outside.mp4"
const RUN_STAMP = { resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-09T09:00:40.000Z" }

/** A video result as every video node holds one: the take, its row, the stamp. */
const rendered = (url: string) => ({
  generatedVideoUrl: url,
  generatedResults: [{ url, jobId: "job-1", timestamp: "2026-10-09T09:00:40.000Z" }],
  activeResultIndex: 0,
  executionStatus: "completed",
  ...RUN_STAMP,
})

// The UGC video after a My photo run. The author's photo upload and the video's nodes come first, so
// a fallback that read the author's own nodes would pick the photo, the take, the joined or the
// captioned video, or the outro made from it — never the node outside it.
const WORKFLOW_NODES: Array<{ id: string; type: string; data: Record<string, unknown> }> = [
  // The author's photo, as the editor stores an upload of it, wired into the creator's photo input.
  {
    id: "u",
    type: "upload-image",
    data: {
      label: "Your photo", assetId: "asset-author", url: PHOTO, r2Url: PHOTO, thumbnailUrl: PHOTO_THUMB, filename: "author.png", mimeType: "image/png",
      generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "2026-10-09T09:00:00.000Z", thumbnailUrl: PHOTO_THUMB }], activeResultIndex: 0,
    },
  },
  // The author's own photo never ships — nor the state a My photo run wrote from it: the
  // creator's image IS that photo, and so is its result's identity image.
  {
    id: "c",
    type: "ugc-creator",
    data: {
      source: "photo",
      gender: "man",
      photoUrl: PHOTO,
      keepResult: true,
      generatedImageUrl: PHOTO,
      ugcOutputs: { creator: '{"v":1}', image: PHOTO },
      result: { v: 1, identityImages: [PHOTO] },
      executionStatus: "completed",
      ...RUN_STAMP,
    },
  },
  { id: "s", type: "ugc-script", data: { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h" } }, ugcOutputs: { plan: '{"v":1}' }, ...RUN_STAMP } },
  { id: "l", type: "ugc-clips", data: { voiceId: "placeholder", result: { tickets: [] }, quote: { lines: [] }, __listResults: ["{}"], ugcOutputs: { "plan-out": "{}" }, ...RUN_STAMP } },
  { id: "k", type: "ugc-clip", data: { ...rendered(TAKE), __listResults: [TAKE], __listResultMeta: [{ warnings: [] }], clipWarnings: [], durationSec: 7, ugcOutputs: { "video-out": TAKE } } },
  { id: "d", type: "ugc-cards", data: { result: { layerPlan: "[]", captionPlan: "{}", report: NOTES }, ugcOutputs: { report: NOTES }, generatedText: NOTES, text: NOTES, ...RUN_STAMP } },
  { id: "j", type: "combine-videos", data: { transition: "cut", audioMode: "keep", ...rendered(JOINED) } },
  { id: "o", type: "video-overlay", data: { layerCount: 0, ...rendered(CARDED), warnings: [], width: 720, height: 1280, durationSec: 15, resultCompositionKey: "key" } },
  { id: "p", type: "add-captions", data: { style: "body", ...rendered(CAPTIONED) } },
  // Made from the UGC video: an outro after the captions, and a Preview of the creator's image.
  { id: "x", type: "combine-videos", data: { transition: "cut", ...rendered(OUTRO) } },
  {
    id: "v",
    type: "preview",
    data: { previewItems: [{ type: "image", value: PHOTO, itemKey: "c:image", sourceNodeId: "c", sourceHandle: "image", sourceNodeLabel: "c", visible: true }], itemOrder: ["c:image"] },
  },
  // Outside the UGC video: its results are its own, and ship as any node's do.
  { id: "g", type: "generate-video", data: { prompt: "a cat", ...rendered(OUTSIDE) } },
  { id: "t", type: "text-prompt", data: { text: "keep", result: "keep" } },
]

const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle, sourceHandle })
const WORKFLOW_EDGES = [
  e("u", "c", "photo", "image"),
  e("s", "c", "category", "category"), e("s", "l", "plan"), e("c", "l", "creator"), e("l", "k", "clip", "clips"),
  e("k", "j", "in"), e("k", "d", "notes"), e("l", "d", "plan", "plan-out"), e("l", "d", "transcript", "transcript"),
  e("j", "d", "video"), e("j", "o", "video"), e("d", "o", "layerPlan", "layerPlan"), e("d", "p", "captionPlan", "captionPlan"), e("o", "p", "in"),
  e("p", "x", "in"), e("c", "v", "in", "image"),
]

const STRIPPED = [
  { id: "u", type: "upload-image", data: { label: "Your photo" } },
  { id: "c", type: "ugc-creator", data: { source: "photo", gender: "man", keepResult: false } },
  { id: "s", type: "ugc-script", data: { targetDurationSec: 20, keepResult: false } },
  { id: "l", type: "ugc-clips", data: { voiceId: "placeholder" } },
  { id: "k", type: "ugc-clip", data: {} },
  { id: "d", type: "ugc-cards", data: {} },
  { id: "j", type: "combine-videos", data: { transition: "cut", audioMode: "keep" } },
  { id: "o", type: "video-overlay", data: { layerCount: 0 } },
  { id: "p", type: "add-captions", data: { style: "body" } },
  { id: "x", type: "combine-videos", data: { transition: "cut" } },
  { id: "v", type: "preview", data: { previewItems: [], itemOrder: ["c:image"] } },
  WORKFLOW_NODES[11],
  WORKFLOW_NODES[12],
]

/** Everything of the author's UGC video a stranger must never receive. */
const AUTHORS_OWN = [PHOTO, PHOTO_THUMB, "asset-author", TAKE, JOINED, CARDED, CAPTIONED, NOTES, OUTRO]

/** The nodes the listing was priced on: the published ones (Keep off, no kept script or creator, no photo). */
function pricedNodes(): Array<{ id: string; data: Record<string, unknown> }> {
  const call = vi.mocked(estimateWorkflowListingCredits).mock.calls.at(-1)
  expect(call, "the listing was priced").toBeDefined()
  return call![0] as unknown as Array<{ id: string; data: Record<string, unknown> }>
}
function expectPricedOnWhatShips(): void {
  const priced = pricedNodes()
  expect(priced).toEqual(STRIPPED)
  expect(priced.find((n) => n.id === "s")!.data).toEqual({ targetDurationSec: 20, keepResult: false })
  expect(priced.find((n) => n.id === "c")!.data.keepResult).toBe(false)
}

type Written = { table: string; op: "insert" | "update"; payload: Record<string, unknown> }

/** A sub-workflow id whose read fails with an error. */
const FAILING_CHILD = "wf-read-fails"

/** Every table answers every query chain; inserts and updates are recorded. */
function serve(
  written: Written[],
  existingTemplate: Record<string, unknown> | null = null,
  graph: { nodes: unknown[]; edges: unknown[]; settings?: unknown; thumbnailUrl?: string; templateId?: string } = { nodes: WORKFLOW_NODES, edges: WORKFLOW_EDGES },
  /** The author's other workflows a sub-workflow node refers to, by id. */
  children: Record<string, { nodes: unknown[]; edges: unknown[] }> = {},
): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    let id: unknown
    const parent =
      table === "workflows"
        ? { id: WORKFLOW_ID, user_id: USER, workspace_id: null, visibility: "private", nodes: graph.nodes, edges: graph.edges, settings: graph.settings ?? {}, thumbnail_url: graph.thumbnailUrl ?? null, template_id: graph.templateId ?? null }
        : table === "workflow_templates"
          ? existingTemplate
          : null
    const rowOf = () => (table === "workflows" && typeof id === "string" && Object.hasOwn(children, id) ? children[id] : parent)
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.eq = vi.fn((column: string, value: unknown) => {
      if (column === "id") id = value
      return chain
    })
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "insert", payload })
      return chain
    })
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "update", payload })
      return chain
    })
    const echoed = () => ({ data: { id: "row-1", slug: "s", ...(written.at(-1)?.payload ?? {}) }, error: null })
    chain.single = vi.fn(async () => {
      // A sub-workflow whose read fails with an error (not a missing row).
      if (table === "workflows" && id === FAILING_CHILD) return { data: null, error: { code: "57014", message: "statement timeout" } }
      return table === "workflows" ? { data: rowOf(), error: null } : echoed()
    })
    chain.maybeSingle = vi.fn(async () => ({ data: rowOf(), error: null }))
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }) as never)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(publishedAppsRoutes)
  await app.register(workflowTemplatesRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const publish = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: { "x-user-id": USER }, payload: { workflowId: WORKFLOW_ID, ...payload } })

describe("publishing strips UGC run state, everything made from the UGC video and the author's photo from the snapshot", () => {
  it("an app: every UGC node, everything made from the video and the photo upload start empty; other nodes keep theirs", async () => {
    const written: Written[] = []
    serve(written)

    const res = await publish("/v1/apps/publish", { name: "A UGC app" })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "published_apps" && w.op === "insert")
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
    for (const own of AUTHORS_OWN) expect(JSON.stringify(insert?.payload), own).not.toContain(own)
    // The fallback preview reads the published nodes: never a stripped render, never the author's photo.
    expect(insert?.payload.preview_media_url).toBe(OUTSIDE)
    // The listing is priced on what ships.
    expectPricedOnWhatShips()
    // The publisher's own workflow is not touched.
    expect(WORKFLOW_NODES[0]!.data.url).toBe(PHOTO)
    expect(WORKFLOW_NODES[1]!.data.keepResult).toBe(true)
    expect(WORKFLOW_NODES[4]!.data.generatedVideoUrl).toBe(TAKE)
  })

  it("a component: its snapshot is stripped the same way", async () => {
    const written: Written[] = []
    serve(written)

    const res = await publish("/v1/apps/publish", {
      name: "A UGC component",
      publishType: "component",
      componentMetadata: {
        inputs: [],
        outputs: [{ id: "p", name: "Video", type: "video", required: true, mediaPreview: true, fieldKey: "videoUrl" }],
        exposedSettings: [],
      },
    })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "published_apps" && w.op === "insert")
    expect(insert?.payload.publish_type).toBe("component")
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
    for (const own of AUTHORS_OWN) expect(JSON.stringify(insert?.payload), own).not.toContain(own)
    expectPricedOnWhatShips()
  })

  it("an app: the thumbnail the author picked is theirs to show", async () => {
    const written: Written[] = []
    serve(written)

    const res = await publish("/v1/apps/publish", { name: "A UGC app", thumbnailNodeId: "p" })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "published_apps" && w.op === "insert")
    expect(insert?.payload.preview_media_url).toBe(CAPTIONED)
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
  })

  it("a template (first publish): snapshot_nodes is stripped, and its preview is never a stripped render", async () => {
    const written: Written[] = []
    serve(written)

    const res = await publish("/v1/templates/publish", { name: "A UGC template" })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "workflow_templates" && w.op === "insert")
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
    for (const own of AUTHORS_OWN) expect(JSON.stringify(insert?.payload), own).not.toContain(own)
    expect(insert?.payload.preview_media_url).toBe(`durable:${OUTSIDE}`)
    expectPricedOnWhatShips()
  })

  it("a template (re-publish): the UPDATE is stripped too, preview included", async () => {
    const written: Written[] = []
    serve(written, { id: "tpl-1", slug: "tpl-ab12", name: "A UGC template", listed_in: [] })

    const res = await publish("/v1/templates/publish", { name: "A UGC template" })

    expect(res.statusCode).toBe(200)
    const update = written.find((w) => w.table === "workflow_templates" && w.op === "update")
    expect(update?.payload.snapshot_nodes).toEqual(STRIPPED)
    for (const own of AUTHORS_OWN) expect(JSON.stringify(update?.payload), own).not.toContain(own)
    expect(update?.payload.preview_media_url).toBe(`durable:${OUTSIDE}`)
    expectPricedOnWhatShips()
  })
})

describe("the template's own wiring: the author's photo in \"Your photo\" never ships on any publish", () => {
  /**
   * The template after its author put their photo in "Your photo", set the creator to My photo and ran the video.
   * The template's example screenshots are cleared: with one in front, the automatic preview would pick it and the
   * preview half of these checks could no longer see the photo.
   */
  async function authorsTemplate() {
    const doc = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tutorial-seed", "templates", "ugc-website-video.json"), "utf8")) as {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: unknown[]
      settings: unknown
    }
    const nodes = doc.nodes.map((n) =>
      n.type === "upload-image" && n.id !== "photo"
        ? { ...n, data: { label: n.data.label, fieldMappings: n.data.fieldMappings } }
        : n.id === "photo"
        ? { ...n, data: { ...n.data, assetId: "asset-author", url: PHOTO, r2Url: PHOTO, thumbnailUrl: PHOTO_THUMB, filename: "author.png", generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "t", thumbnailUrl: PHOTO_THUMB }], activeResultIndex: 0 } }
        : n.id === "creator"
          ? { ...n, data: { ...n.data, source: "photo", keepResult: true, generatedImageUrl: PHOTO, ugcOutputs: { creator: '{"v":1}', image: PHOTO }, result: { v: 1, identityImages: [PHOTO] } } }
          : n.id === "captions"
            ? { ...n, data: { ...n.data, ...rendered(CAPTIONED) } }
            : n,
    )
    return { nodes, edges: doc.edges, settings: doc.settings }
  }
  const OWN = [PHOTO, PHOTO_THUMB, "asset-author", CAPTIONED]

  it.each([
    ["an app", "/v1/apps/publish", {}, "published_apps", "insert"],
    ["a component", "/v1/apps/publish", { publishType: "component", componentMetadata: { inputs: [], outputs: [{ id: "captions", name: "Video", type: "video", required: true, mediaPreview: true, fieldKey: "videoUrl" }], exposedSettings: [] } }, "published_apps", "insert"],
    ["a template (first publish)", "/v1/templates/publish", {}, "workflow_templates", "insert"],
  ] as const)("%s: the snapshot, its preview and its price never carry the author's photo", async (_what, url, extra, table, op) => {
    const written: Written[] = []
    serve(written, null, await authorsTemplate())
    const res = await publish(url, { name: "UGC Video From Your Site", ...extra })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === table && w.op === op)
    for (const own of OWN) expect(JSON.stringify(row?.payload), own).not.toContain(own)
    expect(JSON.stringify(pricedNodes()), "the listing's graph").not.toContain(PHOTO)
  })

  it("a template (re-publish): the update never carries the author's photo", async () => {
    const written: Written[] = []
    serve(written, { id: "tpl-1", slug: "tpl-ab12", name: "UGC Video From Your Site", listed_in: [] }, await authorsTemplate())
    const res = await publish("/v1/templates/publish", { name: "UGC Video From Your Site" })
    expect(res.statusCode).toBe(200)
    const update = written.find((w) => w.table === "workflow_templates" && w.op === "update")
    for (const own of OWN) expect(JSON.stringify(update?.payload), own).not.toContain(own)
  })
})

describe("every node on a path to a creator's photo ships without the author's image, on every publish", () => {
  const UPSCALED_FACE = "https://cdn.example/upscaled-author.png"
  const SENT = "https://cdn.example/teleported-author.png"
  const LINK = "https://cdn.example/author-link.png"
  const upload = (id: string) => ({
    id,
    type: "upload-image",
    data: {
      label: id, assetId: `asset-${id}`, url: PHOTO, r2Url: PHOTO, thumbnailUrl: PHOTO_THUMB, filename: "author.png", mimeType: "image/png",
      generatedResults: [{ url: PHOTO, jobId: `upload-${id}`, timestamp: "t", thumbnailUrl: PHOTO_THUMB }], activeResultIndex: 0,
    },
  })
  const LINK_TEXT = "https://cdn.example/author-face-by-link.png"
  /** As the UGC template shows it: the creators are the app's inputs, the uploads are not. */
  const CREATORS_ONLY = { presentationSettings: { inputItems: [{ type: "node", nodeId: "c1" }, { type: "node", nodeId: "c2" }] } }
  /**
   * Two My photo creators: one fed the author's photo through an upscale, one through a teleport pair whose upload
   * takes the photo's link from a Text node; and a node outside both.
   */
  function photoPaths(settings: unknown = CREATORS_ONLY) {
    const nodes = [
      { id: "link", type: "text-prompt", data: { label: "link", text: LINK_TEXT } },
      upload("u1"),
      { id: "st", type: "upscale-image", data: { label: "st", upscaleFactor: 2, generatedImageUrl: UPSCALED_FACE, generatedResults: [{ url: UPSCALED_FACE, jobId: "job-2", timestamp: "t" }], activeResultIndex: 0 } },
      { id: "c1", type: "ugc-creator", data: { source: "photo", gender: "woman" } },
      upload("u2"),
      { id: "ts", type: "teleport-send", data: { label: "ts", channel: "P", result: SENT } },
      { id: "tr", type: "teleport-receive", data: { label: "tr", channel: "P", result: SENT } },
      { id: "c2", type: "ugc-creator", data: { source: "photo", gender: "man" } },
      { id: "g", type: "generate-video", data: { prompt: "a cat", ...rendered(OUTSIDE) } },
    ]
    const edges = [e("u1", "st", "image", "image"), e("st", "c1", "photo", "image"), e("link", "u2", "in", "prompt"), e("u2", "ts", "in", "image"), e("tr", "c2", "photo", "out")]
    return { nodes, edges, settings }
  }
  const OWN = [PHOTO, PHOTO_THUMB, "asset-u1", "asset-u2", UPSCALED_FACE, SENT, LINK_TEXT]
  const COMPONENT = { publishType: "component", componentMetadata: { inputs: [], outputs: [{ id: "g", name: "Video", type: "video", required: true, mediaPreview: true, fieldKey: "videoUrl" }], exposedSettings: [] } }
  const snapshotOf = (row: Written | undefined) => new Map(((row?.payload.snapshot_nodes ?? []) as Array<{ id: string; data: Record<string, unknown> }>).map((x) => [x.id, x.data]))

  it.each([
    ["an app", "/v1/apps/publish", {}, "published_apps", "insert", null, OUTSIDE],
    ["a component", "/v1/apps/publish", COMPONENT, "published_apps", "insert", null, OUTSIDE],
    ["a template (first publish)", "/v1/templates/publish", {}, "workflow_templates", "insert", null, `durable:${OUTSIDE}`],
    ["a template (re-publish)", "/v1/templates/publish", {}, "workflow_templates", "update", { id: "tpl-1", slug: "tpl-ab12", name: "Photo paths", listed_in: [] }, `durable:${OUTSIDE}`],
  ] as const)("%s: the snapshot, its preview and its price carry none of it", async (_what, url, extra, table, op, existing, preview) => {
    const written: Written[] = []
    serve(written, existing as Record<string, unknown> | null, photoPaths())
    const res = await publish(url, { name: "Photo paths", ...extra })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === table && w.op === op)
    for (const own of OWN) expect(JSON.stringify(row?.payload), own).not.toContain(own)
    const shipped = snapshotOf(row)
    expect(shipped.get("st")).toEqual({ label: "st", upscaleFactor: 2 })
    expect(shipped.get("ts")).toEqual({ label: "ts", channel: "P" })
    expect(shipped.get("tr")).toEqual({ label: "tr", channel: "P" })
    // The Text node handing the upload its link loses the link.
    expect(shipped.get("link")).toEqual({ label: "link" })
    expect(row?.payload.preview_media_url).toBe(preview)
    for (const own of OWN) expect(JSON.stringify(pricedNodes()), `the listing's graph: ${own}`).not.toContain(own)
  })

  // The author's pick is theirs: it ships exactly as they chose it, their photo or a render made from it
  // included. The snapshot still holds none of it, and an automatic preview (above) never picks one.
  const REPUBLISH = { id: "tpl-1", slug: "tpl-ab12", name: "Photo paths", listed_in: [] }
  it.each([
    ["an app: the preview sent with the publish", "/v1/apps/publish", { previewMediaUrl: PHOTO, previewMediaType: "image" }, "published_apps", "insert", null, PHOTO],
    ["an app: the thumbnail node, on the photo's path", "/v1/apps/publish", { thumbnailNodeId: "st" }, "published_apps", "insert", null, UPSCALED_FACE],
    ["a template: the preview sent with the publish", "/v1/templates/publish", { previewMediaUrl: PHOTO, previewMediaType: "image" }, "workflow_templates", "insert", null, `durable:${PHOTO}`],
    ["a template's re-publish: the preview sent with the publish", "/v1/templates/publish", { previewMediaUrl: PHOTO, previewMediaType: "image" }, "workflow_templates", "update", REPUBLISH, `durable:${PHOTO}`],
  ] as const)("%s is the author's photo, or made from it: it ships as chosen, and the snapshot holds none of it", async (_what, url, extra, table, op, existing, preview) => {
    const written: Written[] = []
    serve(written, existing ? { ...existing } : null, photoPaths())
    const res = await publish(url, { name: "Photo paths", ...extra })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === table && w.op === op)
    expect(row?.payload.preview_media_url).toBe(preview)
    for (const own of OWN) expect(JSON.stringify(row?.payload.snapshot_nodes), own).not.toContain(own)
  })

  it.each([
    ["a template", null, "insert"],
    ["a template's re-publish", REPUBLISH, "update"],
  ] as const)("%s: the workflow's thumbnail (Set as Thumbnail) is the author's photo: it ships as chosen", async (_what, existing, op) => {
    const written: Written[] = []
    serve(written, existing ? { ...existing } : null, { ...photoPaths(), thumbnailUrl: PHOTO })
    const res = await publish("/v1/templates/publish", { name: "Photo paths" })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "workflow_templates" && w.op === op)
    expect(row?.payload.preview_media_url).toBe(`durable:${PHOTO}`)
    for (const own of OWN) expect(JSON.stringify(row?.payload.snapshot_nodes), own).not.toContain(own)
  })

  it.each([
    ["the source template's preview, inherited by a clone made before clones started empty", PHOTO, `durable:${OUTSIDE}`],
    ["one the cloner set themselves", UPSCALED_FACE, `durable:${UPSCALED_FACE}`],
  ] as const)("a template published from a clone, its workflow thumbnail %s", async (_what, thumbnail, preview) => {
    const written: Written[] = []
    // The source template (by the clone's template id) lists the author's photo as its preview.
    serve(written, { id: "tpl-source", preview_media_url: PHOTO }, { ...photoPaths(), thumbnailUrl: thumbnail, templateId: "tpl-source" })
    const res = await publish("/v1/templates/publish", { name: "Photo paths" })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "workflow_templates")
    expect(row?.payload.preview_media_url).toBe(preview)
  })

  it("a preview set later on the app is stored as the author sends it", async () => {
    const updates: Array<Record<string, unknown>> = []
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = vi.fn(() => chain)
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, ...payload })
        return chain
      })
      chain.single = vi.fn(async () => ({ data: { id: "app-1", creator_id: USER, slug: "s", workflow_id: WORKFLOW_ID, monetization_enabled: false }, error: null }))
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
      return chain
    }) as never)
    const res = await app.inject({ method: "PATCH", url: "/v1/apps/app-1", headers: { "x-user-id": USER }, payload: { previewMediaUrl: PHOTO, previewMediaType: "image" } })
    expect(res.statusCode).toBe(200)
    expect(updates.find((u) => u.table === "published_apps")).toMatchObject({ preview_media_url: PHOTO })
  })

  it("an app with no presentation items shows every upload and Text node as an input: each keeps that role and ships empty, the Text node feeding an upload's link input too", async () => {
    const written: Written[] = []
    serve(written, null, photoPaths({}))
    const res = await publish("/v1/apps/publish", { name: "Photo paths" })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "published_apps" && w.op === "insert")
    const shipped = snapshotOf(row)
    expect(shipped.get("u2")).toEqual({ label: "u2" })
    expect(shipped.get("link")).toEqual({ label: "link" })
    for (const own of OWN) expect(JSON.stringify(row?.payload), own).not.toContain(own)
  })

  it.each([
    ["an app's upload input", {}, { presentationSettings: { inputItems: [{ type: "node", nodeId: "u1" }] } }],
    ["a component's image handle", { publishType: "component", componentMetadata: { ...COMPONENT.componentMetadata, inputs: [{ id: "u1", name: "Photo", type: "image", required: true, fieldKey: "url" }] } }, {}],
  ] as const)("%s on the path stays the runner's: it ships empty, the step behind it without its render, and what feeds the input ships empty too", async (_what, extra, settings) => {
    const written: Written[] = []
    const graph = photoPaths(settings)
    // Something feeds the input's link pip: nothing ends the walk at an input, so it is in the photo influence set.
    graph.nodes.push(
      { id: "linker", type: "llm-chat", data: { label: "linker", userInput: "the photo's link", generatedText: LINK, executionStatus: "completed" } } as never,
      { id: "linkText", type: "text-prompt", data: { label: "linkText", text: LINK } } as never,
    )
    graph.edges.push(e("linker", "u1", "in", "text"), e("linkText", "u1", "in", "prompt"))
    serve(written, null, graph)
    const res = await publish("/v1/apps/publish", { name: "Photo paths", ...extra })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "published_apps" && w.op === "insert")
    const shipped = snapshotOf(row)
    expect(shipped.get("u1")).toEqual({ label: "u1" })
    expect(shipped.get("st")).toEqual({ label: "st", upscaleFactor: 2 })
    expect(shipped.get("linker")).toEqual({ label: "linker", userInput: "the photo's link" })
    expect(shipped.get("linkText")).toEqual({ label: "linkText" })
    for (const own of [...OWN, LINK]) expect(JSON.stringify(row?.payload), own).not.toContain(own)
  })

  it("a component's exposed setting on a node on the path defaults to what the node ships with; one elsewhere keeps its default", async () => {
    const written: Written[] = []
    const graph = photoPaths()
    graph.nodes.push({ id: "writer", type: "llm-chat", data: { label: "writer", userInput: LINK, systemPrompt: "Return the link", generatedText: LINK } } as never)
    graph.edges.push(e("writer", "u1", "in", "text"))
    serve(written, null, graph)
    const res = await publish("/v1/apps/publish", {
      name: "Photo paths",
      publishType: "component",
      componentMetadata: {
        ...COMPONENT.componentMetadata,
        exposedSettings: [
          { nodeId: "writer", field: "userInput", label: "Link", type: "text", defaultValue: LINK },
          { nodeId: "writer", field: "systemPrompt", label: "System", type: "text", defaultValue: "Return the link" },
          { nodeId: "g", field: "prompt", label: "Prompt", type: "text", defaultValue: "a cat" },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "published_apps" && w.op === "insert")
    const exposed = (row?.payload.component_metadata as { exposedSettings: Array<{ nodeId: string; field: string; defaultValue?: unknown }> }).exposedSettings
    expect(exposed.map((x) => [x.nodeId, x.field, x.defaultValue])).toEqual([
      ["writer", "userInput", undefined],
      ["writer", "systemPrompt", "Return the link"],
      ["g", "prompt", "a cat"],
    ])
    expect(JSON.stringify(row?.payload)).not.toContain(LINK)
  })
})

describe("a sub-workflow whose graph holds a UGC video ships as one of the video's nodes, on every publish", () => {
  const NESTED_RENDER = "https://cdn.example/nested-ugc.mp4"
  const AFTER = "https://cdn.example/after-nested.mp4"
  /** The author's graph: a sub-workflow node holding its last run's render, a join made from it, and a node outside both. No UGC node of its own. */
  const parentGraph = () => ({
    nodes: [
      { id: "nested", type: "sub-workflow", data: { label: "nested", workflowId: "wf-child", outputResults: { out: NESTED_RENDER }, generatedResults: [{ url: NESTED_RENDER, jobId: "sub-1", timestamp: "t" }], activeResultIndex: 0, executionStatus: "completed" } },
      { id: "after", type: "combine-videos", data: { label: "after", transition: "cut", ...rendered(AFTER) } },
      { id: "g", type: "generate-video", data: { prompt: "a cat", ...rendered(OUTSIDE) } },
    ],
    edges: [e("nested", "after", "in", "out")],
  })
  const UGC_CHILD = { "wf-child": { nodes: [{ id: "c", type: "ugc-creator", data: { source: "sampled" } }, { id: "k", type: "ugc-clip", data: {} }], edges: [] } }
  const COMPONENT = { publishType: "component", componentMetadata: { inputs: [], outputs: [{ id: "g", name: "Video", type: "video", required: true, mediaPreview: true, fieldKey: "videoUrl" }], exposedSettings: [] } }
  const snapshotOf = (row: Written | undefined) => new Map(((row?.payload.snapshot_nodes ?? []) as Array<{ id: string; data: Record<string, unknown> }>).map((x) => [x.id, x.data]))

  it.each([
    ["an app", "/v1/apps/publish", {}, "published_apps", "insert", null, OUTSIDE],
    ["a component", "/v1/apps/publish", COMPONENT, "published_apps", "insert", null, OUTSIDE],
    ["a template (first publish)", "/v1/templates/publish", {}, "workflow_templates", "insert", null, `durable:${OUTSIDE}`],
    ["a template (re-publish)", "/v1/templates/publish", {}, "workflow_templates", "update", { id: "tpl-1", slug: "tpl-ab12", name: "Nested", listed_in: [] }, `durable:${OUTSIDE}`],
  ] as const)("%s: its stored outputs, and what is made from them, never ship — nor become the preview", async (_what, url, extra, table, op, existing, preview) => {
    const written: Written[] = []
    serve(written, existing as Record<string, unknown> | null, parentGraph(), UGC_CHILD)
    const res = await publish(url, { name: "Nested", ...extra })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === table && w.op === op)
    for (const own of [NESTED_RENDER, AFTER]) expect(JSON.stringify(row?.payload), own).not.toContain(own)
    const shipped = snapshotOf(row)
    expect(shipped.get("nested")).toEqual({ label: "nested", workflowId: "wf-child" })
    expect(shipped.get("after")).toEqual({ label: "after", transition: "cut" })
    expect(row?.payload.preview_media_url).toBe(preview)
    for (const own of [NESTED_RENDER, AFTER]) expect(JSON.stringify(pricedNodes()), `the listing's graph: ${own}`).not.toContain(own)
  })

  it("a sub-workflow whose graph holds no UGC node keeps its outputs, as any node does", async () => {
    const written: Written[] = []
    serve(written, null, parentGraph(), { "wf-child": { nodes: [{ id: "x", type: "generate-video", data: {} }], edges: [] } })
    const res = await publish("/v1/apps/publish", { name: "Nested" })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === "published_apps" && w.op === "insert")
    expect(JSON.stringify(row?.payload.snapshot_nodes)).toContain(NESTED_RENDER)
    expect(JSON.stringify(row?.payload.snapshot_nodes)).toContain(AFTER)
  })
})

describe("a publish whose read of a referenced graph fails with an error", () => {
  const graph = {
    nodes: [{ id: "s", type: "sub-workflow", data: { label: "s", workflowId: FAILING_CHILD, outputResults: { p1: OUTSIDE } } }, { id: "after", type: "combine-videos", data: { transition: "cut", ...rendered(OUTSIDE) } }],
    edges: [e("s", "after", "in", "out_p1")],
  }

  it.each([
    ["an app", "/v1/apps/publish", {}],
    ["a template", "/v1/templates/publish", {}],
  ] as const)("%s: is refused with a retryable error before anything is written — no version cut, none retired", async (_what, url, extra) => {
    const written: Written[] = []
    serve(written, null, graph)
    const res = await publish(url, { name: "Read fails", ...extra })
    expect(res.statusCode).toBe(500)
    // The error's own report aside, nothing is written.
    expect(written.filter((w) => w.table !== "app_reports")).toEqual([])
  })
})

describe("the workflow's character definitions: one a node on a creator's photo path draws on ships without its picture", () => {
  const MINE = "https://cdn.example/author-character.png"
  const BRAND = "https://cdn.example/brand-mascot.png"
  const graph = {
    nodes: [
      { id: "gen", type: "generate-image", data: { label: "gen", prompt: "me", characterDefinitionIds: ["def-me"] } },
      { id: "c1", type: "ugc-creator", data: { label: "c1", source: "photo", gender: "woman" } },
      { id: "mascot", type: "generate-image", data: { label: "mascot", prompt: "a mascot", characterDefinitionIds: ["def-brand"] } },
    ],
    edges: [e("gen", "c1", "photo", "image")],
    settings: {
      characterDefinitions: [
        { id: "def-me", name: "Me", type: "reference", referenceImageUrl: MINE },
        { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
      ],
    },
  }

  it.each([
    ["an app", "/v1/apps/publish", "published_apps", "insert", null],
    ["a template", "/v1/templates/publish", "workflow_templates", "insert", null],
    ["a template's re-publish", "/v1/templates/publish", "workflow_templates", "update", { id: "tpl-1", slug: "tpl-ab12", name: "Characters", listed_in: [] }],
  ] as const)("%s: its snapshot settings hold the one on the path without its picture, and the other as it is", async (_what, url, table, op, existing) => {
    const written: Written[] = []
    serve(written, existing ? { ...existing } : null, graph)
    const res = await publish(url, { name: "Characters" })
    expect(res.statusCode).toBe(200)
    const row = written.find((w) => w.table === table && w.op === op)
    expect(row?.payload.snapshot_settings).toEqual({
      characterDefinitions: [
        { id: "def-me", name: "Me", type: "reference" },
        { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
      ],
    })
    expect(JSON.stringify(row?.payload)).not.toContain(MINE)
    // The publisher's own workflow is not touched.
    expect(graph.settings.characterDefinitions[0]!.referenceImageUrl).toBe(MINE)
  })
})
