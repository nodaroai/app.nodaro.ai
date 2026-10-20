/**
 * POST /v1/tighten-episode with a framing source (decided 2026-10-17): the
 * body takes `framingSource` (auto, static or tracking) and hands it to the
 * run's settings; a framed run that follows faces adds Speaker Frames, so a
 * caller Speaker Frames is withheld from is refused up front, 403, naming it
 * (before anything is written or held) — the same gate every inner step has.
 * An `auto` source (the new node's default) is the even split, silently, for
 * a caller Speaker Frames is withheld from (decided 2026-10-20); only an
 * explicit `tracking` is refused. The route's other cases are tighten-episode.test.ts; all share one harness.
 */
import { m, makeApp, post } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect } from "vitest"
import { buildTightenEpisodeGraph, resolveTightenEpisodeSettings } from "@nodaro/render-rules"

describe("POST /v1/tighten-episode: the framing source (decided 2026-10-17)", () => {
  const media = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
  const framing = { aspect: "9:16", layout: "stacked" }
  const prepare = (framingSource: string) => {
    const settings = resolveTightenEpisodeSettings({ framing, framingSource }, "video")
    m.prepared = { ok: true, settings, sources: { media }, graph: buildTightenEpisodeGraph(settings, { media }) }
  }
  const payload = (framingSource: string) => ({ mediaUrls: ["https://r2/ep.mp4"], framing, framingSource })

  it("takes auto, static and tracking, and hands the choice to the run as sent", async () => {
    const app = await makeApp()
    for (const framingSource of ["auto", "static", "tracking"]) {
      m.prepare.mockClear()
      expect((await post(app, payload(framingSource))).statusCode).toBe(202)
      expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource })
    }
  })

  it("refuses any other value: 400 validation_error, nothing prepared", async () => {
    const res = await post(await makeApp(), payload("faces"))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.prepare).not.toHaveBeenCalled()
  })

  it("following faces while Speaker Frames is withheld from the caller: 403 naming it, before anything is written or held, and its estimate", async () => {
    prepare("tracking")
    m.deniedTypes = ["speaker-frames"]
    const app = await makeApp()
    const res = await post(app, payload("tracking"))
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "node_not_available", message: "Tighten Episode needs Speaker Frames for this run, which is not available on this deployment." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect((await app.inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload: payload("tracking") })).statusCode).toBe(403)
  })

  it("auto while Speaker Frames is withheld from the caller: the even split, silently — no refusal (decided 2026-10-20)", async () => {
    prepare("static")
    m.deniedTypes = ["speaker-frames"]
    const app = await makeApp()
    expect((await post(app, payload("auto"))).statusCode).toBe(202)
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "static" })
    m.prepare.mockClear()
    expect((await app.inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload: payload("auto") })).statusCode).toBe(200)
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "static" })
  })

  it("auto for a caller who may use Speaker Frames is handed on as auto (the resolver follows faces)", async () => {
    m.deniedTypes = []
    await post(await makeApp(), payload("auto"))
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "auto" })
  })

  it("the even split builds no Speaker Frames, so it is never refused for one", async () => {
    prepare("static")
    m.deniedTypes = ["speaker-frames"]
    expect((await post(await makeApp(), payload("static"))).statusCode).toBe(202)
  })
})
