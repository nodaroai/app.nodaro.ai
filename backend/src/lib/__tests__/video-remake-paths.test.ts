import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import {
  castSwapSpelling,
  rewriteVideoRemakeUrl,
  videoRemakeRewriteUrl,
  videoRemakeRoutes,
  videoRemakeSpelling,
} from "../video-remake-paths.js"

/**
 * Video Remake's routes are `/v1/video-remake/*`, with `/v1/cast-swap/*` as
 * their silent alias, and its admin routes `/v1/admin/video-remake/*`, with
 * `/v1/admin/nodaro-motion/*` as theirs (lib/video-remake-paths.ts).
 */
describe("the two spellings of a Video Remake route", () => {
  it("reads a route under /v1/video-remake in its /v1/cast-swap spelling, and back", () => {
    expect(castSwapSpelling("/v1/video-remake")).toBe("/v1/cast-swap")
    expect(castSwapSpelling("/v1/video-remake/estimate")).toBe("/v1/cast-swap/estimate")
    expect(castSwapSpelling("/v1/video-remake/:jobId/full-quality")).toBe("/v1/cast-swap/:jobId/full-quality")
    expect(castSwapSpelling("/v1/video-remake?x=1")).toBe("/v1/cast-swap?x=1")
    expect(videoRemakeSpelling("/v1/cast-swap/face-mask")).toBe("/v1/video-remake/face-mask")
    expect(videoRemakeRoutes("/style-choice")).toEqual(["/v1/video-remake/style-choice", "/v1/cast-swap/style-choice"])
  })

  it("leaves any other route as it is, a longer name included", () => {
    for (const route of ["/v1/cast-swap", "/v1/video-remakees", "/v1/video-remake-x", "/v1/generate-video", "/v1/admin/video-remake/masking", ""]) {
      expect(castSwapSpelling(route), route).toBe(route)
    }
    expect(videoRemakeSpelling("/v1/cast-swapped")).toBe("/v1/cast-swapped")
  })
})

describe("rewriteVideoRemakeUrl", () => {
  const serves = () => true
  const servesNot = () => false

  it("routes the admin settings' former prefix to the current one, query kept", () => {
    expect(rewriteVideoRemakeUrl("/v1/admin/nodaro-motion/masking", serves)).toBe("/v1/admin/video-remake/masking")
    expect(rewriteVideoRemakeUrl("/v1/admin/nodaro-motion/steps/defaults?engine=nodaro-prism", servesNot)).toBe(
      "/v1/admin/video-remake/steps/defaults?engine=nodaro-prism",
    )
    expect(rewriteVideoRemakeUrl("/v1/admin/nodaro-motionx", serves)).toBe("/v1/admin/nodaro-motionx")
  })

  it("sends /v1/video-remake to /v1/cast-swap only while the loaded engine serves the old prefix alone", () => {
    expect(rewriteVideoRemakeUrl("/v1/video-remake/estimate", servesNot)).toBe("/v1/cast-swap/estimate")
    expect(rewriteVideoRemakeUrl("/v1/video-remake/j1/full-quality", servesNot)).toBe("/v1/cast-swap/j1/full-quality")
    expect(rewriteVideoRemakeUrl("/v1/video-remake/estimate", serves)).toBe("/v1/video-remake/estimate")
    expect(rewriteVideoRemakeUrl("/v1/cast-swap", servesNot)).toBe("/v1/cast-swap")
    expect(rewriteVideoRemakeUrl("/v1/generate-video", servesNot)).toBe("/v1/generate-video")
  })
})

describe("videoRemakeRewriteUrl, as the app installs it", () => {
  async function appWith(engineRoutes: readonly string[]) {
    const app = Fastify({ logger: false, rewriteUrl: videoRemakeRewriteUrl })
    for (const prefix of engineRoutes) {
      app.post(prefix, async (req) => ({ route: req.routeOptions.url }))
      app.post(`${prefix}/estimate`, async (req) => ({ route: req.routeOptions.url }))
    }
    app.get("/v1/admin/video-remake/masking", async (req) => ({ route: req.routeOptions.url }))
    await app.ready()
    return app
  }

  it("answers the admin routes at their former address", async () => {
    const app = await appWith(["/v1/cast-swap"])
    const res = await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/masking" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ route: "/v1/admin/video-remake/masking" })
  })

  it("answers /v1/video-remake through an engine that registers only /v1/cast-swap", async () => {
    const app = await appWith(["/v1/cast-swap"])
    expect((await app.inject({ method: "POST", url: "/v1/video-remake/estimate", payload: {} })).json()).toEqual({ route: "/v1/cast-swap/estimate" })
    expect((await app.inject({ method: "POST", url: "/v1/cast-swap", payload: {} })).json()).toEqual({ route: "/v1/cast-swap" })
  })

  it("leaves both prefixes to an engine that registers both", async () => {
    const app = await appWith(["/v1/video-remake", "/v1/cast-swap"])
    expect((await app.inject({ method: "POST", url: "/v1/video-remake/estimate", payload: {} })).json()).toEqual({ route: "/v1/video-remake/estimate" })
    expect((await app.inject({ method: "POST", url: "/v1/cast-swap/estimate", payload: {} })).json()).toEqual({ route: "/v1/cast-swap/estimate" })
  })

  it("answers 404 for /v1/video-remake where no engine is loaded", async () => {
    const app = await appWith([])
    expect((await app.inject({ method: "POST", url: "/v1/video-remake", payload: {} })).statusCode).toBe(404)
  })
})
