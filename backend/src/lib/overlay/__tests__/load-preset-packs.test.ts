// @test-watches backend/src/lib/private-plugins/load.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// A catalog with one entry offered under the deployment's own label (a house model).
vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/model-catalog")>()
  return {
    ...actual,
    MODEL_CATALOG: {
      ...actual.MODEL_CATALOG,
      "house-fixture": {
        id: "house-fixture", kind: "image", modes: ["t2i"], family: "House Fixture", ownLabel: true,
        label: "House Fixture", series: "House Fixture", description: "A fixture.", useCases: [], pricing: [{ identifier: "house-fixture", credits: 1 }],
      },
    },
  }
})

import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { loadOverlay, OVERLAY_CONTRACT_VERSION, resetOverlayLoadForTests, warnOverlayPresetPacksOnHouseModels } from "../load.js"
import { runOverlayChecksAfterPlugins } from "../after-plugins.js"
import { _resetPluginServicesForTests, setPluginServices } from "../../private-plugins/services-registry.js"
import type { PluginHouseModelsService } from "../../private-plugins/types.js"
import { resetOwnLabelModelIdsForTests } from "../../house-models-served.js"
import { isModelDenied } from "../../surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { presetCatalog, registerPresetPack, resetPresetPacks } from "../../presets/app-presets.js"

// The loader's own check on what an overlay registered: a preset pack must fit
// this deployment (lib/presets/preset-pack-check.ts). Run after register(), so
// it sees the overlay's catalog packs; fatal through the loader's one fail path.

const LOOK = {
  id: "generate-image/overlay-look",
  name: "Overlay look",
  data: { provider: "gpt-image-2", prompt: "a calm lake at dawn", style: "anime" },
}

function overlayRegistering(register: () => void) {
  return { importer: async () => ({ overlayContractVersion: OVERLAY_CONTRACT_VERSION, register }), packageName: "acme-overlay" }
}

afterEach(() => {
  _resetPluginServicesForTests()
  resetOwnLabelModelIdsForTests()
  resetOverlayLoadForTests()
  resetPresetPacks()
  resetCatalogPacks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  vi.restoreAllMocks()
})

describe("loadOverlay — preset packs the overlay registered", () => {
  it("boots with a pack that fits, and the pack is served", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({ ...overlayRegistering(() => registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })), exit })
    expect(result).toEqual({ loaded: "acme-overlay" })
    expect(exit).not.toHaveBeenCalled()
    expect(presetCatalog("generate-image").at(-1)).toEqual(LOOK)
  })

  it("refuses the boot, naming every problem, when a pack does not fit", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["gpt-image-2"] } })
    __resetSurfaceProfileCacheForTests()
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({
      ...overlayRegistering(() =>
        registerPresetPack({
          nodeType: "generate-image",
          presets: [{ ...LOOK, data: { ...LOOK.data, direction: { lens: "no-such-lens" } } }],
        }),
      ),
      exit,
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(result).toEqual({ loaded: null })
    const message = String(error.mock.calls[0]?.[0])
    expect(message).toMatch(/^\[overlay\] FATAL: overlay "acme-overlay" registered preset packs this deployment cannot serve/)
    expect(message).toContain('data.provider names model "gpt-image-2"')
    expect(message).toContain('data.direction.lens "no-such-lens"')
    expect(log).not.toHaveBeenCalledWith("[overlay] loaded acme-overlay")
  })

  it("judges a pack against the catalogs as register() left them", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() => {
        registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })
        // Registered AFTER the pack: the check still sees it.
        registerCatalogPack({ id: "acme-no-anime", catalogId: "style", mode: "deny", denyIds: ["anime"] })
      }),
      exit,
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('data.style "anime" is not an option of this deployment\'s "style" catalog')
  })

  it("a register() that throws on a colliding id is fatal as before", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() =>
        registerPresetPack({ nodeType: "generate-image", presets: [{ ...LOOK, id: "generate-image/character-board" }] }),
      ),
      exit,
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toMatch(/register\(\) threw: .*factory preset/)
  })
})

describe("preset packs naming a house model: a warning, never a boot refusal", () => {
  const HOUSE_LOOK = { ...LOOK, id: "generate-image/overlay-house-look", data: { ...LOOK.data, provider: "house-fixture" } }
  const registeringHouseLook = () => overlayRegistering(() => registerPresetPack({ nodeType: "generate-image", presets: [HOUSE_LOOK] }))
  const WARNING =
    '[overlay] acme-overlay: preset pack for "generate-image": preset "generate-image/overlay-house-look" names house model "house-fixture" (data.provider), ' +
    "which this process does not serve — the preset is refused when it runs"

  function plugins(served: readonly string[]): void {
    const houseModels: PluginHouseModelsService = {
      ids: () => served,
      plan: () => ({ providerCostUsd: 0 }),
      start: async () => ({ taskRef: "r" }),
      poll: async () => ({ state: "running" }),
    }
    setPluginServices({ houseModels })
  }

  /** The preset's own run, as the workflow engine builds it: refused before any hold where the model is withheld. */
  async function runThePreset(): Promise<unknown> {
    const { buildPayload } = await import("../../../services/workflow-engine/payload-builder.js")
    const node = { id: "n-1", type: "generate-image", data: { ...HOUSE_LOOK.data } }
    try {
      buildPayload(node, "job-1", {}, undefined, { nodes: [node], edges: [], nodeStates: {} })
      return undefined
    } catch (err) {
      return err
    }
  }

  it("a deployment that serves it boots with no warning, and the preset runs", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // The API's order: the overlay loads first (app.ts), the plugins after.
    await expect(loadOverlay({ ...registeringHouseLook(), exit })).resolves.toEqual({ loaded: "acme-overlay" })
    plugins(["house-fixture"])
    await runOverlayChecksAfterPlugins()
    expect(exit).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(presetCatalog("generate-image").at(-1)).toEqual(HOUSE_LOOK)
    expect(isModelDenied("house-fixture")).toBe(false)
    expect(((await runThePreset()) as { code?: unknown } | undefined)?.code).not.toBe("model_not_available")
  })

  it("a deployment that does not serve it WARNS (pack, preset, model) and boots — and the preset is refused when it runs", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(loadOverlay({ ...registeringHouseLook(), exit })).resolves.toEqual({ loaded: "acme-overlay" })
    // The plugins load and do not serve it (its key is absent in this process; a community install loads none).
    plugins([])
    await runOverlayChecksAfterPlugins()
    expect(exit).not.toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([WARNING])
    // Its run: refused before any hold, like any withheld model.
    expect(isModelDenied("house-fixture")).toBe(true)
    expect(await runThePreset()).toMatchObject({ code: "model_not_available" })
  })

  it("where the plugins load first (the video worker), the overlay's own load warns, once", async () => {
    plugins([])
    const exit = vi.fn() as unknown as (code: number) => never
    vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(loadOverlay({ ...registeringHouseLook(), exit })).resolves.toEqual({ loaded: "acme-overlay" })
    await runOverlayChecksAfterPlugins()
    expect(exit).not.toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([WARNING])
  })

  it("a model the profile withholds still refuses the boot", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["gpt-image-2"] } })
    __resetSurfaceProfileCacheForTests()
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadOverlay({ ...overlayRegistering(() => registerPresetPack({ nodeType: "generate-image", presets: [LOOK] })), exit })
    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('generate-image/overlay-look: data.provider names model "gpt-image-2", which this deployment does not offer')
  })

  it("no overlay, nothing to look at", async () => {
    plugins([])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(warnOverlayPresetPacksOnHouseModels()).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("the plugin loader runs the overlay's check after every load", () => {
    const src = readFileSync(fileURLToPath(new URL("../../private-plugins/load.ts", import.meta.url)), "utf8")
    const entry = src.slice(src.indexOf("export async function loadPrivatePlugins("), src.indexOf("async function loadPrivatePluginsOnce("))
    expect(entry).toContain("const result = await loadPrivatePluginsOnce(opts)")
    expect(entry.indexOf("await runOverlayChecksAfterPlugins()")).toBeGreaterThan(entry.indexOf("loadPrivatePluginsOnce(opts)"))
  })
})
