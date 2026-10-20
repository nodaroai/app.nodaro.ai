/**
 * POST /v1/clip-pack on several recordings and a Master audio (decided
 * 2026-10-17): the refusals that come before anything is written (several
 * recordings only for a caller who may use Speaker Map), what the wrapper
 * records for a multicam run, and the clock the estimate answers. Shares the
 * use-case route harness with the Tighten Episode route tests.
 */
import { m, makeApp } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect } from "vitest"
import type { FastifyInstance } from "fastify"
import { buildClipPackGraph, resolveClipPackSettings } from "@nodaro/render-rules"

const post = (app: FastifyInstance, payload: Record<string, unknown>, url = "/v1/clip-pack") => app.inject({ method: "POST", url, payload })

describe("POST /v1/clip-pack: several recordings and a Master audio (decided 2026-10-17)", () => {
  const cams = {
    media: { url: "https://r2/c1.mp4", kind: "video" as const, durationSec: 5400 },
    moreMedia: [{ url: "https://r2/c2.mp4", kind: "video" as const, durationSec: 5300 }],
    masterAudio: { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 5460 },
  }
  const prepareMulticam = () => {
    const settings = resolveClipPackSettings({}, "video", { recordings: 2, masterAudio: true })
    m.prepared = { ok: true, settings, sources: cams, graph: buildClipPackGraph(settings, cams) }
  }
  const prepareOne = () => {
    const settings = resolveClipPackSettings({}, "video")
    const sources = { media: { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 } }
    m.prepared = { ok: true, settings, sources, graph: buildClipPackGraph(settings, sources) }
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
      message: "Clip Pack on several recordings or with a Master audio is not available on this deployment yet. Send one recording.",
    })
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect((await post(app, payload, "/v1/clip-pack/estimate")).statusCode).toBe(403)
    expect(m.estimateCalls).toBe(0)
    // One recording and a Master audio asks for it too.
    expect((await post(app, { mediaUrls: ["https://r2/c1.mp4"], masterAudioUrl: "https://r2/m.wav" })).statusCode).toBe(403)
  })
  it("one recording — alone, with that same file as Master audio, or with Cameras settings alone — asks for nothing more: the run as before", async () => {
    prepareOne()
    m.deniedTypes = ["speaker-map"]
    const app = await makeApp()
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"] })).statusCode).toBe(202)
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"], masterAudioUrl: "https://r2/ep.mp4" })).statusCode).toBe(202)
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"], cameras: "not cameras" })).statusCode).toBe(202)
  })
  it("seven recordings: the body refuses them (six at most)", async () => {
    const res = await post(await makeApp(), { mediaUrls: Array.from({ length: 7 }, (_, i) => `https://r2/c${i}.mp4`) })
    expect(res.statusCode).toBe(400)
    expect(m.prepare).not.toHaveBeenCalled()
  })
  it("a caller who may use Speaker Map, with another step of the chain withheld: 403 naming that step, before anything is written", async () => {
    prepareMulticam()
    m.deniedTypes = ["camera-switch"]
    const app = await makeApp()
    const res = await post(app, payload)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "node_not_available", message: "Clip Pack needs Camera Switch for this run, which is not available on this deployment." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
  })
  it("a caller who may use Speaker Map: the wrapper records every recording, the master and the run's kind (the resume match reads them), and the clock's length", async () => {
    prepareMulticam()
    expect((await post(await makeApp(), payload)).statusCode).toBe(202)
    const input = (m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
    expect(input).toMatchObject({
      type: "clip-pack",
      mediaUrl: "https://r2/c1.mp4",
      mediaUrls: ["https://r2/c1.mp4", "https://r2/c2.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      mediaKind: "video",
      durationSec: 5460,
    })
  })
  it("the estimate answers the clock's length: the Master audio's", async () => {
    prepareMulticam()
    const est = await post(await makeApp(), payload, "/v1/clip-pack/estimate")
    expect(est.json().data.durationSec).toBe(5460)
  })
})
