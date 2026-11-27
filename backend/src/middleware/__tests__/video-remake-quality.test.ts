import Fastify from "fastify"
import { beforeEach, describe, expect, it } from "vitest"
import { registerVideoRemakeQualityHook } from "../video-remake-quality.js"
import { registerNodaroMotionEngineHook } from "../nodaro-motion-engine.js"
import { rewriteVideoRemakeUrl } from "../../lib/video-remake-paths.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../lib/private-plugins/supports-registry.js"

/**
 * `quality: "full" | "economy"` reaches the Cast Swap engine (the plugin's routes) only where the loaded engine
 * declares `castSwap.quality`: an engine from before the choice accepts `"draft"` alone and refuses any other value.
 */
const ROUTES = ["/v1/cast-swap", "/v1/cast-swap/estimate", "/v1/cast-swap/intent", "/v1/video-remake", "/v1/video-remake/estimate", "/v1/video-remake/intent"] as const

/** The body the engine's route received, and whether the hook handed it a different object than the parser made. */
async function seen(body: unknown, url: string = "/v1/cast-swap", opts: { oldPrefixOnly?: boolean } = {}) {
  let parsed: unknown
  let same = false
  // An engine from before the rename serves /v1/cast-swap alone: the new prefix is routed to it (app.ts).
  const app = opts.oldPrefixOnly ? Fastify({ rewriteUrl: (req: { url?: string }) => rewriteVideoRemakeUrl(req.url ?? "/", () => false) }) : Fastify()
  app.addHook("preValidation", async (req) => {
    parsed = req.body
  })
  registerNodaroMotionEngineHook(app)
  registerVideoRemakeQualityHook(app)
  // Registered as a private plugin's routes are: in an encapsulated child, after the hook.
  await app.register(async (child) => {
    const echo = async (req: { body: unknown }) => {
      same = req.body === parsed
      return req.body
    }
    child.post("/v1/cast-swap", echo)
    child.post("/v1/cast-swap/estimate", echo)
    child.post("/v1/cast-swap/intent", echo)
    child.post("/v1/cast-swap/plan-roles", echo)
    child.post("/v1/cast-swap/:jobId/full-quality", echo)
    if (!opts.oldPrefixOnly) {
      child.post("/v1/video-remake", echo)
      child.post("/v1/video-remake/estimate", echo)
      child.post("/v1/video-remake/intent", echo)
    }
    child.post("/v1/video-upscale", echo)
  })
  const res = await app.inject({ method: "POST", url, payload: body as Record<string, unknown> })
  await app.close()
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res.body, same }
}

const RUN = { videoUrl: "https://cdn.example/a.mp4", roles: [], postPrompt: "make it night", resolution: "1080p" }

beforeEach(() => _resetPluginSupportsForTests())

describe("registerVideoRemakeQualityHook", () => {
  describe("an engine that does not declare castSwap.quality", () => {
    it.each([undefined, {}, { quality: false }, { quality: "true" }, { deliveredResolution: true, qualityFull: { "nodaro-prism": ["720p"] } }])(
      "is never sent quality full or economy, on the run, the estimate and the intent check, under both prefixes (castSwap: %j)",
      async (castSwap) => {
        if (castSwap !== undefined) setPluginSupports({ castSwap } as never)
        for (const url of ROUTES) {
          for (const quality of ["full", "economy"]) {
            const got = await seen({ ...RUN, quality }, url)
            expect(got.status).toBe(200)
            expect(got.body).toEqual(RUN)
            expect("quality" in got.body).toBe(false)
          }
        }
      },
    )

    it("keeps every other key, in its order, and drops it where the new prefix is routed to an engine serving the old one alone", async () => {
      const got = await seen({ videoUrl: "v", quality: "full", engine: "nodaro-pulse", draft: false }, "/v1/video-remake/estimate", { oldPrefixOnly: true })
      expect(got.raw).toBe(JSON.stringify({ videoUrl: "v", engine: "kling-4", draft: false }))
    })

    it('never touches quality "draft", a value that is not the choice, or a body that names none: the very object that arrived', async () => {
      for (const url of ROUTES) {
        for (const body of [{ ...RUN, quality: "draft" }, { ...RUN, quality: "FULL" }, { ...RUN, quality: 1 }, { ...RUN, quality: null }, RUN, {}]) {
          const got = await seen(body, url)
          expect(got.raw).toBe(JSON.stringify(body))
          expect(got.same).toBe(true)
        }
      }
    })
  })

  describe("an engine that declares castSwap.quality", () => {
    beforeEach(() => setPluginSupports({ castSwap: { quality: true } } as never))

    it("is sent the body untouched: full, economy, draft or none", async () => {
      for (const url of ROUTES) {
        for (const body of [{ ...RUN, quality: "full" }, { ...RUN, quality: "economy" }, { ...RUN, quality: "draft" }, RUN]) {
          const got = await seen(body, url)
          expect(got.raw).toBe(JSON.stringify(body))
          expect(got.same).toBe(true)
        }
      }
    })
  })

  it("leaves every other route's quality alone, whatever the engine declares", async () => {
    for (const url of ["/v1/cast-swap/plan-roles", "/v1/cast-swap/j-1/full-quality", "/v1/video-upscale"]) {
      const got = await seen({ quality: "full" }, url)
      expect(got.body).toEqual({ quality: "full" })
      expect(got.same).toBe(true)
    }
  })

  it("leaves a body that is not an object alone", async () => {
    const app = Fastify()
    registerVideoRemakeQualityHook(app)
    app.post("/v1/cast-swap", async (req) => ({ got: req.body ?? null }))
    const res = await app.inject({ method: "POST", url: "/v1/cast-swap", payload: ["full"] as never })
    expect(res.json()).toEqual({ got: ["full"] })
    const none = await app.inject({ method: "POST", url: "/v1/cast-swap" })
    expect(none.json()).toEqual({ got: null })
    await app.close()
  })
})
