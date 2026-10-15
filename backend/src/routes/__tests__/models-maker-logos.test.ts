import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { MODEL_CATALOG, modelMakerOf } from "@nodaro/shared/model-catalog"

/**
 * GET /v1/models — `maker` and `logoUrl` end to end: the operator's
 * declaration (an `app_settings` row, read through the real settings reader),
 * the storage check (a HEAD against the bucket) and the convention address.
 * Only storage's HEAD, the database and the price shim are stand-ins.
 */
const h = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: unknown }>,
  head: vi.fn(),
}))

vi.mock("../../lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...orig,
    config: {
      ...orig.config,
      R2_PUBLIC_URL: "https://cdn.example.com",
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
    },
  }
})

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      return { select: async () => ({ data: h.rows, error: null }) }
    },
  },
}))

vi.mock("../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage.js")>()),
  headR2Object: h.head,
}))

// The prices come from the billing module; these cases are not about prices.
vi.mock("../../lib/pricing/charged-prices.js", () => ({
  loadChargedPrices: async () => ({ credits: () => undefined }),
}))

const { modelsRoutes } = await import("../models.js")
const { invalidateSettingsCache } = await import("../../lib/app-settings.js")
const { __resetMakerLogoCacheForTests } = await import("../../lib/maker-logos.js")

interface ServedModel {
  id: string
  maker?: { id: string; name: string }
  logoUrl: string | null
}

function servedModels(body: { sections: { families: { models: ServedModel[] }[] }[] }): ServedModel[] {
  return body.sections.flatMap((s) => s.families.flatMap((f) => f.models))
}

let app: FastifyInstance

async function list(): Promise<ServedModel[]> {
  const res = await app.inject({ method: "GET", url: "/v1/models" })
  expect(res.statusCode).toBe(200)
  return servedModels(res.json())
}

beforeEach(async () => {
  h.rows = []
  h.head.mockReset()
  invalidateSettingsCache()
  __resetMakerLogoCacheForTests()
  app = Fastify({ logger: false })
  await app.register(modelsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/models — maker and logoUrl", () => {
  it("every model names its maker: the catalog's company id and the company's name", async () => {
    const models = await list()
    expect(models.length).toBeGreaterThan(50)
    for (const m of models) expect(m.maker, m.id).toEqual(modelMakerOf(MODEL_CATALOG[m.id]!))
    expect(models.every((m) => m.maker !== undefined)).toBe(true)
  })

  it("logoUrl is null on every model while no mark is declared, and storage is never asked", async () => {
    const models = await list()
    expect(models.every((m) => m.logoUrl === null)).toBe(true)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("a declared mark the bucket holds is served at the convention address, on its maker's models only", async () => {
    h.rows = [{ key: "model_maker_logos", value: ["google"] }]
    h.head.mockResolvedValue({
      exists: true,
      etag: '"0123456789abcdef0123456789abcdef"',
      lastModified: new Date("2026-10-15T08:00:00Z"),
      contentType: "image/svg+xml",
    })
    const models = await list()
    const google = models.filter((m) => m.maker?.id === "google")
    expect(google.map((m) => m.id)).toContain("veo3")
    const address = google[0]!.logoUrl
    expect(address).toMatch(/^https:\/\/cdn\.example\.com\/brand\/makers\/google\.svg\?v=[0-9a-f]{16}$/)
    for (const m of google) expect(m.logoUrl).toBe(address)
    expect(models.filter((m) => m.maker?.id !== "google").every((m) => m.logoUrl === null)).toBe(true)
    expect(h.head).toHaveBeenCalledTimes(1)
    expect(h.head).toHaveBeenCalledWith("brand/makers/google.svg", { abortSignal: expect.any(AbortSignal) })
  })

  it("a declared mark the bucket does not hold yet is never served", async () => {
    h.rows = [{ key: "model_maker_logos", value: ["google"] }]
    h.head.mockResolvedValue({ exists: false })
    const models = await list()
    expect(models.every((m) => m.logoUrl === null)).toBe(true)
  })

  it("a declared file stored as anything but an SVG is never served", async () => {
    h.rows = [{ key: "model_maker_logos", value: ["google"] }]
    h.head.mockResolvedValue({ exists: true, etag: '"aa"', contentType: "application/octet-stream" })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const models = await list()
    expect(models.every((m) => m.logoUrl === null)).toBe(true)
    warn.mockRestore()
  })

  it("an id in the declaration that names no maker is ignored — no address, no storage call", async () => {
    h.rows = [{ key: "model_maker_logos", value: ["acme", "Google", "brand/makers/google"] }]
    const models = await list()
    expect(models.every((m) => m.logoUrl === null)).toBe(true)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("a catalog entry naming no known maker is listed without one — the listing does not fail", async () => {
    // An entry built at run time (a test fixture, a hand edit) without a maker.
    MODEL_CATALOG["no-maker-probe"] = { ...MODEL_CATALOG["veo3"]!, id: "no-maker-probe", maker: "acme" as never }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const probe = (await list()).find((m) => m.id === "no-maker-probe")
      expect(probe).toBeDefined()
      expect(probe).not.toHaveProperty("maker")
      expect(probe!.logoUrl).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no-maker-probe"))
    } finally {
      delete MODEL_CATALOG["no-maker-probe"]
      warn.mockRestore()
    }
  })
})
