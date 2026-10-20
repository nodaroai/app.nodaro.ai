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
import { USE_CASE_FRAMES_NODE_ID, SPEAKER_FRAMES_PRICED, buildTightenEpisodeGraph, resolveTightenEpisodeSettings, usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"

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

/**
 * A body that names no framing source (decided 2026-10-20): read through its
 * type's absent default (the spec's `absentFramingSource`) BEFORE the viewer's
 * rewrite — Speaker Layout's is `auto`, so it follows faces for a caller who
 * may use Speaker Frames and is the even split (no 403, no Speaker Frames
 * step) for one it is withheld from; every type that predates it reads absent
 * as `static`, whoever asks, and its body reaches preparation untouched.
 */
describe("an absent framing source: the type's absent default, then the viewer", () => {
  const media = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
  // Preparation builds the graph from the body the route hands it, so the inner-step check sees what the run would build.
  const buildFromBody = () =>
    m.prepare.mockImplementation(async (type: UseCaseNodeType, body: Record<string, unknown>) => {
      const d = usecaseDescriptor(type)
      const settings = d.resolveSettings(body, "video")
      return { ok: true, settings, sources: { media }, graph: d.build(settings, { media }) }
    })
  const runGraph = () => (m.execute.mock.calls[0]![0] as { graph: { nodes: Array<{ id: string }> } }).graph
  const follows = () => runGraph().nodes.some((n) => n.id === USE_CASE_FRAMES_NODE_ID)
  const postTo = async (type: UseCaseNodeType, payload: Record<string, unknown>) =>
    (await makeApp()).inject({ method: "POST", url: `/v1/${type}`, payload })

  it("Speaker Layout, Speaker Frames withheld: the even split — no 403, no Speaker Frames step, handed on as static", async () => {
    buildFromBody()
    m.deniedTypes = ["speaker-frames"]
    const res = await postTo("speaker-layout", { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "static" })
    expect(follows()).toBe(false)
  })

  it("Speaker Layout, Speaker Frames available: follows faces (while it is priced), the body handed on as sent", async () => {
    buildFromBody()
    m.deniedTypes = []
    const res = await postTo("speaker-layout", { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(m.prepare.mock.calls[0]![1]).not.toHaveProperty("framingSource")
    expect(follows()).toBe(SPEAKER_FRAMES_PRICED)
  })

  it("Speaker Layout's estimate reads it the same way", async () => {
    buildFromBody()
    m.deniedTypes = ["speaker-frames"]
    const res = await (await makeApp()).inject({ method: "POST", url: "/v1/speaker-layout/estimate", payload: { mediaUrls: ["https://r2/ep.mp4"] } })
    expect(res.statusCode).toBe(200)
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ framingSource: "static" })
  })

  it("Tighten Episode, framed, whoever asks: static — the body reaches preparation untouched (no framing source added)", async () => {
    for (const denied of [["speaker-frames"], []]) {
      buildFromBody()
      m.deniedTypes = denied
      m.prepare.mockClear()
      m.execute.mockClear()
      const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], framing: { aspect: "9:16", layout: "stacked" } })
      expect(res.statusCode).toBe(202)
      expect(m.prepare.mock.calls[0]![1]).not.toHaveProperty("framingSource")
      expect(follows()).toBe(false)
    }
  })
})
