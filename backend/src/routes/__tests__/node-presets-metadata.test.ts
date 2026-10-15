/**
 * The metadata every preset carries over the API — `minReferences`,
 * `needsImage` and `previewUrl` — on the factory catalog and on user presets,
 * and how the write routes treat a user preset's `previewUrl`.
 *
 * The preview check itself (platform host, file exists) is covered in
 * lib/presets/__tests__/preview-url.test.ts; here, what the routes do with its
 * answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))

const preview = vi.hoisted(() => ({
  problem: vi.fn(async (_userId: string, _entries: unknown): Promise<string | null> => null),
  store: vi.fn(async (_userId: string, keys: string[]) =>
    new Map(keys.map((k) => [k, `https://cdn.example.test/node-presets/u/copy-of-${k.split("/").join("-")}`] as const)),
  ),
  release: vi.fn(async (_userId: string, _urls: unknown[]) => {}),
}))
vi.mock("../../lib/presets/preview-url.js", () => ({
  PREVIEW_URL_MAX_LENGTH: 2048,
  previewUrlProblem: (userId: string, entries: unknown) => preview.problem(userId, entries),
  previewStorageKey: (url: string) => (url.startsWith("https://cdn.example.test/") ? url.slice("https://cdn.example.test/".length) : null),
}))
// The copy itself: lib/presets/__tests__/preview-copy.test.ts. Here, which address the routes store and release.
vi.mock("../../lib/presets/preview-copy.js", () => ({
  storePresetPreviews: (userId: string, keys: string[]) => preview.store(userId, keys),
  releasePresetPreviews: (userId: string, urls: unknown[]) => preview.release(userId, urls),
}))
const copyOf = (key: string) => `https://cdn.example.test/node-presets/u/copy-of-${key.split("/").join("-")}`

// One committed preview, so the factory route can be seen handing out a URL for
// a preset that has a file and null for one that has none.
vi.mock("@nodaro/prompts/presets", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@nodaro/prompts/presets")>()
  const files = { "generate-image/character-board": "generate-image/character-board.1a2b3c4d.webp" }
  return { ...orig, factoryPresetPreviewUrl: (id: string, base: string) => orig.factoryPresetPreviewUrl(id, base, files) }
})

const { nodePresetRoutes } = await import("../node-presets.js")
const { supabase } = await import("../../lib/supabase.js")
const { appBaseUrl } = await import("../../lib/deployment-urls.js")

const USER = "00000000-0000-4000-8000-000000000001"
const fromMock = supabase.from as ReturnType<typeof vi.fn>

function makeQB(opts: { rows?: unknown; single?: unknown; error?: { code?: string; message?: string } | null }) {
  const result = { data: opts.rows ?? null, error: opts.error ?? null }
  const singleResult = { data: opts.single ?? null, error: opts.error ?? null }
  const qb: Record<string, unknown> = {}
  for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "in", "order"]) qb[m] = vi.fn(() => qb)
  qb.single = vi.fn(() => Promise.resolve(singleResult))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return qb
}

async function app(): Promise<FastifyInstance> {
  const a = Fastify()
  a.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  await a.register(nodePresetRoutes)
  return a
}

beforeEach(() => {
  vi.clearAllMocks()
  preview.problem.mockReset()
  preview.problem.mockResolvedValue(null)
  preview.store.mockClear()
  preview.release.mockClear()
})

type FactoryEntry = { id: string; minReferences: number; needsImage: boolean; previewUrl: string | null }

async function factory(nodeType: string): Promise<FactoryEntry[]> {
  const res = await (await app()).inject({ method: "GET", url: `/v1/node-presets/factory?nodeType=${nodeType}` })
  expect(res.statusCode).toBe(200)
  return res.json().data as FactoryEntry[]
}

describe("GET /v1/node-presets/factory — reference counts and previews", () => {
  it("every entry carries minReferences, needsImage and previewUrl", async () => {
    const data = await factory("generate-image")
    expect(data.length).toBeGreaterThan(50)
    for (const p of data) {
      expect(Number.isInteger(p.minReferences), p.id).toBe(true)
      expect(p.needsImage, p.id).toBe(p.minReferences > 0)
      expect(p.previewUrl === null || typeof p.previewUrl === "string", p.id).toBe(true)
    }
  })

  it("a photo-based preset needs an image; a text-only one does not", async () => {
    const byId = new Map((await factory("generate-image")).map((p) => [p.id, p]))
    expect(byId.get("generate-image/character-board")).toMatchObject({ minReferences: 1, needsImage: true })
    expect(byId.get("generate-image/cast-mega-grid")).toMatchObject({ minReferences: 2, needsImage: true })
    expect(byId.get("generate-image/faceless-3d-head")).toMatchObject({ minReferences: 1, needsImage: true })
    expect(byId.get("generate-image/cinematic-portrait")).toMatchObject({ minReferences: 0, needsImage: false })
  })

  it("previewUrl is absolute on this installation's origin when the preset has a committed file, else null", async () => {
    const byId = new Map((await factory("generate-image")).map((p) => [p.id, p]))
    expect(byId.get("generate-image/character-board")!.previewUrl).toBe(
      `${appBaseUrl()}/preset-previews/generate-image/character-board.1a2b3c4d.webp`,
    )
    expect(byId.get("generate-image/pose-board")!.previewUrl).toBeNull()
  })

  it("with no committed files at all, every previewUrl is null", async () => {
    const { factoryPresetPreviewUrl } = await vi.importActual<typeof import("@nodaro/prompts/presets")>("@nodaro/prompts/presets")
    for (const p of await factory("generate-image")) {
      expect(factoryPresetPreviewUrl(p.id, appBaseUrl(), {})).toBeNull()
    }
  })

  it("an app-settings namespace has no references and no preview", async () => {
    const data = await factory("recast-render")
    expect(data.length).toBeGreaterThan(0)
    for (const p of data) expect(p).toMatchObject({ minReferences: 0, needsImage: false, previewUrl: null })
  })
})

describe("user presets — reference counts and the stored preview", () => {
  it("a user preset counts its {image:N} tokens and returns its stored preview (null when unset)", async () => {
    fromMock.mockReturnValue(
      makeQB({
        rows: [
          { id: "p1", user_id: USER, node_type: "generate-image", name: "Swap", description: null, data: { prompt: "{image:1:person} holds {image:2:product}" }, preview_url: "https://cdn.example.test/images/j1.png", created_at: "", updated_at: "" },
          { id: "p2", user_id: USER, node_type: "generate-image", name: "Plain", description: null, data: { prompt: "a fox" }, created_at: "", updated_at: "" },
        ],
      }),
    )
    const res = await (await app()).inject({ method: "GET", url: "/v1/node-presets?nodeType=generate-image" })
    expect(res.json().data[0]).toMatchObject({ minReferences: 2, needsImage: true, previewUrl: "https://cdn.example.test/images/j1.png" })
    expect(res.json().data[1]).toMatchObject({ minReferences: 0, needsImage: false, previewUrl: null })
  })

  const ROW = {
    id: "p3",
    user_id: USER,
    node_type: "generate-image",
    name: "Y",
    description: null,
    data: { prompt: "b" },
    preview_url: "https://cdn.example.test/images/j2.png",
    created_at: "",
    updated_at: "",
  }

  it("create checks the preview as the caller's, and stores the preset's OWN copy of it", async () => {
    const copy = copyOf("images/j2.png")
    const qb = makeQB({ single: { ...ROW, preview_url: copy } })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: ROW.preview_url },
    })
    expect(res.statusCode).toBe(201)
    expect(preview.problem).toHaveBeenCalledWith(USER, [{ label: "previewUrl", url: ROW.preview_url }])
    expect(preview.store).toHaveBeenCalledWith(USER, ["images/j2.png"])
    expect((qb.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ preview_url: copy })
    expect(res.json().data.previewUrl).toBe(copy)
    expect(preview.release).not.toHaveBeenCalled()
  })

  it("a create that fails after the copy lets the copy go", async () => {
    const qb = makeQB({ error: { code: "23505", message: "dup" } })
    fromMock.mockReturnValueOnce(makeQB({ rows: [] })).mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: ROW.preview_url },
    })
    expect(res.statusCode).toBe(409)
    expect(preview.release).toHaveBeenCalledWith(USER, [copyOf("images/j2.png")])
  })

  it("a failed copy is a 500, and nothing is written", async () => {
    preview.store.mockRejectedValueOnce(new Error("copy failed"))
    const qb = makeQB({ single: ROW })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: ROW.preview_url },
    })
    expect(res.statusCode).toBe(500)
    expect(qb.insert).not.toHaveBeenCalledWith(expect.objectContaining({ node_type: "generate-image" }))
  })

  it("create refuses a preview that fails the check, and writes nothing", async () => {
    preview.problem.mockResolvedValue("previewUrl must be an image stored on this platform")
    const qb = makeQB({ single: ROW })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: "https://elsewhere.example.com/x.png" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "previewUrl must be an image stored on this platform" })
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it("create without a preview neither checks nor sends the column (works before migration 523)", async () => {
    const qb = makeQB({ single: { ...ROW, preview_url: undefined } })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" } },
    })
    expect(res.statusCode).toBe(201)
    expect(preview.problem).not.toHaveBeenCalled()
    expect(preview.store).not.toHaveBeenCalled()
    expect((qb.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toHaveProperty("preview_url")
    expect(res.json().data.previewUrl).toBeNull()
  })

  it("create refuses a previewUrl that is not a URL, before any check", async () => {
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: "not a url" },
    })
    expect(res.statusCode).toBe(400)
    expect(preview.problem).not.toHaveBeenCalled()
  })

  it("a storage error while checking the preview is a 500, and nothing is written", async () => {
    preview.problem.mockRejectedValue(new Error("storage down"))
    const qb = makeQB({ single: ROW })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b" }, previewUrl: ROW.preview_url },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(fromMock).not.toHaveBeenCalledWith("node_presets")
    expect(preview.store).not.toHaveBeenCalled()
  })

  it("update stores a copy of a checked preview and lets the replaced one go; null clears it without a check", async () => {
    const OLD = copyOf("images/old.png")
    const qb = makeQB({ single: { ...ROW, preview_url: OLD } })
    fromMock.mockReturnValue(qb)
    const a = await app()
    const set = await a.inject({ method: "PATCH", url: "/v1/node-presets/p3", payload: { previewUrl: "https://cdn.example.test/images/new.png" } })
    expect(set.statusCode).toBe(200)
    expect(preview.problem).toHaveBeenCalledTimes(1)
    expect((qb.update as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ preview_url: copyOf("images/new.png") })
    expect(preview.release).toHaveBeenLastCalledWith(USER, [OLD])

    const cleared = await a.inject({ method: "PATCH", url: "/v1/node-presets/p3", payload: { previewUrl: null } })
    expect(cleared.statusCode).toBe(200)
    expect(preview.problem).toHaveBeenCalledTimes(1)
    expect((qb.update as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toMatchObject({ preview_url: null })
    expect(preview.release).toHaveBeenLastCalledWith(USER, [OLD])
  })

  it("an update that does not touch the preview keeps it (nothing is released)", async () => {
    fromMock.mockReturnValue(makeQB({ single: { ...ROW, preview_url: copyOf("images/old.png") } }))
    const res = await (await app()).inject({ method: "PATCH", url: "/v1/node-presets/p3", payload: { name: "Renamed" } })
    expect(res.statusCode).toBe(200)
    expect(preview.release).toHaveBeenCalledWith(USER, [])
  })

  it("delete lets the deleted preset's picture go", async () => {
    const OLD = copyOf("images/old.png")
    fromMock.mockReturnValue(makeQB({ rows: [{ ...ROW, preview_url: OLD }] }))
    const res = await (await app()).inject({ method: "DELETE", url: "/v1/node-presets/00000000-0000-4000-8000-0000000000ab" })
    expect(res.statusCode).toBe(200)
    expect(preview.release).toHaveBeenCalledWith(USER, [OLD])
  })

  it("update refuses a preview that fails the check, and writes nothing", async () => {
    preview.problem.mockResolvedValue("previewUrl points at a file that does not exist yet")
    const qb = makeQB({ single: ROW })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "PATCH",
      url: "/v1/node-presets/p3",
      payload: { previewUrl: "https://cdn.example.test/images/later.png" },
    })
    expect(res.statusCode).toBe(400)
    expect(qb.update).not.toHaveBeenCalled()
  })

  it("import checks every preview it carries (naming the entry) and stores them", async () => {
    const qb = makeQB({ rows: [] })
    fromMock.mockReturnValue(qb)
    const presets = [
      { nodeType: "generate-image", name: "A", data: { prompt: "a" } },
      { nodeType: "generate-image", name: "B", data: { prompt: "b" }, previewUrl: ROW.preview_url },
    ]
    const res = await (await app()).inject({ method: "POST", url: "/v1/node-presets/import", payload: { presets } })
    expect(res.statusCode).toBe(200)
    expect(preview.problem).toHaveBeenCalledWith(USER, [{ label: "presets[1].previewUrl", url: ROW.preview_url }])
    const inserted = (qb.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(inserted[0]).not.toHaveProperty("preview_url")
    expect(inserted[0]).not.toHaveProperty("previewUrl")
    expect(inserted[1]).toMatchObject({ preview_url: copyOf("images/j2.png") })
    expect(inserted[1]).not.toHaveProperty("previewUrl")
  })

  it("import with a bad preview imports nothing", async () => {
    preview.problem.mockResolvedValue("presets[0].previewUrl must be an image stored on this platform")
    const qb = makeQB({ rows: [] })
    fromMock.mockReturnValue(qb)
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets/import",
      payload: { presets: [{ nodeType: "generate-image", name: "A", data: { prompt: "a" }, previewUrl: "https://elsewhere.example.com/a.png" }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/^presets\[0\]\.previewUrl/)
    expect(qb.insert).not.toHaveBeenCalled()
  })
})
