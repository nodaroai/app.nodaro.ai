import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { registerNodaroMotionEngineHook } from "../nodaro-motion-engine.js"

/**
 * A REST / SDK / CLI Nodaro Motion run or quote naming its engine by any id
 * reaches the Cast Swap engine (the plugin's route) as the internal id, which
 * every engine version takes — a plugin up to 0.397.0 refuses the current
 * public ids.
 */
async function seen(body: unknown, url = "/v1/cast-swap") {
  const app = Fastify()
  registerNodaroMotionEngineHook(app)
  // Registered as a private plugin's routes are: in an encapsulated child, after the hook.
  await app.register(async (child) => {
    child.post("/v1/cast-swap", async (req) => req.body)
    child.post("/v1/cast-swap/estimate", async (req) => req.body)
    child.post("/v1/cast-swap/:jobId/full-quality", async (req) => req.body)
    child.post("/v1/generate-video", async (req) => req.body)
  })
  const res = await app.inject({ method: "POST", url, payload: body as Record<string, unknown> })
  await app.close()
  return res.json() as Record<string, unknown>
}

describe("registerNodaroMotionEngineHook", () => {
  it.each([
    ["motion-prism", "seedance-2-5"],
    ["motion-pulse", "kling-4"],
    ["motion-pro", "seedance-2-5"],
    ["motion-lite", "kling-4"],
    ["seedance-2-5", "seedance-2-5"],
    ["kling-4", "kling-4"],
  ])("a run or quote naming %s reaches the engine as %s", async (named, internal) => {
    for (const url of ["/v1/cast-swap", "/v1/cast-swap/estimate"]) {
      expect(await seen({ videoUrl: "https://cdn.example/a.mp4", engine: named }, url)).toEqual({
        videoUrl: "https://cdn.example/a.mp4",
        engine: internal,
      })
    }
  })

  it("leaves an unknown engine, a body without one, and other routes as sent", async () => {
    expect(await seen({ engine: "motion-max" })).toEqual({ engine: "motion-max" })
    expect(await seen({ videoUrl: "x" })).toEqual({ videoUrl: "x" })
    expect(await seen({ engine: "motion-prism" }, "/v1/cast-swap/j-1/full-quality")).toEqual({ engine: "motion-prism" })
    expect(await seen({ engine: "motion-prism" }, "/v1/generate-video")).toEqual({ engine: "motion-prism" })
  })
})
