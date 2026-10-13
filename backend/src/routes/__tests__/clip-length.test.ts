import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { ClipJobState } from "../../lib/clip-measure-job.js"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } from "@nodaro/render-rules"
import { clipLengthRoutes } from "../clip-length.js"

const CLIP = { durationMs: 14_600, width: 640, height: 360, faces: "present" as const }
const URL = "https://cdn.example.test/a.mp4"

async function makeApp(over: {
  userId?: string | null
  videoModeLive?: boolean
  poll?: ClipJobState
  start?: ClipJobState
  limited?: boolean
} = {}) {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    if (over.userId !== null) req.userId = over.userId ?? "user-1"
  })
  const poll = vi.fn(async (): Promise<ClipJobState> => over.poll ?? { status: "none" })
  const start = vi.fn(async (): Promise<ClipJobState> => over.start ?? { status: "running" })
  const startLimit = vi.fn(async (_req: FastifyRequest, reply: FastifyReply) => {
    if (over.limited) return reply.status(429).send({ error: { code: "rate_limit_exceeded", message: "Too many requests." } })
  })
  await app.register(clipLengthRoutes({ videoModeLive: () => over.videoModeLive ?? true, job: { poll, start }, startLimit }))
  await app.ready()
  return { app, poll, start, startLimit }
}
const post = (app: Awaited<ReturnType<typeof makeApp>>["app"], payload: unknown) => app.inject({ method: "POST", url: "/v1/media/clip-length", payload: payload as object })

describe("POST /v1/media/clip-length (a background measurement, polled)", () => {
  it("answers a measured clip at once, without starting or limiting anything", async () => {
    const { app, poll, start, startLimit } = await makeApp({ poll: { status: "ready", clip: CLIP } })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { status: "ready", ...CLIP } })
    expect(poll).toHaveBeenCalledWith(URL)
    expect(start).not.toHaveBeenCalled()
    expect(startLimit).not.toHaveBeenCalled()
  })

  it("starts the measurement when nothing is known, and answers 202 running with when to ask again", async () => {
    const { app, start, startLimit } = await makeApp()
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { status: "running", retryAfterMs: 2000 } })
    expect(startLimit).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(URL)
  })

  it("answers a poll of a running measurement 202 without starting another or spending the person's start allowance", async () => {
    const { app, start, startLimit } = await makeApp({ poll: { status: "running" } })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(202)
    expect(start).not.toHaveBeenCalled()
    expect(startLimit).not.toHaveBeenCalled()
  })

  it("rate-limits STARTS per user, and measures nothing for a person over the limit", async () => {
    const { app, start } = await makeApp({ limited: true })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(429)
    expect(start).not.toHaveBeenCalled()
  })

  it("is closed until Speaker View is videoModeLive, for every caller, and touches nothing", async () => {
    const { app, poll, start, startLimit } = await makeApp({ videoModeLive: false })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { code: "video_mode_not_live", message: SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } })
    expect(poll).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(startLimit).not.toHaveBeenCalled()
  })

  it("requires a signed-in caller, and answers an anonymous one nothing about the price or the file", async () => {
    const { app, poll } = await makeApp({ userId: null, videoModeLive: false })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(401)
    expect(poll).not.toHaveBeenCalled()
  })

  it("refuses an address the SSRF schema rejects before measuring", async () => {
    const { app, poll, start } = await makeApp()
    for (const videoUrl of ["http://127.0.0.1/a.mp4", "http://169.254.169.254/latest", "file:///etc/passwd", "nope"]) {
      const res = await post(app, { videoUrl })
      expect(res.statusCode, videoUrl).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect((await post(app, {})).statusCode).toBe(400)
    expect(poll).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("answers a clip it cannot measure with its sentence", async () => {
    const { app } = await makeApp({ poll: { status: "failed", code: "no-picture", message: "This file has no picture." } })
    const res = await post(app, { videoUrl: "https://cdn.example.test/a.mp3" })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "video_unreadable", message: "This file has no picture." } })
  })

  it("names a file over the size cap as such", async () => {
    const { app } = await makeApp({ poll: { status: "failed", code: "too-large", message: "This video is over the 500 MB limit." } })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("video_too_large")
  })

  it("passes a measurement that finished between the poll and the start straight through", async () => {
    const { app } = await makeApp({ start: { status: "ready", clip: CLIP } })
    const res = await post(app, { videoUrl: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("ready")
  })
})
