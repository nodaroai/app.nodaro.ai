/**
 * POST /v1/tighten-episode on several recordings and a Master audio (decided
 * 2026-10-17): what the wrapper records for a multicam run, the refusals that
 * come before anything is written, and the clock the estimate answers. The
 * route's other cases are tighten-episode.test.ts; both share one harness.
 */
import { m, makeApp, post } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect } from "vitest"
import { buildTightenEpisodeGraph, resolveTightenEpisodeSettings } from "@nodaro/render-rules"

describe("POST /v1/tighten-episode: several recordings and a Master audio (decided 2026-10-17)", () => {
  const cams = {
    media: { url: "https://r2/c1.mp4", kind: "video" as const, durationSec: 5400 },
    moreMedia: [{ url: "https://r2/c2.mp4", kind: "video" as const, durationSec: 5300 }],
    masterAudio: { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 5460 },
  }
  const prepareMulticam = () => {
    const settings = resolveTightenEpisodeSettings({}, "video", { recordings: 2, masterAudio: true })
    m.prepared = { ok: true, settings, sources: cams, graph: buildTightenEpisodeGraph(settings, cams) }
  }
  const payload = { mediaUrls: ["https://r2/c1.mp4", "https://r2/c2.mp4"], masterAudioUrl: "https://r2/m.wav" }

  it("several recordings asked for by a caller who may not use Speaker Map: 403 before anything is probed or written, and its estimate", async () => {
    prepareMulticam()
    m.deniedTypes = ["speaker-map"]
    const app = await makeApp()
    const res = await post(app, payload)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({
      code: "node_not_available",
      message: "Tighten Episode on several recordings or with a Master audio is not available on this deployment yet. Send one recording.",
    })
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.estimateCalls).toBe(0)
    const est = await app.inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload })
    expect(est.statusCode).toBe(403)
    expect(m.prepare).not.toHaveBeenCalled()
    // One recording and a Master audio asks for it too.
    expect((await post(app, { mediaUrls: ["https://r2/c1.mp4"], masterAudioUrl: "https://r2/m.wav" })).statusCode).toBe(403)
  })
  it("one recording with that same file as Master audio, or Cameras settings alone, asks for nothing more: the run as before", async () => {
    m.deniedTypes = ["speaker-map"]
    const app = await makeApp()
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"], masterAudioUrl: "https://r2/ep.mp4" })).statusCode).toBe(202)
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"], cameras: "not cameras" })).statusCode).toBe(202)
  })
  it("a caller who may use Speaker Map, with another step of the chain withheld: 403 naming that step, before anything is written", async () => {
    prepareMulticam()
    m.deniedTypes = ["camera-switch"]
    const app = await makeApp()
    const res = await post(app, payload)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "node_not_available", message: "Tighten Episode needs Camera Switch for this run, which is not available on this deployment." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect((await app.inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload })).statusCode).toBe(403)
  })
  it("a run that builds no hidden step is not refused for it (one recording: no Speaker Map)", async () => {
    m.deniedTypes = ["speaker-map"]
    expect((await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })).statusCode).toBe(202)
  })
  it("the wrapper records every recording, the master and the run's kind (the resume match reads them), and the clock's length", async () => {
    prepareMulticam()
    await post(await makeApp(), payload)
    const input = (m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
    expect(input).toMatchObject({
      mediaUrl: "https://r2/c1.mp4",
      mediaUrls: ["https://r2/c1.mp4", "https://r2/c2.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      mediaKind: "video",
      durationSec: 5460,
    })
  })
  it("the estimate answers the clock's length: the Master audio's", async () => {
    prepareMulticam()
    const est = await (await makeApp()).inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload })
    expect(est.json().data.durationSec).toBe(5460)
  })
})
