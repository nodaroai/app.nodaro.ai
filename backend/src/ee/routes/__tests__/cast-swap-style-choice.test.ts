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
 *    style). It follows the engine alone, never the settings read;
 *  - and likewise whether it takes an art style on a Precise run
 *    (`preciseArtStyle`: Prism only while it declares
 *    `castSwap.preciseArtStyle`; Pulse never);
 *  - and whether an art style alone is a Precise run's change there
 *    (`preciseArtStyleAlone`: Prism only while it declares
 *    `castSwap.preciseArtStyleAlone`; Pulse never);
 *  - and whether a run takes the style in the person's own words there
 *    (`customStyle`: Prism only while the engine declares
 *    `castSwap.customStyle` AND the deployment offers it — the admin's saved
 *    choice, else the deployment's default; Pulse never). It reads the
 *    settings, so a failed read answers false, and an engine without the flag
 *    answers false whatever is saved.
 */
const h = vi.hoisted(() => ({ style: null as unknown, customStyle: null as unknown, offeredByDefault: true, failed: false, throws: false, reads: 0 }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/app-settings.js")>()),
  getAppSettings: async () => {
    h.reads++
    if (h.throws) throw new Error("boom")
    return { nodaro_motion_style: h.style, nodaro_motion_custom_style: h.customStyle }
  },
  settingsReadFailed: () => h.failed,
}))

vi.mock("../../../lib/nodaro-motion-custom-style-default.js", () => ({ customStyleOfferedByDefault: () => h.offeredByDefault }))

const { castSwapStyleChoiceRoutes, STYLE_CHOICE_MAX_AGE_SECONDS } = await import("../cast-swap-style-choice.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const], trendRun: true }
const URL = "/v1/cast-swap/style-choice"
const NO_STYLE_ONLY = { "nodaro-prism": false, "nodaro-pulse": false, "motion-prism": false, "motion-pulse": false }
const NO_PRECISE_ART_STYLE = { "nodaro-prism": false, "nodaro-pulse": false, "motion-prism": false, "motion-pulse": false }
const NO_PRECISE_ART_STYLE_ALONE = { "nodaro-prism": false, "nodaro-pulse": false, "motion-prism": false, "motion-pulse": false }
const NO_CUSTOM_STYLE = { "nodaro-prism": false, "nodaro-pulse": false, "motion-prism": false, "motion-pulse": false }
const USER = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user", "motion-prism": "user", "motion-pulse": "user" }, styleOnly: NO_STYLE_ONLY, preciseArtStyle: NO_PRECISE_ART_STYLE, preciseArtStyleAlone: NO_PRECISE_ART_STYLE_ALONE, customStyle: NO_CUSTOM_STYLE }

let app: FastifyInstance

beforeEach(async () => {
  h.style = null
  h.customStyle = null
  h.offeredByDefault = true
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
    h.style = { "nodaro-pulse": "flex" }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "nodaro-prism": "user", "nodaro-pulse": "flex", "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY, preciseArtStyle: NO_PRECISE_ART_STYLE, preciseArtStyleAlone: NO_PRECISE_ART_STYLE_ALONE, customStyle: NO_CUSTOM_STYLE })
    h.style = { "nodaro-prism": "precise", "nodaro-pulse": "flex", "motion-prism": "precise", "motion-pulse": "flex" }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ engines: { "nodaro-prism": "precise", "nodaro-pulse": "flex", "motion-prism": "precise", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY, preciseArtStyle: NO_PRECISE_ART_STYLE, preciseArtStyleAlone: NO_PRECISE_ART_STYLE_ALONE, customStyle: NO_CUSTOM_STYLE })
  })

  it("answers 'user' everywhere while this environment's engine does not enforce it, without reading the settings", async () => {
    h.style = { "nodaro-prism": "flex" }
    for (const castSwap of [CS, { ...CS, styleChoice: false }]) {
      setPluginSupports({ castSwap })
      expect((await app.inject({ method: "GET", url: URL })).json(), JSON.stringify(castSwap)).toEqual(USER)
    }
    _resetPluginSupportsForTests()
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual(USER)
    expect(h.reads).toBe(0)
  })

  it("answers 'user' everywhere, uncached, when the settings could not be read", async () => {
    h.style = { "nodaro-prism": "flex" }
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
  const STYLE_ONLY = { "nodaro-prism": true, "nodaro-pulse": false, "motion-prism": true, "motion-pulse": false }

  it("answers Prism true and Pulse false while the engine declares castSwap.styleOnly, in a fresh object", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, styleOnly: true } })
    h.style = { "nodaro-pulse": "flex" }
    const first = (await app.inject({ method: "GET", url: URL })).json()
    expect(first).toEqual({ engines: { "nodaro-prism": "user", "nodaro-pulse": "flex", "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: STYLE_ONLY, preciseArtStyle: NO_PRECISE_ART_STYLE, preciseArtStyleAlone: NO_PRECISE_ART_STYLE_ALONE, customStyle: NO_CUSTOM_STYLE })
    first.styleOnly["nodaro-pulse"] = true
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
    h.style = { "nodaro-prism": "flex" }
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ ...USER, styleOnly: STYLE_ONLY })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    expect(h.reads).toBe(0)
  })

  it("keeps it in the uncached answer to a settings read that failed or threw", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, styleOnly: true } })
    h.style = { "nodaro-prism": "flex" }
    for (const fail of [{ failed: true, throws: false }, { failed: false, throws: true }]) {
      Object.assign(h, fail)
      const res = await app.inject({ method: "GET", url: URL })
      expect(res.statusCode).toBe(200)
      expect(res.json(), JSON.stringify(fail)).toEqual({ ...USER, styleOnly: STYLE_ONLY })
      expect(res.headers["cache-control"]).toBe("no-store")
    }
  })
})

describe("preciseArtStyle: which engines take an art style on a Precise run", () => {
  const PRECISE_ART_STYLE = { "nodaro-prism": true, "nodaro-pulse": false, "motion-prism": true, "motion-pulse": false }

  it("answers Prism true and Pulse false while the engine declares castSwap.preciseArtStyle, in a fresh object", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, preciseArtStyle: true } })
    h.style = { "nodaro-pulse": "flex" }
    const first = (await app.inject({ method: "GET", url: URL })).json()
    expect(first).toEqual({ engines: { "nodaro-prism": "user", "nodaro-pulse": "flex", "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY, preciseArtStyle: PRECISE_ART_STYLE, preciseArtStyleAlone: NO_PRECISE_ART_STYLE_ALONE, customStyle: NO_CUSTOM_STYLE })
    first.preciseArtStyle["nodaro-pulse"] = true
    expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyle).toEqual(PRECISE_ART_STYLE)
  })

  it("answers every engine false when the engine does not declare it, or declares it false", async () => {
    for (const castSwap of [{ ...CS, styleChoice: true }, { ...CS, styleChoice: true, preciseArtStyle: false }]) {
      setPluginSupports({ castSwap })
      expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyle, JSON.stringify(castSwap)).toEqual(NO_PRECISE_ART_STYLE)
    }
    _resetPluginSupportsForTests()
    expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyle).toEqual(NO_PRECISE_ART_STYLE)
  })

  it("keeps it in the answer of an engine that takes no style choice, and in the uncached one of a failed read", async () => {
    setPluginSupports({ castSwap: { ...CS, preciseArtStyle: true } })
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ ...USER, preciseArtStyle: PRECISE_ART_STYLE })
    expect(h.reads).toBe(0)
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, preciseArtStyle: true } })
    h.failed = true
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ ...USER, preciseArtStyle: PRECISE_ART_STYLE })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
})

describe("preciseArtStyleAlone: where an art style alone is a Precise run's change", () => {
  const ALONE = { "nodaro-prism": true, "nodaro-pulse": false, "motion-prism": true, "motion-pulse": false }

  it("answers Prism true and Pulse false while the engine declares castSwap.preciseArtStyleAlone, in a fresh object", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, preciseArtStyleAlone: true } })
    h.style = { "nodaro-pulse": "flex" }
    const first = (await app.inject({ method: "GET", url: URL })).json()
    expect(first).toEqual({ engines: { "nodaro-prism": "user", "nodaro-pulse": "flex", "motion-prism": "user", "motion-pulse": "flex" }, styleOnly: NO_STYLE_ONLY, preciseArtStyle: NO_PRECISE_ART_STYLE, preciseArtStyleAlone: ALONE, customStyle: NO_CUSTOM_STYLE })
    first.preciseArtStyleAlone["nodaro-pulse"] = true
    expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyleAlone).toEqual(ALONE)
  })

  it("answers every engine false when the engine does not declare it or declares it false, whatever its other flags say", async () => {
    for (const castSwap of [
      { ...CS, styleChoice: true },
      { ...CS, styleChoice: true, preciseArtStyleAlone: false },
      { ...CS, styleChoice: true, preciseArtStyle: true, styleOnly: true },
    ]) {
      setPluginSupports({ castSwap })
      expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyleAlone, JSON.stringify(castSwap)).toEqual(NO_PRECISE_ART_STYLE_ALONE)
    }
    _resetPluginSupportsForTests()
    expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyleAlone).toEqual(NO_PRECISE_ART_STYLE_ALONE)
  })

  it("is in the answer of an engine that takes no style choice, without reading the settings", async () => {
    setPluginSupports({ castSwap: { ...CS, preciseArtStyleAlone: true } })
    h.style = { "nodaro-prism": "flex" }
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ ...USER, preciseArtStyleAlone: ALONE })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    expect(h.reads).toBe(0)
  })

  it("is in the uncached answer to a settings read that failed or threw", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, preciseArtStyleAlone: true } })
    h.style = { "nodaro-prism": "flex" }
    for (const fail of [{ failed: true, throws: false }, { failed: false, throws: true }]) {
      Object.assign(h, fail)
      const res = await app.inject({ method: "GET", url: URL })
      expect(res.statusCode).toBe(200)
      expect(res.json(), JSON.stringify(fail)).toEqual({ ...USER, preciseArtStyleAlone: ALONE })
      expect(res.headers["cache-control"]).toBe("no-store")
    }
  })

  it("follows the engine alone: no saved choice changes it", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, preciseArtStyleAlone: true } })
    for (const style of [{ "nodaro-prism": "precise" }, { "nodaro-prism": "flex", "nodaro-pulse": "flex", "motion-prism": "flex", "motion-pulse": "flex" }, null]) {
      h.style = style
      expect((await app.inject({ method: "GET", url: URL })).json().preciseArtStyleAlone, JSON.stringify(style)).toEqual(ALONE)
    }
  })
})

describe("with nothing set, every Video Remake request is as before", () => {
  it("the host leaves a direct run's and a quote's body (its style included) to the engine exactly as sent", async () => {
    const seen: unknown[] = []
    const engine = Fastify({ logger: false })
    await engine.register(castSwapStyleChoiceRoutes)
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) engine.post(url, async (req) => (seen.push(req.body), { ok: true }))
    await engine.ready()
    const bodies = [
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x" },
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x", style: "motion", engine: "nodaro-pulse" },
      { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], postPrompt: "x", style: "precise" },
    ]
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) {
      for (const body of bodies) expect((await engine.inject({ method: "POST", url, payload: body })).statusCode).toBe(200)
    }
    expect(seen).toEqual([...bodies, ...bodies])
    expect(h.reads).toBe(0)
  })
})


describe("the Video Remake route and its alias", () => {
  it("answers the same at /v1/video-remake/style-choice and at its /v1/cast-swap alias", async () => {
    h.style = { "nodaro-prism": "flex" }
    const canonical = await app.inject({ method: "GET", url: "/v1/video-remake/style-choice" })
    const alias = await app.inject({ method: "GET", url: URL })
    expect(canonical.statusCode).toBe(200)
    expect(canonical.json()).toEqual(alias.json())
    expect(canonical.json().engines["nodaro-prism"]).toBe("flex")
  })
})

describe("customStyle: which engines take the style in the person's own words", () => {
  const CUSTOM_STYLE = { "nodaro-prism": true, "nodaro-pulse": false, "motion-prism": true, "motion-pulse": false }
  const get = async () => (await app.inject({ method: "GET", url: URL })).json().customStyle

  it("answers Prism by the deployment's default while nothing is saved: on for Nodaro's own, off under a white-label profile", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, customStyle: true } })
    for (const saved of [null, {}, { medium: { model: "some-model" } }]) {
      h.customStyle = saved
      h.offeredByDefault = true
      expect(await get(), JSON.stringify(saved)).toEqual(CUSTOM_STYLE)
      h.offeredByDefault = false
      expect(await get(), JSON.stringify(saved)).toEqual(NO_CUSTOM_STYLE)
    }
  })

  it("answers the admin's saved choice over the deployment's default, either way", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, customStyle: true } })
    h.customStyle = { enabled: false }
    h.offeredByDefault = true
    expect(await get()).toEqual(NO_CUSTOM_STYLE)
    h.customStyle = { enabled: true }
    h.offeredByDefault = false
    expect(await get()).toEqual(CUSTOM_STYLE)
  })

  it("answers every engine false when the engine does not declare it, whatever is saved (an engine from before it)", async () => {
    h.customStyle = { enabled: true }
    for (const castSwap of [{ ...CS, styleChoice: true }, { ...CS, styleChoice: true, customStyle: false }, CS]) {
      setPluginSupports({ castSwap })
      expect(await get(), JSON.stringify(castSwap)).toEqual(NO_CUSTOM_STYLE)
    }
    _resetPluginSupportsForTests()
    expect(await get()).toEqual(NO_CUSTOM_STYLE)
  })

  it("reads the settings for an engine that takes a custom style and enforces no style choice, and still answers every engine 'user'", async () => {
    setPluginSupports({ castSwap: { ...CS, customStyle: true } })
    h.style = { "nodaro-prism": "flex" }
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ ...USER, customStyle: CUSTOM_STYLE })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${STYLE_CHOICE_MAX_AGE_SECONDS}`)
    expect(h.reads).toBe(1)
  })

  it("answers false, uncached, when the settings could not be read or the read threw", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, customStyle: true } })
    h.customStyle = { enabled: true }
    h.failed = true
    let res = await app.inject({ method: "GET", url: URL })
    expect(res.json().customStyle).toEqual(NO_CUSTOM_STYLE)
    expect(res.headers["cache-control"]).toBe("no-store")
    h.failed = false
    h.throws = true
    res = await app.inject({ method: "GET", url: URL })
    expect(res.json().customStyle).toEqual(NO_CUSTOM_STYLE)
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("answers it in a fresh object, under the video-remake prefix too", async () => {
    setPluginSupports({ castSwap: { ...CS, styleChoice: true, customStyle: true } })
    const first = (await app.inject({ method: "GET", url: "/v1/video-remake/style-choice" })).json()
    expect(first.customStyle).toEqual(CUSTOM_STYLE)
    first.customStyle["nodaro-pulse"] = true
    expect(await get()).toEqual(CUSTOM_STYLE)
  })
})
