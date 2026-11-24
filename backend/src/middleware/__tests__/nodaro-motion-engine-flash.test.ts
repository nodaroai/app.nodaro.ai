import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A Video Remake run or quote naming a FLASH CHOICE ("nodaro-prism-flash",
 * "nodaro-pulse-flash") reaches the engine as it is only while the deployment
 * offers it — the engine declares `castSwap.flashChoices` (the id among its
 * `engines`) AND the admin's Offer Flash is on for its engine. Anywhere else it
 * is refused here, 409 `flash_not_offered`, before the route: never rewritten to
 * the engine's own id (which would run it on the engine's own model at another
 * price). The retired admin-only test's row offers nothing.
 */
const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, failed: false, throws: false }))
vi.mock("../../lib/app-settings.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getAppSettings: async () => {
    if (h.throws) throw new Error("db down")
    return h.settings
  },
  settingsReadFailed: () => h.failed,
}))

const { registerNodaroMotionEngineHook } = await import("../nodaro-motion-engine.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const FLASH_ENGINE = { ...CS, flashChoices: true, engines: ["nodaro-prism", "nodaro-pulse", "nodaro-prism-flash", "nodaro-pulse-flash", "seedance-2-5", "kling-4"] }
const URLS = ["/v1/video-remake", "/v1/video-remake/estimate", "/v1/cast-swap", "/v1/cast-swap/estimate"]

async function post(body: Record<string, unknown>, url: string) {
  const app = Fastify()
  registerNodaroMotionEngineHook(app)
  await app.register(async (child) => {
    for (const u of URLS) child.post(u, async (req) => req.body)
  })
  const res = await app.inject({ method: "POST", url, payload: body })
  await app.close()
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

beforeEach(() => {
  h.settings = {}
  h.failed = false
  h.throws = false
  _resetPluginSupportsForTests()
})

describe("registerNodaroMotionEngineHook: the Flash choices", () => {
  it.each(["nodaro-prism-flash", "nodaro-pulse-flash"] as const)("%s offered: reaches the engine as it is, on every route", async (choice) => {
    setPluginSupports({ castSwap: FLASH_ENGINE } as never)
    h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "on", "nodaro-pulse": "on" } }
    for (const url of URLS) expect(await post({ videoUrl: "https://cdn.example/a.mp4", engine: choice }, url)).toEqual({ status: 200, body: { videoUrl: "https://cdn.example/a.mp4", engine: choice } })
  })

  it("not offered: 409 flash_not_offered on every route — never saved, off, the other engine's, an engine without Flash, a failed read, the retired test's row", async () => {
    const cases: Array<[string, () => void]> = [
      ["never saved", () => setPluginSupports({ castSwap: FLASH_ENGINE } as never)],
      ["off", () => (setPluginSupports({ castSwap: FLASH_ENGINE } as never), (h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "off" } }))],
      ["the other engine's", () => (setPluginSupports({ castSwap: FLASH_ENGINE } as never), (h.settings = { nodaro_motion_flash_offer: { "nodaro-pulse": "on" } }))],
      ["an engine from before Flash", () => (setPluginSupports({ castSwap: { ...CS, flashModel: true } } as never), (h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "on" } }))],
      ["an engine that declares the flag but not the id", () => (setPluginSupports({ castSwap: { ...CS, flashChoices: true, engines: ["nodaro-prism"] } } as never), (h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "on" } }))],
      ["a failed read", () => (setPluginSupports({ castSwap: FLASH_ENGINE } as never), (h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "on" } }), (h.failed = true))],
      ["a throwing read", () => (setPluginSupports({ castSwap: FLASH_ENGINE } as never), (h.throws = true))],
      ["the retired admin-only test's row on", () => (setPluginSupports({ castSwap: FLASH_ENGINE } as never), (h.settings = { nodaro_motion_flash_model: { "nodaro-prism": "on", "nodaro-pulse": "on" } }))],
    ]
    for (const [what, arrange] of cases) {
      h.settings = {}
      h.failed = false
      h.throws = false
      _resetPluginSupportsForTests()
      arrange()
      for (const url of URLS) {
        const res = await post({ engine: "nodaro-prism-flash" }, url)
        expect(res, `${what} ${url}`).toEqual({
          status: 409,
          body: { error: { code: "flash_not_offered", message: "Nodaro Prism Flash isn't available right now. Choose Nodaro Prism." } },
        })
      }
    }
  })

  it("the engines themselves are rewritten as before, with Flash offered or not", async () => {
    setPluginSupports({ castSwap: FLASH_ENGINE } as never)
    h.settings = { nodaro_motion_flash_offer: { "nodaro-prism": "on", "nodaro-pulse": "on" } }
    expect((await post({ engine: "nodaro-pulse" }, "/v1/video-remake")).body).toEqual({ engine: "kling-4" })
    h.settings = {}
    expect((await post({ engine: "nodaro-prism" }, "/v1/video-remake")).body).toEqual({ engine: "seedance-2-5" })
  })
})
