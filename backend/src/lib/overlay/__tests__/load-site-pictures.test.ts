import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// The site's own address (a picture on the site needs it) and its media host.
vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>()
  return {
    ...actual,
    config: { ...actual.config, PUBLIC_URL: "https://studio.example.com", R2_PUBLIC_URL: "https://media.example.com", R2_PUBLIC_FALLBACK_DOMAIN: "" },
  }
})

import { loadOverlay, OVERLAY_CONTRACT_VERSION, resetOverlayLoadForTests } from "../load.js"
import { registerPickerPictures, resetPickerPicturesForTests } from "../../picker-pictures.js"
import { registerPresetPack, resetPresetPacks } from "../../presets/app-presets.js"
import { servedSiteDirectory, sitePictureFileProblems } from "../../site-picture-files.js"

// The loader's check that every picture an overlay named as a path on its site
// is a file of the built site (lib/site-picture-files.ts): run after register()
// and the other picture checks, where the backend sees the built site (its
// index.html); fatal through the loader's one fail path, every missing file in
// one message. Without a built site nothing is checked, and one line says so.

let site: string
let empty: string

beforeAll(() => {
  site = mkdtempSync(join(tmpdir(), "site-pictures-"))
  writeFileSync(join(site, "index.html"), "<!doctype html>")
  mkdirSync(join(site, "brand/style"), { recursive: true })
  mkdirSync(join(site, "brand/presets/folder.webp"), { recursive: true })
  for (const file of ["brand/style/cinematic.webp", "brand/style/cinematic.large.webp", "brand/style/café.png", "brand/presets/harbor.webp"]) {
    mkdirSync(join(site, file, ".."), { recursive: true })
    writeFileSync(join(site, file), "")
  }
  empty = mkdtempSync(join(tmpdir(), "site-pictures-empty-"))
})
afterAll(() => {
  rmSync(site, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
})
afterEach(() => {
  resetOverlayLoadForTests()
  resetPickerPicturesForTests()
  resetPresetPacks()
  vi.restoreAllMocks()
})

function overlayRegistering(register: () => void, siteDirectory: string | null) {
  return {
    importer: async () => ({ overlayContractVersion: OVERLAY_CONTRACT_VERSION, register }),
    packageName: "acme-overlay",
    siteDirectory,
  }
}

const data = { provider: "gpt-image-2", prompt: "a calm harbor at dawn" }

function registerBoth(picture: string, preview: string): void {
  registerPickerPictures([
    { catalogId: "style", optionId: "cinematic", pictureUrl: picture, enlargedPictureUrl: "/brand/style/cinematic.large.webp" },
    { catalogId: "person", optionId: "man", pictureUrl: "https://media.example.com/p/man.webp" },
  ])
  registerPresetPack({ nodeType: "generate-image", presets: [{ id: "generate-image/harbor", name: "Harbor", data, previewUrl: preview }] })
}

describe("loadOverlay — pictures named as paths on the site", () => {
  it("boots when every one is a file of the built site (decoded as the proxy looks it up)", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({
      ...overlayRegistering(() => {
        registerBoth("/brand/style/cinematic.webp", "/brand/presets/harbor.webp")
        registerPickerPictures([{ catalogId: "style", optionId: "anime", pictureUrl: "/brand/style/caf%C3%A9.png" }])
      }, site),
      exit,
    })
    expect(result).toEqual({ loaded: "acme-overlay" })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.some((c) => String(c[0]).includes("not checked"))).toBe(false)
  })

  it("refuses the boot, naming every missing file, picker and preset pictures alike", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadOverlay({
      ...overlayRegistering(() => registerBoth("/brand/style/missing.webp", "/brand/presets/folder.webp"), site),
      exit,
    })
    expect(result).toEqual({ loaded: null })
    expect(exit).toHaveBeenCalledWith(1)
    const message = String(error.mock.calls[0]?.[0])
    expect(message).toContain('overlay "acme-overlay" named pictures on this site that its build does not have')
    expect(message).toContain('"style/cinematic" pictureUrl "/brand/style/missing.webp" is not a file of the built site')
    // A folder at that path is not a picture.
    expect(message).toContain('preset "generate-image/harbor" previewUrl "/brand/presets/folder.webp" is not a file of the built site')
    expect(message).not.toContain("cinematic.large.webp")
    expect(message).not.toContain("media.example.com")
    expect(log.mock.calls.some((c) => String(c[0]).includes("loaded acme-overlay"))).toBe(false)
  })

  it("without a built site, boots without checking, and says so in one line", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await loadOverlay({ ...overlayRegistering(() => registerBoth("/brand/style/missing.webp", "/brand/presets/missing.webp"), null), exit })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("not checked"))).toEqual([
      expect.stringMatching(/^\[overlay\] acme-overlay: 3 pictures are paths on this site; no built site at .*frontend[/\\]dist[/\\]?, so their files were not checked here$/),
    ])
  })

  it("with no picture on the site, nothing is looked up and nothing is said", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await loadOverlay({
      ...overlayRegistering(() => registerPickerPictures([{ catalogId: "style", optionId: "cinematic", pictureUrl: "https://media.example.com/p/a.webp" }]), empty),
      exit,
    })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.some((c) => String(c[0]).includes("paths on this site"))).toBe(false)
  })
})

describe("the built site the backend can see", () => {
  it("is a directory holding a build (its index.html), else none", () => {
    expect(servedSiteDirectory(site)).toBe(site)
    expect(servedSiteDirectory(empty)).toBeNull()
    expect(servedSiteDirectory(join(site, "no-such-dir"))).toBeNull()
  })

  it("names each picture whose file is missing, and nothing for those that exist", () => {
    expect(
      sitePictureFileProblems(
        [
          { where: "a", path: "/brand/style/cinematic.webp" },
          { where: "b", path: "/brand/style/caf%C3%A9.png" },
          { where: "c", path: "/brand/style/gone.webp" },
        ],
        site,
      ),
    ).toEqual([`c "/brand/style/gone.webp" is not a file of the built site (${join(site, "brand/style/gone.webp")})`])
  })
})
