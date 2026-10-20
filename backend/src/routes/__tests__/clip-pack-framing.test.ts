/**
 * POST /v1/clip-pack with a framing source (decided 2026-10-17/20): the body
 * takes `framingSource` (auto, static or tracking) and hands it to the run's
 * settings; a framed pack that follows faces adds ONE Speaker Frames run, so a
 * caller Speaker Frames is withheld from is refused up front, 403, naming it
 * (before anything is written or held). An `auto` source (the new node's
 * default) is the even split, silently, for such a caller. Shares the use-case
 * route harness with the Tighten Episode route tests.
 */
import { m, makeApp } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect } from "vitest"
import type { FastifyInstance } from "fastify"
import { buildClipPackGraph, resolveClipPackSettings } from "@nodaro/render-rules"

const post = (app: FastifyInstance, payload: Record<string, unknown>, url = "/v1/clip-pack") => app.inject({ method: "POST", url, payload })

describe("POST /v1/clip-pack: the framing source (decided 2026-10-17)", () => {
  const media = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
  const prepare = (framingSource: string) => {
    const settings = resolveClipPackSettings({ framingSource }, "video")
    m.prepared = { ok: true, settings, sources: { media }, graph: buildClipPackGraph(settings, { media }) }
  }
  const payload = (framingSource: string) => ({ mediaUrls: ["https://r2/ep.mp4"], framingSource })

  it("takes auto, static and tracking, and hands the choice to the run as sent; refuses any other value", async () => {
    const app = await makeApp()
    for (const framingSource of ["auto", "static", "tracking"]) {
      m.prepare.mockClear()
      expect((await post(app, payload(framingSource))).statusCode).toBe(202)
      expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource })
    }
    m.prepare.mockClear()
    expect((await post(app, payload("faces"))).statusCode).toBe(400)
    expect(m.prepare).not.toHaveBeenCalled()
  })

  it("following faces while Speaker Frames is withheld from the caller: 403 naming it, before anything is written or held, and its estimate", async () => {
    prepare("tracking")
    m.deniedTypes = ["speaker-frames"]
    const app = await makeApp()
    const res = await post(app, payload("tracking"))
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "node_not_available", message: "Clip Pack needs Speaker Frames for this run, which is not available on this deployment." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect((await post(app, payload("tracking"), "/v1/clip-pack/estimate")).statusCode).toBe(403)
  })

  it("auto while Speaker Frames is withheld from the caller: the even split, silently — no refusal", async () => {
    prepare("static")
    m.deniedTypes = ["speaker-frames"]
    const app = await makeApp()
    expect((await post(app, payload("auto"))).statusCode).toBe(202)
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "static" })
  })
})
