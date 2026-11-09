/**
 * The preset-pack seam: a deployment registers its own presets beside (or, with
 * `catalogs.factoryPresets: false`, instead of) the bundled factory catalog, and
 * `presetCatalog` — the one funnel every factory-preset reader goes through —
 * serves them. With no pack registered nothing changes, down to the reference.
 *
 * The boot check on what a pack names (models, picker ids, preview URL) is
 * covered in preset-pack-check.test.ts; the loader's fatal path in
 * lib/overlay/__tests__/load-preset-packs.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { getFactoryPresets } from "@nodaro/prompts/presets"

// resolvePreset's custom-preset path reads the database; these cases never reach it.
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { getRegisteredPresetPacks, presetCatalog, registerPresetPack, resetPresetPacks } = await import("../app-presets.js")
const { factoryPresetView } = await import("../preset-view.js")
const { resolvePreset } = await import("../resolve-preset.js")

const LOOK = {
  id: "generate-image/deployment-look",
  name: "Deployment look",
  description: "A preset the deployment ships.",
  group: "Deployment",
  data: { provider: "gpt-image-2", prompt: "a calm lake at dawn", aspectRatio: "16:9", style: "anime" },
}

function withProfile(profile: Record<string, unknown>): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  resetPresetPacks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("presetCatalog with no pack registered — unchanged", () => {
  it("serves the bundled catalog itself", () => {
    expect(getRegisteredPresetPacks()).toEqual([])
    expect(presetCatalog("generate-image")).toBe(getFactoryPresets("generate-image"))
  })

  it("serves nothing when the deployment switches factory presets off", () => {
    withProfile({ catalogs: { required: true, factoryPresets: false } })
    expect(presetCatalog("generate-image")).toEqual([])
  })

  it("a pack for another node type leaves this one's catalog as it was", () => {
    registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
    expect(presetCatalog("generate-video")).toBe(getFactoryPresets("generate-video"))
  })
})

describe("presetCatalog with a pack registered", () => {
  it("factory presets on: the bundled catalog, then the pack", () => {
    registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
    const served = presetCatalog("generate-image")
    const factory = getFactoryPresets("generate-image")
    expect(served).toHaveLength(factory.length + 1)
    expect(served.slice(0, factory.length)).toEqual(factory)
    expect(served.at(-1)).toEqual(LOOK)
  })

  it("factory presets off: only the pack", () => {
    withProfile({ catalogs: { required: true, factoryPresets: false } })
    registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
    expect(presetCatalog("generate-image")).toEqual([LOOK])
  })

  it("serves a node type that has no bundled presets", () => {
    const asset = { id: "generate-3d/deployment-asset", name: "Asset", data: { prompt: "a small wooden chair" } }
    registerPresetPack({ nodeType: "generate-3d", presets: [asset] })
    expect(presetCatalog("generate-3d")).toEqual([asset])
  })

  it("serves several packs for one node type in registration order", () => {
    const second = { ...LOOK, id: "generate-image/deployment-look-2", name: "Second look" }
    registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
    registerPresetPack({ nodeType: "generate-image", presets: [second] })
    withProfile({ catalogs: { required: true, factoryPresets: false } })
    expect(presetCatalog("generate-image").map((p) => p.id)).toEqual([LOOK.id, second.id])
  })

  it("an app namespace takes a pack too, after its own presets", () => {
    const recast = presetCatalog("recast-render")
    const render = { id: "recast-render/deployment-render", name: "Deployment render", data: { ...recast[0]!.data } }
    registerPresetPack({ nodeType: "recast-render", presets: [render] })
    expect(presetCatalog("recast-render").map((p) => p.id)).toEqual([...recast.map((p) => p.id), render.id])
  })
})

/** An app-namespace preset built from the first bundled one, under a new id. */
function recastPreset(id: string, data: Record<string, unknown> = {}) {
  return { id, name: "Render", data: { ...presetCatalog("recast-render")[0]!.data, ...data } }
}

describe("registerPresetPack refuses what it cannot serve", () => {
  it("an id a factory preset already uses, on any node type", () => {
    expect(() =>
      registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, id: "generate-image/character-board" }] }),
    ).toThrow(/factory preset/)
    const recastId = presetCatalog("recast-render")[0]!.id
    expect(() => registerPresetPack({ nodeType: "recast-render", presets: [recastPreset(recastId)] })).toThrow(
      /factory preset/,
    )
  })

  it("an id an earlier pack registered", () => {
    registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
    expect(() => registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })).toThrow(/already registered/)
  })

  it("the same id twice inside one pack", () => {
    expect(() => registerPresetPack({ nodeType: "generate-image", presets: [LOOK, LOOK] })).toThrow(/already registered/)
  })

  it("an id outside its node type's namespace", () => {
    for (const id of ["deployment-look", "generate-video/deployment-look", "generate-image/", ""]) {
      expect(() => registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, id }] }), id).toThrow(
        /must be "generate-image\/<slug>"/,
      )
    }
  })

  it("a preset with no name", () => {
    expect(() => registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, name: " " }] })).toThrow(/name/)
  })

  it("data that is not an object", () => {
    for (const data of [null, [], "a prompt"]) {
      expect(() =>
        registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, data: data as never }] }),
      ).toThrow(/data/)
    }
  })

  it("data holding keys a preset never carries (labels, run state)", () => {
    expect(() =>
      registerPresetPack({
        nodeType: "generate-image",
        presets: [{ ...LOOK, data: { ...LOOK.data, label: "My node", executionStatus: "completed" } }],
      }),
    ).toThrow(/label.*executionStatus|executionStatus.*label/)
  })

  it("app-namespace data that breaks its contract", () => {
    expect(() =>
      registerPresetPack({ nodeType: "recast-render", presets: [recastPreset("recast-render/bad", { resolution: "8k" })] }),
    ).toThrow(/breaks the "recast-render" contract/)
  })

  it("app-namespace data its contract would rewrite", () => {
    expect(() =>
      registerPresetPack({ nodeType: "recast-render", presets: [recastPreset("recast-render/padded", { provider: " seedance-2-5 " })] }),
    ).toThrow(/not in the form the "recast-render" contract stores/)
  })

  it("a node type that is not a plain name", () => {
    for (const nodeType of ["", " generate-image", 42]) {
      expect(() => registerPresetPack({ nodeType: nodeType as never, presets: [LOOK] }), String(nodeType)).toThrow(
        /node type/,
      )
    }
  })

  it("a refused pack registers none of its presets", () => {
    const fine = { ...LOOK, id: "generate-image/fine" }
    expect(() =>
      registerPresetPack({ nodeType: "generate-image", presets: [fine, { ...LOOK, id: "generate-image/character-board" }] }),
    ).toThrow()
    expect(getRegisteredPresetPacks()).toEqual([])
    expect(() => registerPresetPack({ nodeType: "generate-image", presets: [fine] })).not.toThrow()
  })
})

describe("what is registered is what is served", () => {
  it("stores a copy: a later change to the caller's object changes nothing", () => {
    const mine = { ...LOOK, data: { ...LOOK.data } }
    registerPresetPack({ nodeType: "generate-image", presets: [mine] })
    mine.data.provider = "some-other-model"
    mine.name = "Renamed"
    const served = presetCatalog("generate-image").at(-1)!
    expect(served.data.provider).toBe("gpt-image-2")
    expect(served.name).toBe("Deployment look")
  })
})

describe("a pack preset over the API", () => {
  it("carries its own example picture, and no srcset", () => {
    const pictured = { ...LOOK, previewUrl: "https://media.example.test/presets/deployment-look.webp" }
    const view = factoryPresetView("generate-image", pictured)
    expect(view.previewUrl).toBe(pictured.previewUrl)
    expect(view).not.toHaveProperty("previewSrcSet")
    expect(view).toMatchObject({ id: LOOK.id, name: LOOK.name, group: LOOK.group, data: LOOK.data, needsImage: false })
  })

  it("has no picture when it names none", () => {
    expect(factoryPresetView("generate-image", LOOK).previewUrl).toBeNull()
  })

  it("counts the reference photos its prompt asks for, like a factory preset", () => {
    const fromPhoto = { ...LOOK, data: { ...LOOK.data, prompt: "restyle {image:1} as a watercolor" } }
    expect(factoryPresetView("generate-image", fromPhoto)).toMatchObject({ minReferences: 1, needsImage: true })
  })

  it("resolves by id, like a factory preset", async () => {
    registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, previewUrl: "https://media.example.test/x.webp" }] })
    const resolved = await resolvePreset({ nodeType: "generate-image", presetId: LOOK.id })
    expect(resolved).toMatchObject({
      id: LOOK.id,
      source: "factory",
      data: LOOK.data,
      previewUrl: "https://media.example.test/x.webp",
    })
  })
})
