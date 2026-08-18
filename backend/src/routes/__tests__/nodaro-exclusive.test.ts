/**
 * The self-hosted routes for the Nodaro-exclusive nodes (4b). What they must
 * guarantee:
 *   - every path refuses with a structured 503 nodaro_connection_required
 *     when the install has no nodaro.ai connection (the frontend renders the
 *     Connect CTA from it) — and creates nothing;
 *   - connected requests enqueue a local job whose payload the relay worker
 *     replays on the cloud;
 *   - gvp stop forwards to the CLOUD job when it exists, and stamps the local
 *     row when it doesn't yet;
 *   - gvp continue maps the LOCAL parent id to its cloud id (provider_task_id)
 *     and refuses when there is nothing to resume from;
 *   - the video-analysis probe is a synchronous passthrough.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  isNodaroConnected: vi.fn().mockResolvedValue(true),
  nodaroCloudFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  callCloudRoute: vi.fn().mockResolvedValue({ ok: true, durationSec: 42 }),
  requestJobStop: vi.fn().mockResolvedValue(undefined),
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
  queueAdd: vi.fn().mockResolvedValue({ id: "bull-1" }),
  maybeSingle: vi.fn(),
}))

vi.mock("@/lib/nodaro-connect.js", () => ({
  isNodaroConnected: mocks.isNodaroConnected,
  nodaroCloudFetch: mocks.nodaroCloudFetch,
}))
vi.mock("@/providers/nodaro/client.js", () => ({ callCloudRoute: mocks.callCloudRoute }))
vi.mock("@/workers/shared.js", () => ({ requestJobStop: mocks.requestJobStop }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {} }))
vi.mock("@/lib/supabase.js", () => {
  // .select().eq("id",...).eq("user_id",...).maybeSingle() — each eq returns
  // the same chain so scoping depth doesn't matter to the mock.
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = (...args: unknown[]) => mocks.maybeSingle(...args)
  const select = vi.fn(() => chain)
  return { supabase: { from: vi.fn(() => ({ select })) } }
})
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { nodaroExclusiveRoutes } from "../nodaro-exclusive.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.isNodaroConnected.mockResolvedValue(true)
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  mocks.nodaroCloudFetch.mockResolvedValue({ ok: true, status: 200 })
  mocks.callCloudRoute.mockResolvedValue({ ok: true, durationSec: 42 })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await nodaroExclusiveRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://example.com/v.mp4"

describe("connection gate", () => {
  const posts: Array<[string, Record<string, unknown>]> = [
    ["/v1/voice-changer-pro", { audioUrl: "https://example.com/a.mp3" }],
    ["/v1/generate-video-pro", { prompt: "p" }],
    ["/v1/edit-video-pro", { videoUrl: VIDEO }],
    ["/v1/video-analysis", { videoUrl: VIDEO }],
    ["/v1/video-audit", { videoUrl: VIDEO }],
    ["/v1/video-analysis/probe", { videoUrl: VIDEO }],
    ["/v1/generate-video-pro/continue", { fromJobId: "j-0" }],
  ]
  for (const [url, payload] of posts) {
    it(`${url} answers 503 nodaro_connection_required when unconnected — and creates nothing`, async () => {
      mocks.isNodaroConnected.mockResolvedValue(false)
      const res = await app.inject({ method: "POST", url, payload: { ...payload, userId: USER } })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("nodaro_connection_required")
      expect(mocks.insertJob).not.toHaveBeenCalled()
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })
  }
})

describe("enqueue", () => {
  it("a connected request creates the local job and enqueues its payload for the relay", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-video-pro",
      payload: { videoUrl: VIDEO, instructions: "stabilize", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(mocks.insertJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: USER, status: "pending" }),
    )
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "edit-video-pro",
      expect.objectContaining({ jobId: "job-1", videoUrl: VIDEO, instructions: "stabilize" }),
    )
  })

  it("gvp is a passthrough — unknown fields survive to the relay (the cloud's Zod is the schema authority)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro",
      payload: { prompt: "epic", segments: 4, weirdNewField: "x", userId: USER },
    })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "generate-video-pro",
      expect.objectContaining({ segments: 4, weirdNewField: "x" }),
    )
  })

  it("vcp refuses a body with neither audioUrl nor videoUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/voice-changer-pro",
      payload: { voice: "deep", userId: USER },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("the video-first types refuse a body without videoUrl", async () => {
    for (const url of ["/v1/edit-video-pro", "/v1/video-analysis", "/v1/video-audit"]) {
      const res = await app.inject({ method: "POST", url, payload: { userId: USER } })
      expect(res.statusCode).toBe(400)
    }
  })

  it("requires auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-audit", payload: { videoUrl: VIDEO } })
    expect(res.statusCode).toBe(401)
  })
})

describe("probe passthrough", () => {
  it("proxies synchronously through the connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/video-analysis/probe",
      payload: { videoUrl: VIDEO, userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, durationSec: 42 })
    expect(mocks.callCloudRoute).toHaveBeenCalledWith(
      "/v1/video-analysis/probe",
      expect.objectContaining({ videoUrl: VIDEO }),
    )
  })
})

describe("gvp stop", () => {
  const stopUrl = "/v1/generate-video-pro/job-1/stop"
  const gvpRow = (over: Record<string, unknown> = {}) => ({
    id: "job-1",
    user_id: USER,
    job_type: "generate-video-pro",
    status: "processing",
    provider_task_id: null,
    ...over,
  })

  it("404s a job the caller does not own — the query is user-scoped, so not-owned resolves as absent", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(404)
  })

  it("409s a job already terminal", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ status: "completed" }) })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_terminal")
  })

  it("before the cloud job exists: stamps the local row (the relay forwards it after create)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow() })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", stopping: true })
    expect(mocks.requestJobStop).toHaveBeenCalledWith("job-1")
    expect(mocks.nodaroCloudFetch).not.toHaveBeenCalled()
  })

  it("after the cloud job exists: forwards the stop to the CLOUD job id", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ provider_task_id: "cloud-7" }) })
    const res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)
    expect(mocks.nodaroCloudFetch).toHaveBeenCalledWith("/v1/generate-video-pro/cloud-7/stop", {
      method: "POST",
    })
    expect(mocks.requestJobStop).not.toHaveBeenCalled()
  })

  it("a cloud 409 (already stopping) still reports stopping: true; a cloud 5xx is a 502", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: gvpRow({ provider_task_id: "cloud-7" }) })
    mocks.nodaroCloudFetch.mockResolvedValue({ ok: false, status: 409 })
    let res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(200)

    mocks.nodaroCloudFetch.mockResolvedValue({ ok: false, status: 500 })
    res = await app.inject({ method: "POST", url: stopUrl, payload: { userId: USER } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("cloud_stop_failed")
  })
})

describe("gvp continue", () => {
  it("maps the LOCAL parent to its CLOUD id and enqueues a resume payload (fromJobId never leaks to the cloud body)", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "generate-video-pro", provider_task_id: "cloud-parent-3" },
    })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", fromSegment: 2, prompt: "keep going", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    const payload = mocks.queueAdd.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.__nodaroContinue).toEqual({ cloudFromJobId: "cloud-parent-3", fromSegment: 2 })
    expect(payload.fromJobId).toBeUndefined()
    expect(payload.prompt).toBe("keep going")
  })

  it("409s not_resumable when the parent never reached the cloud", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "generate-video-pro", provider_task_id: null },
    })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_resumable")
  })

  it("404s a parent the caller does not own (query-scoped → absent) or of another type", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null })
    let res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(404)

    mocks.maybeSingle.mockResolvedValue({
      data: { id: "j-parent", user_id: USER, job_type: "text-to-video", provider_task_id: "c" },
    })
    res = await app.inject({
      method: "POST",
      url: "/v1/generate-video-pro/continue",
      payload: { fromJobId: "j-parent", userId: USER },
    })
    expect(res.statusCode).toBe(404)
  })
})
