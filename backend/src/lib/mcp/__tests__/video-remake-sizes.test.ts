// @test-reads-none the settings and the engine's declaration are faked in memory
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The sizes `video_remake` names (lib/mcp/video-remake-sizes.ts): the sizes the
 * deployment's engine really offers per engine choice, read as
 * `GET /v1/video-remake/style-choice` reads its `resolutions`, so the tool never
 * names a size the route would refuse; the engine's own sizes where it does not
 * deliver resolutions; no size at all where the settings could not be read.
 */
const h = vi.hoisted(() => ({ cloud: true, preciseUpscale: null as unknown, failed: false, throws: false, reads: 0, topazDisabled: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../config.js")>()), hasCredits: () => h.cloud }))
vi.mock("../../app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app-settings.js")>()),
  getAppSettings: async () => {
    h.reads++
    if (h.throws) throw new Error("boom")
    return { nodaro_motion_precise_upscale: h.preciseUpscale }
  },
  settingsReadFailed: () => h.failed,
}))
vi.mock("../../topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => h.topazDisabled }))

const { resolveVideoRemakeSizes, videoRemakeResolutionArg, videoRemakeResolutionSentence, videoRemakeSizesShape } = await import("../video-remake-sizes.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../private-plugins/supports-registry.js")

// The engine's own declaration, as style-choice's tests build it.
const DELIVERED = {
  "nodaro-prism": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-pulse": [{ size: "720p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-prism-flash": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p" }],
  "nodaro-pulse-flash": [{ size: "720p", native: true }, { size: "1080p", from: "720p" }],
}
const TAKES = { upscaleChoice: true, preciseUpscale: true, deliveredResolution: true, deliveredResolutions: DELIVERED }

beforeEach(() => {
  Object.assign(h, { cloud: true, preciseUpscale: null, failed: false, throws: false, reads: 0, topazDisabled: false })
})
afterEach(() => _resetPluginSupportsForTests())

describe("resolveVideoRemakeSizes", () => {
  it("answers each engine choice's sizes offered here, every row on", async () => {
    setPluginSupports({ castSwap: TAKES } as never)
    expect(await resolveVideoRemakeSizes()).toEqual({
      kind: "delivered",
      resolutions: { "nodaro-prism": ["720p", "1080p", "4k"], "nodaro-pulse": ["720p", "1080p", "4k"], "nodaro-prism-flash": ["720p", "1080p"], "nodaro-pulse-flash": ["720p", "1080p"] },
    })
    expect(h.reads).toBe(1)
  })

  it("leaves out a size whose step the admin switched off, as style-choice does", async () => {
    setPluginSupports({ castSwap: TAKES } as never)
    h.preciseUpscale = { "480p": "720p", "720p": "1080p", "1080p": "off", flash: { "480p": "720p", "720p": "off" } }
    const here = await resolveVideoRemakeSizes()
    expect(here).toMatchObject({ kind: "delivered", resolutions: { "nodaro-prism": ["720p", "1080p"], "nodaro-prism-flash": ["720p"] } })
  })

  it("is the engine's own sizes where the engine does not deliver resolutions, reading no settings", async () => {
    setPluginSupports({ castSwap: { ...TAKES, deliveredResolution: false } } as never)
    expect(await resolveVideoRemakeSizes()).toEqual({ kind: "engine" })
    _resetPluginSupportsForTests()
    expect(await resolveVideoRemakeSizes()).toEqual({ kind: "engine" })
    expect(h.reads).toBe(0)
  })

  it("is unread where the settings cannot be read, and never throws", async () => {
    setPluginSupports({ castSwap: TAKES } as never)
    h.failed = true
    expect(await resolveVideoRemakeSizes()).toEqual({ kind: "unread" })
    h.failed = false
    h.throws = true
    expect(await resolveVideoRemakeSizes()).toEqual({ kind: "unread" })
  })

  it("reads no settings where no Prism-family step is declared", async () => {
    setPluginSupports({ castSwap: { deliveredResolution: true, deliveredResolutions: { "nodaro-pulse": DELIVERED["nodaro-pulse"] } } } as never)
    const here = await resolveVideoRemakeSizes()
    expect(here).toMatchObject({ kind: "delivered", resolutions: { "nodaro-pulse": ["720p", "1080p", "4k"], "nodaro-prism": ["480p", "720p", "1080p"] } })
    expect(h.reads).toBe(0)
  })

  it("is undefined off Nodaro Cloud (the tool is not registered there)", async () => {
    h.cloud = false
    setPluginSupports({ castSwap: TAKES } as never)
    expect(await resolveVideoRemakeSizes()).toBeUndefined()
  })
})

describe("the words", () => {
  const all = { kind: "delivered" as const, resolutions: { "nodaro-prism": ["720p", "1080p", "4k"], "nodaro-pulse": ["720p", "1080p", "4k"], "nodaro-prism-flash": ["720p", "1080p"], "nodaro-pulse-flash": ["720p", "1080p"] } } as Parameters<typeof videoRemakeResolutionArg>[0]
  const noFourK = { kind: "delivered" as const, resolutions: { "nodaro-prism": ["720p", "1080p"], "nodaro-pulse": ["720p", "1080p"], "nodaro-prism-flash": ["720p"], "nodaro-pulse-flash": ["720p"] } } as Parameters<typeof videoRemakeResolutionArg>[0]

  it("name each engine choice's sizes, the first the default, and how a size not offered is refused", () => {
    expect(videoRemakeResolutionArg(all)).toBe(
      'The size delivered: nodaro-prism and nodaro-pulse: "720p" (default), "1080p" or "4k"; nodaro-prism-flash and nodaro-pulse-flash: "720p" (default) or "1080p". A size not offered is refused (resolution_not_offered, its offered naming the sizes offered).',
    )
    expect(videoRemakeResolutionSentence(all)).toBe("resolution is the size delivered, 720p by default, up to 4k")
  })

  it("never name a size this deployment does not offer", () => {
    expect(videoRemakeResolutionArg(noFourK)).not.toMatch(/4k/i)
    expect(videoRemakeResolutionArg(noFourK)).toContain('nodaro-prism-flash and nodaro-pulse-flash: "720p" (default) only')
    expect(videoRemakeResolutionSentence(noFourK)).toBe("resolution is the size delivered, 720p by default, up to 1080p")
  })

  it("name the engine's own sizes where it does not deliver resolutions, as before, and no refusal it may not give", () => {
    expect(videoRemakeResolutionArg({ kind: "engine" })).toBe(
      'The size the engine makes: nodaro-prism: "480p" (default), "720p" or "1080p"; nodaro-pulse: "720p" (default) or "1080p"; nodaro-prism-flash: "480p" (default) or "720p"; nodaro-pulse-flash: "720p" (default) only; any other is refused.',
    )
    expect(videoRemakeResolutionSentence({ kind: "engine" })).not.toMatch(/4k|deliver/i)
  })

  it("name no size where the settings could not be read, or nothing is known", () => {
    for (const here of [{ kind: "unread" as const }, undefined]) {
      expect(videoRemakeResolutionArg(here)).not.toMatch(/\d+p|4k/i)
      expect(videoRemakeResolutionArg(here)).toMatch(/resolution_not_offered/)
      expect(videoRemakeResolutionSentence(here)).not.toMatch(/\d+p|4k/i)
    }
  })

  it("the shape tells every answer apart", () => {
    const shapes = [all, noFourK, { kind: "engine" as const }, { kind: "unread" as const }, undefined].map((here) => JSON.stringify(videoRemakeSizesShape(here)))
    expect(new Set(shapes).size).toBe(shapes.length)
  })
})
