import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { ModelMaker, ModelsListResult, ModelSummary } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const GOOGLE: ModelMaker = { id: "google", name: "Google" }

const VEO: ModelSummary = {
  id: "veo3",
  label: "VEO 3.1 Quality",
  maker: GOOGLE,
  logoUrl: "https://cdn.example.com/brand/makers/google.svg?v=9b2cf535f27731c9",
  description: "Top-quality narrative video with audio.",
  modes: ["i2v", "t2v"],
  useCases: ["cinematic"],
  doctrineCovered: true,
}

const KLING: ModelSummary = {
  id: "kling-3.0",
  label: "Kling 3.0",
  maker: { id: "kuaishou", name: "Kuaishou" },
  logoUrl: null,
  description: "Music-synced motion.",
  modes: ["i2v", "t2v"],
  useCases: ["motion"],
  doctrineCovered: false,
}

const CATALOG: ModelsListResult = {
  sections: [
    {
      kind: "video",
      families: [
        { family: "Google", models: [VEO] },
        { family: "Kuaishou", models: [KLING] },
      ],
    },
  ],
  recommendations: [],
  totalModels: 2,
}

function client(fetchMock: typeof fetch) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

describe("models resource", () => {
  it("list() GETs /v1/models with no query by default", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(CATALOG))
    await client(fetchMock).models.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/models")
  })

  it("list() sends the kind / mode / family / featuredOnly filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(CATALOG))
    await client(fetchMock).models.list({ kind: "video", mode: "i2v", family: "Google", featuredOnly: true })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/v1/models?")
    expect(url).toContain("kind=video")
    expect(url).toContain("mode=i2v")
    expect(url).toContain("family=Google")
    expect(url).toContain("featuredOnly=true")
  })

  it("a model from an older server — no maker, no logoUrl — is still a ModelSummary", async () => {
    const older: ModelSummary = {
      id: "veo3",
      label: "VEO 3.1 Quality",
      description: "Top-quality narrative video with audio.",
      modes: ["i2v", "t2v"],
      useCases: ["cinematic"],
      doctrineCovered: true,
    }
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      mockOk({ ...CATALOG, sections: [{ kind: "video", families: [{ family: "Google", models: [older] }] }] }),
    )
    const res = await client(fetchMock).models.list()
    const m = res.sections[0]!.families[0]!.models[0]!
    expect(m.maker?.name ?? "Google").toBe("Google")
    expect(m.logoUrl ?? null).toBeNull()
  })

  it("each model carries its maker and the maker's mark — or null where the deployment publishes none", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(CATALOG))
    const res = await client(fetchMock).models.list({ kind: "video" })
    const models = res.sections.flatMap((s) => s.families.flatMap((f) => f.models))
    expect(models.map((m) => [m.id, m.maker?.id, m.maker?.name, m.logoUrl])).toEqual([
      ["veo3", "google", "Google", "https://cdn.example.com/brand/makers/google.svg?v=9b2cf535f27731c9"],
      ["kling-3.0", "kuaishou", "Kuaishou", null],
    ])
  })
})
