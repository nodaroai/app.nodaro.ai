import { afterEach, describe, expect, it, vi } from "vitest"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { loadOverlay, OVERLAY_CONTRACT_VERSION, resetOverlayLoadForTests } from "../load.js"
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
