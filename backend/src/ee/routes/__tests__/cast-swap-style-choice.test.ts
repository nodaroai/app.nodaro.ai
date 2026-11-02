import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/cast-swap/style-choice` — what clients read to hide their Style
 * control: every engine's choice ("user" where nothing is forced), from the
 * settings cache, cacheable briefly.
 *
 * What must hold:
 *  - nothing saved (or nothing forced) answers every engine "user": the
 *    answer clients had before the setting, so nothing changes;
 *  - a forced engine is answered with its choice only while THIS
 *    environment's engine enforces it (`castSwap.styleChoice`); an engine
 *    from before it answers "user" everywhere (it takes the request's style);
 *  - a settings read that failed answers "user" everywhere, uncached.
 */
const h = vi.hoisted(() => ({ style: null as unknown, failed: false, throws: false, reads: 0 }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/app-settings.js")>()),
  getAppSettings: async () => {
    h.reads++
    if (h.throws) throw new Error("boom")
    return { nodaro_motion_style: h.style }
  },
  settingsReadFailed: () => h.failed,
}))

const { castSwapStyleChoiceRoutes, STYLE_CHOICE_MAX_AGE_SECONDS } = await import("../cast-swap-style-choice.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const URL = "/v1/cast-swap/style-choice"
const USER = { engines: { "motion-prism": "user", "motion-pulse": "user" } }

let app: FastifyInstance

beforeEach(async () => {
  h.style = null
  h.failed = false
  h.throws = false
  h.reads = 0
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: { ...CS, styleChoice: true } })
  app = Fastify({ logger: false })
  await app.register(castSwapStyleChoiceRoutes)
  await app.ready()
})

describe("GET /v1/cast-swap/style-choice", () => {
  it("answers every engine 'user' when nothing is saved or forced, cacheable briefly", async () => {
    for (const style of [null, {}]) {
      h.style = style
      const res = await app.inject({ method: "GET", url: URL })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(USER)
      expect(res.headers["cache-control"]).toBe(`public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    }
    expect(STYLE_CHOICE_MAX_AGE_SECONDS).toBeLessThanOrEqual(60)
  })

  it("answers each forced engine's choice, the other 'user'", async () => {
    h.style = { "motion-pulse": "flex" }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "motion-prism": "user", "motion-pulse": "flex" } })
    h.style = { "motion-prism": "precise", "motion-pulse": "flex" }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "motion-prism": "precise", "motion-pulse": "flex" } })
  })

  it("answers 'user' everywhere while this environment's engine does not enforce it, without reading the settings", async () => {
    h.style = { "motion-prism": "flex" }
    for (const castSwap of [CS, { ...CS, styleChoice: false }]) {
      setPluginSupports({ castSwap })
      expect((await app.inject({ method: "GET", url: URL })).json(), JSON.stringify(castSwap)).toEqual(USER)
    }
    _resetPluginSupportsForTests()
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual(USER)
    expect(h.reads).toBe(0)
  })

  it("answers 'user' everywhere, uncached, when the settings could not be read", async () => {
    h.style = { "motion-prism": "flex" }
    h.failed = true
    let res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(USER)
    expect(res.headers["cache-control"]).toBe("no-store")
    h.failed = false
    h.throws = true
    res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(USER)
    expect(res.headers["cache-control"]).toBe("no-store")
  })
})

describe("with nothing set, every Nodaro Motion request is as before", () => {
  it("the host leaves a direct run's and a quote's body (its style included) to the engine exactly as sent", async () => {
    const seen: unknown[] = []
    const engine = Fastify({ logger: false })
    await engine.register(castSwapStyleChoiceRoutes)
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) engine.post(url, async (req) => (seen.push(req.body), { ok: true }))
    await engine.ready()
    const bodies = [
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x" },
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x", style: "motion", engine: "motion-pulse" },
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x", style: "precise" },
    ]
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) {
      for (const body of bodies) expect((await engine.inject({ method: "POST", url, payload: body })).statusCode).toBe(200)
    }
    expect(seen).toEqual([...bodies, ...bodies])
    expect(h.reads).toBe(0)
  })
})

