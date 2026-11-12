import { describe, it, expect, expectTypeOf, vi } from "vitest"
import type { DeclaredSeedanceTaskType } from "@nodaro/shared/models"
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

  // vitest does not typecheck: the `@ts-expect-error` lines below are held by
  // CI's "SDK type tests" step (`tsc -p packages/client/tsconfig.type-tests.json`).
  it("types the sizes a ratio renders and the transparent background's size", async () => {
    const gptImage25: ModelSummary = {
      id: "gpt-image-2-5-flare",
      label: "GPT Image 2.5 Flare",
      maker: { id: "openai", name: "OpenAI" },
      description: "Ultra-wide and near-square cinema ratios.",
      modes: ["t2i"],
      useCases: ["typography"],
      aspectRatios: ["1:1", "16:9", "27:16", "16:27", "9:8", "8:9"],
      resolutions: ["1K", "2K", "4K"],
      resolutionsByAspectRatio: { "27:16": ["1K"], "16:27": ["1K"], "9:8": ["1K"], "8:9": ["1K"] },
      backgrounds: ["auto", "opaque", "transparent"],
      transparentResolution: "1K",
      backgroundOnlyAtTransparentResolution: true,
      doctrineCovered: false,
    }
    const seedance: ModelSummary = { ...VEO, id: "seedance-2-fast", durations: [4, 8, 15], defaultDuration: 8, autoDuration: true }
    // @ts-expect-error — the sizes of a ratio are a list
    const notAList: ModelSummary = { ...gptImage25, resolutionsByAspectRatio: { "27:16": "1K" } }
    // @ts-expect-error — one size, not a list
    const severalSizes: ModelSummary = { ...gptImage25, transparentResolution: ["1K"] }
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      mockOk({ ...CATALOG, sections: [{ kind: "image", families: [{ family: "OpenAI", models: [gptImage25] }] }] }),
    )
    const m = (await client(fetchMock).models.list({ kind: "image" })).sections[0]!.families[0]!.models[0]!
    // A size menu at a ratio: the ratio's own list, else every size.
    const sizesAt = (ratio: string) => m.resolutionsByAspectRatio?.[ratio] ?? m.resolutions
    expect(sizesAt("27:16")).toEqual(["1K"])
    expect(sizesAt("16:9")).toEqual(["1K", "2K", "4K"])
    expect(m.transparentResolution).toBe("1K")
    expect(m.backgroundOnlyAtTransparentResolution).toBe(true)
    expect([seedance.defaultDuration, seedance.autoDuration, notAList, severalSizes]).toHaveLength(4)
  })

  it("types the reference task types a model takes as the values the platform declares", async () => {
    const seedance25: ModelSummary = { ...VEO, id: "seedance-2-5", autoDuration: true, defaultDuration: 8, referenceTaskTypes: ["reference", "edit", "extend"] }
    // @ts-expect-error — "auto" is the default, never a listed value
    const withAuto: ModelSummary = { ...seedance25, referenceTaskTypes: ["auto"] }
    expectTypeOf<NonNullable<ModelSummary["referenceTaskTypes"]>[number]>().toEqualTypeOf<DeclaredSeedanceTaskType>()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      mockOk({ ...CATALOG, sections: [{ kind: "video", families: [{ family: "Bytedance", models: [seedance25, KLING] }] }] }),
    )
    const [m, other] = (await client(fetchMock).models.list({ kind: "video" })).sections[0]!.families[0]!.models
    expect(m!.referenceTaskTypes).toEqual(["reference", "edit", "extend"])
    expect(other!.referenceTaskTypes).toBeUndefined()
    expect(withAuto).toBeDefined()
  })
})
