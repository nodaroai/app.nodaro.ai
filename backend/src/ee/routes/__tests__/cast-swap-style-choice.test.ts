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
 *  - a settings read that failed answers "user" everywhere, uncached;
 *  - every answer (those three included) says, per engine, whether this
 *    environment's engine takes a style-only run (`styleOnly`: Prism only
 *    while it declares `castSwap.styleOnly`; Pulse never, as it takes no art
 *    style). It follows the engine alone, never the settings read.
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
const NO_STYLE_ONLY = { "motion-prism": false, "motion-pulse": false }
const USER = { engines: { "motion-prism": "user", "motion-pulse": "user" }, styleOnly: NO_STYLE_ONLY }

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
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY })
    h.style = { "motion-prism": "precise", "motion-pulse": "flex" }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "motion-prism": "precise", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY })
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

describe("styleOnly: which engines take a style-only run", () => {
  const STYLE_ONLY = { "motion-prism": true, "motion-pulse": false }

  it("answers Prism true and Pulse false while the engine declares castSwap.styleOnly, in a fresh object", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, styleOnly: true } })
    h.style = { "motion-pulse": "flex" }
    const first = (await app.inject({ method: "GET", url: URL })).json()
    expect(first).toEqual({ engines: { "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: STYLE_ONLY })
    first.styleOnly["motion-pulse"] = true
    expect((await app.inject({ method: "GET", url: URL })).json().styleOnly).toEqual(STYLE_ONLY)
  })

  it("answers every engine false when the engine does not declare it, or declares it false", async () => {
    for (const castSwap of [{ ...CS, styleChoice: true }, { ...CS, styleChoice: true, styleOnly: false }]) {
      setPluginSupports({ castSwap })
      expect((await app.inject({ method: "GET", url: URL })).json().styleOnly, JSON.stringify(castSwap)).toEqual(NO_STYLE_ONLY)
    }
    _resetPluginSupportsForTests()
    expect((await app.inject({ method: "GET", url: URL })).json().styleOnly).toEqual(NO_STYLE_ONLY)
  })

  it("answers it on an engine that takes no style choice, still without reading the settings", async () => {
    setPluginSupports({ castSwap: { ...CS, styleOnly: true } })
    h.style = { "motion-prism": "flex" }
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ ...USER, styleOnly: STYLE_ONLY })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    expect(h.reads).toBe(0)
  })

  it("keeps it in the uncached answer to a settings read that failed or threw", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, styleOnly: true } })
    h.style = { "motion-prism": "flex" }
    for (const fail of [{ failed: true, throws: false }, { failed: false, throws: true }]) {
      Object.assign(h, fail)
      const res = await app.inject({ method: "GET", url: URL })
      expect(res.statusCode).toBe(200)
      expect(res.json(), JSON.stringify(fail)).toEqual({ ...USER, styleOnly: STYLE_ONLY })
      expect(res.headers["cache-control"]).toBe("no-store")
    }
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

