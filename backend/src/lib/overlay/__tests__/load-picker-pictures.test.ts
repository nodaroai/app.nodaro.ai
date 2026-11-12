import { afterEach, describe, expect, it, vi } from "vitest"

// The install's media host: the one host a registered picture may be on.
vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>()
  return { ...actual, config: { ...actual.config, R2_PUBLIC_URL: "https://media.example.com", R2_PUBLIC_FALLBACK_DOMAIN: "" } }
})

import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { loadOverlay, OVERLAY_CONTRACT_VERSION, resetOverlayLoadForTests } from "../load.js"
import { getRegisteredPickerPictures, registerPickerPictures, resetPickerPicturesForTests } from "../../picker-pictures.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"

// The loader's check on the picker pictures an overlay registered
// (lib/picker-pictures-check.ts): run after register(), so it sees the
// overlay's catalog packs; fatal through the loader's one fail path, like a
// preset pack's. A refusal at registration (a foreign host) is a register()
// throw, fatal the same way. With pictures registered, one summary line.

const picture = (name: string) => `https://media.example.com/pictures/${name}.webp`

function overlayRegistering(register: () => void) {
  return { importer: async () => ({ overlayContractVersion: OVERLAY_CONTRACT_VERSION, register }), packageName: "acme-overlay" }
}

function setImages(images: string): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ catalogs: { images } })
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  resetOverlayLoadForTests()
  resetPickerPicturesForTests()
  resetCatalogPacks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  vi.restoreAllMocks()
})

describe("loadOverlay — picker pictures the overlay registered", () => {
  it("boots, and logs one summary line, with pictures that fit — an option without one is no problem", async () => {
    setImages("own")
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({
      ...overlayRegistering(() =>
        registerPickerPictures([
          { catalogId: "style", optionId: "cinematic", pictureUrl: picture("a"), enlargedPictureUrl: picture("a-large") },
          { catalogId: "person", optionId: "man", pictureUrl: picture("b") },
        ]),
      ),
      exit,
    })
    expect(result).toEqual({ loaded: "acme-overlay" })
    expect(exit).not.toHaveBeenCalled()
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("own pictures"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[overlay\] acme-overlay: own pictures for 2 of \d+ picker options: style 1 of \d+, person 1 of \d+ \(\d+ other catalogs have none\)$/)
  })

  it("judges the options against the overlay's own catalog packs, whatever order register() used", async () => {
    setImages("own")
    const exit = vi.fn() as unknown as (code: number) => never
    vi.spyOn(console, "log").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() => {
        registerPickerPictures([{ catalogId: "setting", optionId: "acme-harbor", pictureUrl: picture("harbor") }])
        registerCatalogPack({
          id: "acme-settings",
          catalogId: "setting",
          mode: "extend",
          options: [{ id: "acme-harbor", label: "Harbor", description: "A harbor", category: "outdoor", promptHint: "a harbor" }],
        })
      }),
      exit,
    })
    expect(exit).not.toHaveBeenCalled()
  })

  it("refuses the boot, naming every problem, for options the deployment does not have", async () => {
    setImages("own")
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({
      ...overlayRegistering(() =>
        registerPickerPictures([
          { catalogId: "no-such-catalog", optionId: "x", pictureUrl: picture("a") },
          { catalogId: "style", optionId: "no-such-style", pictureUrl: picture("b") },
        ]),
      ),
      exit,
    })
    expect(result).toEqual({ loaded: null })
    expect(exit).toHaveBeenCalledWith(1)
    const message = String(error.mock.calls[0]?.[0])
    expect(message).toContain('registered picker pictures for options this deployment does not have')
    expect(message).toContain('no picker catalog "no-such-catalog"')
    expect(message).toContain('"no-such-style" is not an option of this deployment\'s "style" catalog')
    expect(log.mock.calls.some((c) => String(c[0]).includes("loaded acme-overlay"))).toBe(false)
  })

  it("refuses the boot when register() offers an address on another host", async () => {
    setImages("own")
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() =>
        registerPickerPictures([{ catalogId: "style", optionId: "cinematic", pictureUrl: "https://cdn.nodaro.ai/picker-renders/x.webp" }]),
      ),
      exit,
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toMatch(/register\(\) threw: picker pictures: .*not an https address on this install's media host \(https:\/\/media\.example\.com\)/)
    expect(getRegisteredPickerPictures()).toEqual([])
  })

  it('says the pictures are not shown when catalogs.images is not "own"', async () => {
    setImages("none")
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() => registerPickerPictures([{ catalogId: "style", optionId: "cinematic", pictureUrl: picture("a") }])),
      exit,
    })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("own pictures"))).toEqual([
      expect.stringMatching(/not shown: this deployment's catalogs\.images is not "own"$/),
    ])
  })

  it("an overlay that registers no picture logs no picture line", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await loadOverlay({ ...overlayRegistering(() => {}), exit })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual(["[overlay] loaded acme-overlay"])
  })
})
