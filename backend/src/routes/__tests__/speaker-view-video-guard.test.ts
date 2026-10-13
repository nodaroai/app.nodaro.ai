/**
 * The guard sits on the ROUTE, whoever registers it (the cloud plugin on
 * nodaro.ai, the relay shim on a self-host), and runs before the route's own
 * schema and credit guard.
 */
import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { isWholeClipEdl } from "@nodaro/render-rules"
import { registerSpeakerViewVideoGuard } from "../speaker-view-video-guard.js"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const transcript = { words: ["A", "A", "B", "B"].map((speaker, i) => ({ text: `w${i}`, start: i, end: i + 0.5, speaker })) }

async function appWithRoute(over: { videoModeLive?: boolean; authed?: boolean } = {}) {
  const app = Fastify()
  const charged = vi.fn(async (req: { body: unknown }) => { chargedSaw.push(req.body) })
  const chargedSaw: unknown[] = []
  const seen: unknown[] = []
  const measure = vi.fn(async () => ({ durationMs: 14_600, width: 3840, height: 2160 }))
  // The real auth is a GLOBAL preHandler hook (middleware/auth.ts): it runs after
  // every preValidation hook and before the route's own preHandlers.
  if (over.authed !== undefined) {
    app.addHook("preHandler", async (req, reply) => {
      if (req.headers.authorization !== "Bearer ok") return reply.status(401).send({ error: { code: "unauthorized", message: "no" } })
    })
  }
  registerSpeakerViewVideoGuard(app, () => ({ videoModeLive: over.videoModeLive ?? true, measure }))
  await app.register(async (child) => {
    // The plugin's schema REQUIRES an edl, so a videoUrl-only body must pass it.
    const schema = { body: { type: "object", required: ["edl"], properties: { edl: { type: "object" } } } }
    child.post("/v1/speaker-view", { schema, preHandler: charged }, async (req) => { seen.push(req.body); return { jobId: "j-1" } })
    child.post("/v1/apply-edl", async (req) => { seen.push(req.body); return { jobId: "j-2" } })
  })
  await app.ready()
  return { app, charged, chargedSaw, seen, measure }
}

describe("POST /v1/speaker-view with a videoUrl", () => {
  it("hands the route a whole-clip edl instead of the videoUrl", async () => {
    const { app, seen, measure } = await appWithRoute()
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript, quality: "proxy" } })
    expect(res.statusCode).toBe(200)
    expect(measure).toHaveBeenCalledTimes(1)
    const body = seen[0] as Record<string, unknown>
    expect(body.videoUrl).toBeUndefined()
    expect(isWholeClipEdl(body.edl)).toBe(true)
    expect(body.quality).toBe("proxy")
  })

  it("never measures for a caller auth has not admitted", async () => {
    const { app, measure, seen } = await appWithRoute({ authed: true })
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript } })
    expect(res.statusCode).toBe(401)
    expect(measure).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
  })

  it("measures once an authenticated caller gets through, and the credit guard sees the real edit", async () => {
    const { app, measure, chargedSaw, seen } = await appWithRoute({ authed: true })
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", headers: { authorization: "Bearer ok" }, payload: { videoUrl: URL, transcript } })
    expect(res.statusCode).toBe(200)
    expect(measure).toHaveBeenCalledTimes(1)
    for (const body of [chargedSaw[0], seen[0]] as Array<Record<string, unknown>>) {
      expect(body.videoUrl).toBeUndefined()
      expect(isWholeClipEdl(body.edl)).toBe(true)
      expect(JSON.stringify(body.edl)).toContain('"outMs":14600')
    }
  })

  it("answers a post-auth refusal from the measured clip before the credit guard", async () => {
    const app = Fastify()
    const charged = vi.fn(async () => undefined)
    const measure = vi.fn(async () => ({ durationMs: 14_600, width: 1080, height: 1920 }))
    registerSpeakerViewVideoGuard(app, () => ({ videoModeLive: true, measure }))
    await app.register(async (child) => {
      child.post("/v1/speaker-view", { preHandler: charged }, async () => ({ jobId: "j" }))
    })
    await app.ready()
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("source_not_wider")
    expect(charged).not.toHaveBeenCalled()
  })

  it("refuses before the credit guard and the route run", async () => {
    const { app, charged, seen } = await appWithRoute()
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("transcript_required")
    expect(charged).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
  })

  it("answers 503 video_mode_not_live without measuring while video mode is not live (R15)", async () => {
    const { app, measure } = await appWithRoute({ videoModeLive: false })
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("video_mode_not_live")
    expect(measure).not.toHaveBeenCalled()
  })

  it("leaves an edl request and every other route alone", async () => {
    const { app, seen, measure } = await appWithRoute()
    const edl = { version: 1, clock: "master", sources: [], segments: [] }
    expect((await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { edl } })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: "/v1/apply-edl", payload: { videoUrl: URL } })).statusCode).toBe(200)
    expect(seen).toHaveLength(2)
    expect(measure).not.toHaveBeenCalled()
  })
})

describe("POST /v1/speaker-view with a videoUrl: the measurement is bounded like POST /v1/media/clip-length", () => {
  async function bounded(over: { cached?: boolean; limited?: boolean; maxBytes?: number } = {}) {
    const app = Fastify()
    const charged = vi.fn(async () => undefined)
    const measure = vi.fn(async (_url: string, _opts?: { maxBytes?: number }) => ({ durationMs: 14_600, width: 3840, height: 2160 }))
    const peek = vi.fn(async () => (over.cached ? { durationMs: 14_600, width: 3840, height: 2160 } : null))
    const startLimit = vi.fn(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown }; sent: boolean }) => {
      if (over.limited) return reply.status(429).send({ error: { code: "rate_limit_exceeded", message: "Too many requests." } })
    })
    registerSpeakerViewVideoGuard(app, () => ({ videoModeLive: true, measure, peek, startLimit, maxBytes: over.maxBytes ?? 500 * 1024 * 1024 }))
    await app.register(async (child) => {
      child.post("/v1/speaker-view", { preHandler: charged }, async () => ({ jobId: "j" }))
    })
    await app.ready()
    return { app, charged, measure, peek, startLimit }
  }
  const post = (app: Awaited<ReturnType<typeof bounded>>["app"]) =>
    app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript } })

  it("refuses a caller over the per-user limit before any download or charge", async () => {
    const { app, measure, charged } = await bounded({ limited: true })
    const res = await post(app)
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("rate_limit_exceeded")
    expect(measure).not.toHaveBeenCalled()
    expect(charged).not.toHaveBeenCalled()
  })

  it("hands the measurement the plan's size cap", async () => {
    const { app, measure } = await bounded({ maxBytes: 123 })
    expect((await post(app)).statusCode).toBe(200)
    expect(measure).toHaveBeenCalledWith(URL, { maxBytes: 123 })
  })

  it("does not count an address that is already measured against the limit (a cached answer costs nothing)", async () => {
    const { app, startLimit, measure } = await bounded({ cached: true, limited: true })
    const res = await post(app)
    expect(res.statusCode).toBe(200)
    expect(startLimit).not.toHaveBeenCalled()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("answers a clip over the size cap with video_too_large, as the measurement route does", async () => {
    const { ClipMeasureError } = await import("../../lib/clip-measure.js")
    const app = Fastify()
    registerSpeakerViewVideoGuard(app, () => ({
      videoModeLive: true,
      measure: async () => { throw new ClipMeasureError("too-large", "That video is larger than the 500 MB upload limit.") },
    }))
    await app.register(async (child) => { child.post("/v1/speaker-view", async () => ({ jobId: "j" })) })
    await app.ready()
    const res = await app.inject({ method: "POST", url: "/v1/speaker-view", payload: { videoUrl: URL, transcript } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("video_too_large")
  })
})
