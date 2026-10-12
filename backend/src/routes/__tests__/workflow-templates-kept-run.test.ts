/**
 * A template's kept example run through the real publish route and the real funnel (design: UGC
 * templates with data): an author who opts in (`includeRunResults`) ships one AI-creator run's
 * display values, copied to the template's own storage, only when the author's own jobs prove it;
 * a run made from the author's photo, or one the ledger does not prove, ships exactly as without the
 * choice. The listing is the same either way. The dry run (`keep-check`) answers the same question.
 * The URLs and ids are placeholders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", R2_PUBLIC_URL: "https://cdn.example" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 2900, final: 0, previewPerMinute: 0, finalPerMinute: 0 }),
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage.js")>()),
  copyToTemplatePreview: vi.fn(async (source: string) => `https://cdn.example/templates/preview-of/${encodeURIComponent(source)}`),
  copyToTemplateKept: vi.fn(async (source: string, templateId: string) => `https://cdn.example/templates/${templateId}/kept/${source.split("/").pop()}`),
}))
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-deny.js")>()),
  findUnpublishableNodeTypes: () => [],
}))

import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { copyToTemplateKept, copyToTemplatePreview } from "../../lib/storage.js"
import { estimateWorkflowListingCredits } from "../../ee/billing/credits.js"
import { UGC_CLIP_CREATOR_IMAGE_FIELD } from "../../lib/ugc-template-keep-ledger.js"
import { AI_IMAGE, AUTHOR_FACE, CAPTIONED, JOINED, OVERLAID, SECRET, TAKE_1, TAKE_2, ranTemplate, type Data, type E, type N } from "../../lib/__tests__/ugc-template-keep-fixtures.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEMPLATE_ID = "00000000-0000-4000-8000-0000000000e1"

type Job = { id: string; user_id: string; status: string; input_data: Data; output_data: Data }
type Written = { table: string; op: "insert" | "update"; payload: Record<string, unknown> }
interface World {
  graph: { nodes: N[]; edges: E[] }
  jobs: Job[]
  existing?: { snapshot_nodes: unknown[] }
  jobsFail?: boolean
  written: Written[]
  jobReads: number
}

const idOf = (url: string) => url.replace(/^.*\/([0-9a-f-]{36})[^/]*$/, "$1")

/** The author's jobs behind the finished run. */
function ledger(owner = AUTHOR): Job[] {
  return [
    { id: idOf(AI_IMAGE), user_id: owner, status: "completed", input_data: { type: "generate-image", prompt: "p" }, output_data: { imageUrl: AI_IMAGE } },
    ...[TAKE_1, TAKE_2].map((take) => ({ id: idOf(take), user_id: owner, status: "completed", input_data: { type: "ugc-clip", [UGC_CLIP_CREATOR_IMAGE_FIELD]: AI_IMAGE }, output_data: { videoUrl: take } })),
    { id: idOf(JOINED), user_id: owner, status: "completed", input_data: { type: "combine-videos", videoUrls: [TAKE_1, TAKE_2] }, output_data: { videoUrl: JOINED } },
    { id: idOf(OVERLAID), user_id: owner, status: "completed", input_data: { type: "video-overlay", videoUrl: JOINED }, output_data: { videoUrl: OVERLAID } },
    { id: idOf(CAPTIONED), user_id: owner, status: "completed", input_data: { type: "add-captions", videoUrl: OVERLAID }, output_data: { videoUrl: CAPTIONED } },
  ]
}

function serve(w: World): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const filters: Record<string, unknown> = {}
    let columns = ""
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn((c: string) => {
      columns = c ?? ""
      return chain
    })
    for (const m of ["is", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.eq = vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return chain
    })
    chain.in = vi.fn((column: string, value: unknown) => {
      filters[`in:${column}`] = value
      return chain
    })
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      w.written.push({ table, op: "insert", payload })
      return chain
    })
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      w.written.push({ table, op: "update", payload })
      return chain
    })
    const workflowRow = { id: WORKFLOW_ID, user_id: AUTHOR, workspace_id: null, visibility: "private", nodes: w.graph.nodes, edges: w.graph.edges, settings: {}, thumbnail_url: null, template_id: null }
    chain.single = vi.fn(async () => ({ data: { id: TEMPLATE_ID, slug: "s", ...(w.written.at(-1)?.payload ?? {}) }, error: null }))
    chain.maybeSingle = vi.fn(async () => {
      if (table === "workflows") return { data: workflowRow, error: null }
      if (table === "workflow_templates") {
        if (!w.existing) return { data: null, error: null }
        return { data: columns.includes("snapshot_nodes") ? { snapshot_nodes: w.existing.snapshot_nodes } : { id: TEMPLATE_ID, slug: "s", name: "Earlier", listed_in: [] }, error: null }
      }
      return { data: null, error: null }
    })
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (table !== "jobs") return resolve({ data: [], error: null })
      w.jobReads++
      if (w.jobsFail) return resolve({ data: null, error: { message: "down" } })
      const ids = (filters["in:id"] as string[] | undefined) ?? []
      return resolve({ data: w.jobs.filter((j) => ids.includes(j.id) && j.user_id === filters.user_id), error: null })
    }
    return chain
  }) as never)
}

async function world(patch: Record<string, Data> = {}, extra: Partial<World> = {}): Promise<World> {
  return { graph: await ranTemplate(patch), jobs: ledger(), written: [], jobReads: 0, ...extra }
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(workflowTemplatesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

async function publish(w: World, body: Record<string, unknown> = {}) {
  serve(w)
  const res = await app.inject({ method: "POST", url: "/v1/templates/publish", headers: { "x-user-id": AUTHOR }, payload: { workflowId: WORKFLOW_ID, name: "UGC", ...body } })
  const row = w.written.find((x) => x.table === "workflow_templates")
  const priced = vi.mocked(estimateWorkflowListingCredits).mock.calls.at(-1)?.[0]
  return { res, row, snapshot: row?.payload.snapshot_nodes as N[] | undefined, priced }
}

const nodeOf = (snapshot: N[] | undefined, id: string) => snapshot?.find((n) => n.id === id)?.data ?? {}
const KEPT = (templateId: string, url: string) => `https://cdn.example/templates/${templateId}/kept/${url.split("/").pop()}`

describe("POST /v1/templates/publish with includeRunResults", () => {
  it("a proven AI-creator run ships its display values as the template's own copies, and nothing a run reads", async () => {
    const w = await world()
    const { res, row, snapshot } = await publish(w, { includeRunResults: true })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().keptResults).toEqual({ included: true })
    const templateId = row!.payload.id as string
    expect(nodeOf(snapshot, "creator").generatedImageUrl).toBe(KEPT(templateId, AI_IMAGE))
    expect(nodeOf(snapshot, "creator").keepResult).toBe(false)
    expect(nodeOf(snapshot, "creator").result).toBeUndefined()
    expect(nodeOf(snapshot, "script").exampleLines).toEqual(["Hook line.", "Beat one.", "Closer line."])
    expect(nodeOf(snapshot, "script").result).toBeUndefined()
    expect(nodeOf(snapshot, "clip").__listResults).toEqual([KEPT(templateId, TAKE_1), KEPT(templateId, TAKE_2)])
    expect(nodeOf(snapshot, "captions").generatedVideoUrl).toBe(KEPT(templateId, CAPTIONED))
    expect(nodeOf(snapshot, "cards").result).toEqual({ layerPlan: "{\"layers\":[]}", captionPlan: "{\"words\":[]}", report: "Notes text." })
    const shipped = JSON.stringify(row!.payload)
    expect(shipped).not.toContain(SECRET)
    expect(shipped).not.toContain("jobId")
    // No address of the author's own job outputs is left: every kept file is the template's copy.
    for (const original of [AI_IMAGE, TAKE_1, TAKE_2, JOINED, OVERLAID, CAPTIONED]) expect(shipped).not.toContain(original)
    expect(vi.mocked(copyToTemplateKept).mock.calls.map((c) => [c[0], c[1], c[2]]).sort()).toEqual(
      [AI_IMAGE, TAKE_1, TAKE_2, JOINED, OVERLAID, CAPTIONED].map((u) => [u, templateId, AUTHOR]).sort(),
    )
    // The automatic preview is the kept captioned video (the app's output), never the creator's face.
    expect(vi.mocked(copyToTemplatePreview).mock.calls[0]?.[0]).toBe(KEPT(templateId, CAPTIONED))
    expect(w.jobReads).toBe(1)
  })

  it("the listing is priced on the same graph with or without the choice", async () => {
    const on = await publish(await world(), { includeRunResults: true })
    const off = await publish(await world(), {})
    expect(on.priced).toEqual(off.priced)
    expect(JSON.stringify(on.priced)).not.toContain("exampleLines")
    expect(on.row!.payload.estimated_credits).toBe(off.row!.payload.estimated_credits)
  })

  const unproven: Array<[string, Record<string, Data>, Partial<World>, string]> = [
    ["a My photo run", { creator: { source: "photo" }, photo: { url: AUTHOR_FACE } }, {}, "photo_run"],
    ["a run whose record says the photo made it, the creator switched back to AI", { creator: { result: { v: 1, kind: "photo", identityImages: [AI_IMAGE] } } }, {}, "photo_run"],
    ["a run whose clip jobs record no creator image (made before the plugin wrote it)", {}, { jobs: ledger().map((j) => (j.input_data.type === "ugc-clip" ? { ...j, input_data: { type: "ugc-clip" } } : j)) }, "unverified"],
    ["a run the node data claims but no image job made (a forged record)", {}, { jobs: ledger().filter((j) => j.id !== idOf(AI_IMAGE)) }, "unverified"],
    ["someone else's run (a cloner re-publishing the example)", {}, { jobs: ledger("someone-else") }, "unverified"],
    ["a pick still pending", { creator: { candidates: [{ imageUrl: AI_IMAGE, record: {} }] } }, {}, "no_results"],
  ]
  it.each(unproven)("%s ships exactly as without the choice, and says why", async (_name, patch, extra, reason) => {
    const on = await publish(await world(patch, extra), { includeRunResults: true })
    const off = await publish(await world(patch, extra), {})
    expect(on.res.statusCode, on.res.body).toBe(200)
    expect(on.res.json().keptResults).toEqual({ included: false, reason })
    expect(on.snapshot).toEqual(off.snapshot)
    expect(JSON.stringify(on.snapshot)).not.toContain(AUTHOR_FACE)
    expect(copyToTemplateKept).not.toHaveBeenCalled()
  })

  it("a copy that fails refuses the publish and writes nothing", async () => {
    vi.mocked(copyToTemplateKept).mockRejectedValueOnce(new Error("r2 down"))
    const w = await world()
    const { res } = await publish(w, { includeRunResults: true })
    expect(res.statusCode).toBe(500)
    expect(w.written.filter((x) => x.table === "workflow_templates")).toEqual([])
  })

  it("a ledger read that fails refuses the publish and writes nothing", async () => {
    const w = await world({}, { jobsFail: true })
    const { res } = await publish(w, { includeRunResults: true })
    expect(res.statusCode).toBe(500)
    expect(w.written.filter((x) => x.table === "workflow_templates")).toEqual([])
  })

  it("without the choice, nothing of the run ships and the ledger is never read", async () => {
    const w = await world()
    const { res, snapshot } = await publish(w, {})
    expect(res.json().keptResults).toEqual({ included: false, reason: "not_requested" })
    expect(JSON.stringify(snapshot)).not.toContain(TAKE_1)
    expect(nodeOf(snapshot, "script").exampleLines).toBeUndefined()
    expect(w.jobReads).toBe(0)
  })

  it("a workflow with no UGC video: the choice is ignored, nothing extra is read, the template is today's", async () => {
    const plain = { nodes: [{ id: "img", type: "generate-image", data: { label: "img", generatedImageUrl: "https://cdn.example/images/x.png" } }] as N[], edges: [] as E[] }
    const on: World = { graph: plain, jobs: [], written: [], jobReads: 0 }
    const off: World = { graph: plain, jobs: [], written: [], jobReads: 0 }
    const a = await publish(on, { includeRunResults: true })
    const b = await publish(off, {})
    expect(a.res.json().keptResults).toEqual({ included: false, reason: "no_ugc_video" })
    expect(a.snapshot).toEqual(b.snapshot)
    expect(on.jobReads).toBe(0)
  })
})

describe("a re-publish that does not say reads the template's last choice", () => {
  it("a snapshot holding kept copies keeps the run again", async () => {
    const w = await world({}, { existing: { snapshot_nodes: [{ id: "captions", type: "add-captions", data: { generatedVideoUrl: `https://cdn.example/templates/${TEMPLATE_ID}/kept/old.mp4` } }] } })
    const { res } = await publish(w, {})
    expect(res.json().keptResults).toEqual({ included: true })
  })
  it("a snapshot holding none keeps nothing", async () => {
    const w = await world({}, { existing: { snapshot_nodes: [{ id: "captions", type: "add-captions", data: {} }] } })
    const { res } = await publish(w, {})
    expect(res.json().keptResults).toEqual({ included: false, reason: "not_requested" })
  })
  it("an explicit choice wins over the last one", async () => {
    const w = await world({}, { existing: { snapshot_nodes: [{ id: "captions", type: "add-captions", data: { generatedVideoUrl: `https://cdn.example/templates/${TEMPLATE_ID}/kept/old.mp4` } }] } })
    const { res, snapshot } = await publish(w, { includeRunResults: false })
    expect(res.json().keptResults).toEqual({ included: false, reason: "not_requested" })
    expect(JSON.stringify(snapshot)).not.toContain("/kept/")
  })
})

describe("POST /v1/templates/keep-check (the dialog's dry run)", () => {
  async function check(w: World, user = AUTHOR) {
    serve(w)
    return app.inject({ method: "POST", url: "/v1/templates/keep-check", headers: { "x-user-id": user }, payload: { workflowId: WORKFLOW_ID } })
  }
  it("a proven run: shown and eligible, copying and writing nothing", async () => {
    const w = await world()
    const res = await check(w)
    expect(res.json()).toEqual({ shown: true, eligible: true, current: false })
    expect(copyToTemplateKept).not.toHaveBeenCalled()
    expect(w.written).toEqual([])
  })
  it("a My photo run: shown, not eligible, and why", async () => {
    expect((await check(await world({ creator: { source: "photo" } }))).json()).toEqual({ shown: true, eligible: false, current: false, reason: "photo_run" })
  })
  it("no run yet: shown, not eligible (no results)", async () => {
    expect((await check(await world({ creator: { generatedImageUrl: undefined, result: undefined } }))).json()).toEqual({ shown: true, eligible: false, current: false, reason: "no_results" })
  })
  it("a workflow with no UGC video: not shown", async () => {
    const w: World = { graph: { nodes: [{ id: "t", type: "text-prompt", data: { label: "t" } }], edges: [] }, jobs: [], written: [], jobReads: 0 }
    expect((await check(w)).json()).toEqual({ shown: false, eligible: false, current: false, reason: "no_ugc_video" })
  })
  it("starts from the author's last choice: a template whose snapshot keeps a run", async () => {
    const w = await world({}, { existing: { snapshot_nodes: [{ id: "captions", type: "add-captions", data: { generatedVideoUrl: `https://cdn.example/templates/${TEMPLATE_ID}/kept/old.mp4` } }] } })
    expect((await check(w)).json()).toEqual({ shown: true, eligible: true, current: true })
  })
  it("not the author's workflow: refused", async () => {
    expect((await check(await world(), "00000000-0000-4000-8000-0000000000b2")).statusCode).toBe(403)
  })
})
