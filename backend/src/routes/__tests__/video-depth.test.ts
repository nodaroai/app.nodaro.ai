import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"

/**
 * POST /v1/video-depth — mirrors video-sfx.test.ts: the credit guard, queue,
 * ffprobe and supabase are stubbed; insertJob runs for real over the stubbed
 * jobs table so the persisted row is what the assertions read.
 */
describe("POST /v1/video-depth", () => {
  let app: ReturnType<typeof Fastify>
  let insertedRows: Array<Record<string, unknown>> = []
  let guardModels: string[] = []
  let reserveCalls: Array<{ jobId: string; model: string }> = []
  let guardAuthenticates = true

  const mockProbe = vi.fn()
  const mockQueueAdd = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    insertedRows = []
    guardModels = []
    reserveCalls = []
    guardAuthenticates = true
    mockProbe.mockReset()
    mockQueueAdd.mockReset()
    mockQueueAdd.mockResolvedValue({ id: "queued-job-id" })

    app = Fastify()

    // Stub creditGuard preHandler — records the price row it was asked to
    // check and stamps userId, as the real guard's auth step does.
    vi.doMock("../../middleware/credit-guard.js", () => ({
      creditGuard: (resolveModel: (req: unknown) => string) => async (req: any) => {
        guardModels.push(resolveModel(req))
        if (guardAuthenticates) req.userId = "test-user"
      },
      reserveCreditsForJob: vi.fn(async (_req: unknown, _reply: unknown, jobId: string, model: string) => {
        reserveCalls.push({ jobId, model })
        return { usageLogId: "ulog-1", creditsReserved: 1, watermark: false }
      }),
    }))

    vi.doMock("../../lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))

    vi.doMock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: mockProbe }))

    vi.doMock("../../lib/supabase.js", () => ({
      supabase: {
        from: vi.fn((table: string) => {
          if (table !== "jobs") return {}
          return {
            insert: vi.fn((row: Record<string, unknown>) => {
              insertedRows.push(row)
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: { id: `job-${insertedRows.length}` }, error: null })),
                })),
              }
            }),
          }
        }),
      },
    }))

    const { videoDepthRoutes } = await import("../video-depth.js")
    await app.register(videoDepthRoutes)
  })

  afterEach(async () => {
    await app.close()
    vi.doUnmock("../../middleware/credit-guard.js")
    vi.doUnmock("../../lib/queue.js")
    vi.doUnmock("../../providers/video/ffmpeg-utils.js")
    vi.doUnmock("../../lib/supabase.js")
  })

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/video-depth", payload })

  const expectNothingCreated = () => {
    expect(insertedRows).toHaveLength(0)
    expect(reserveCalls).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  }

  it("400 video_too_long BEFORE the credit guard — no job row, no reservation", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 120, fps: 30 })
    const res = await post({ videoUrl: "https://example.com/v.mp4" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(guardModels).toHaveLength(0)
    expectNothingCreated()
  })

  it("400 video_too_long on Replicate past its seconds cap", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 81, fps: 1 })
    const res = await post({ videoUrl: "https://example.com/v.mp4", provider: "depth-anything-frames" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expectNothingCreated()
  })

  it("400 video_unreadable when the probe fails", async () => {
    mockProbe.mockRejectedValue(new Error("boom"))
    const res = await post({ videoUrl: "https://example.com/v.mp4" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_unreadable")
    expect(guardModels).toHaveLength(0)
    expectNothingCreated()
  })

  it("400 validation_error for a local path — never probed (SSRF), nothing created", async () => {
    const res = await post({ videoUrl: "/etc/passwd" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mockProbe).not.toHaveBeenCalled()
    expect(guardModels).toHaveLength(0)
    expectNothingCreated()
  })

  it("400 validation_error for a missing videoUrl — never probed", async () => {
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mockProbe).not.toHaveBeenCalled()
    expectNothingCreated()
  })

  it("400 validation_error for an unknown provider — never probed, never priced", async () => {
    const res = await post({ videoUrl: "https://example.com/v.mp4", provider: "nope" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mockProbe).not.toHaveBeenCalled()
    expect(guardModels).toHaveLength(0)
    expectNothingCreated()
  })

  it("401 unauthorized when no user is authenticated — nothing created", async () => {
    guardAuthenticates = false
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const res = await post({ videoUrl: "https://example.com/v.mp4" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expectNothingCreated()
  })

  it("persists the RESOLVED provider + bucket in input_data and reserves the bucket", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 20, fps: 24 })
    const res = await post({ videoUrl: "https://example.com/v.mp4", nodeId: "node-7" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].node_id).toBe("node-7")
    expect(insertedRows[0].input_data).toMatchObject({
      type: "video-depth",
      videoUrl: "https://example.com/v.mp4",
      provider: "video-depth-anything",
      modelSize: "large",
      duration_seconds: 20,
      bucketKey: "video-depth-anything:30s",
    })
    expect(guardModels).toEqual(["video-depth-anything:30s"])
    expect(reserveCalls).toEqual([{ jobId: "job-1", model: "video-depth-anything:30s" }])
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(mockQueueAdd.mock.calls[0][0]).toBe("video-depth")
    expect(mockQueueAdd.mock.calls[0][1]).toMatchObject({
      jobId: "job-1",
      videoUrl: "https://example.com/v.mp4",
      provider: "video-depth-anything",
      modelSize: "large",
      durationSec: 20,
      usageLogId: "ulog-1",
    })
  })

  it("fal with no colormap queues and persists grayscale", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    expect((await post({ videoUrl: "https://example.com/v.mp4" })).statusCode).toBe(200)
    expect(mockQueueAdd.mock.calls[0][1].colormap).toBe("grayscale")
    expect((insertedRows[0].input_data as Record<string, unknown>).colormap).toBe("grayscale")
  })

  it("fal passes every lever it honours through", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const res = await post({
      videoUrl: "https://example.com/v.mp4", modelSize: "small", colormap: "turbo",
      sideBySide: true, resolution: "720p",
    })
    expect(res.statusCode).toBe(200)
    const levers = { modelSize: "small", colormap: "turbo", sideBySide: true, resolution: "720p" }
    expect(mockQueueAdd.mock.calls[0][1]).toMatchObject(levers)
    expect(insertedRows[0].input_data).toMatchObject(levers)
  })

  it("coerces a colormap Replicate cannot render to grayscale and drops fal-only levers instead of rejecting", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const res = await post({
      videoUrl: "https://example.com/v.mp4", provider: "depth-anything-frames",
      colormap: "turbo", sideBySide: true, resolution: "720p",
    })
    expect(res.statusCode).toBe(200)
    const queued = mockQueueAdd.mock.calls[0][1]
    const persisted = insertedRows[0].input_data as Record<string, unknown>
    for (const record of [queued, persisted]) {
      expect(record.provider).toBe("depth-anything-frames")
      expect(record.colormap).toBe("grayscale")
      expect(record).not.toHaveProperty("sideBySide")
      expect(record).not.toHaveProperty("resolution")
    }
    expect(reserveCalls[0].model).toBe("depth-anything-frames:15s")
  })

  it("passes inferno through on Replicate", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const res = await post({ videoUrl: "https://example.com/v.mp4", provider: "depth-anything-frames", colormap: "inferno" })
    expect(res.statusCode).toBe(200)
    expect(mockQueueAdd.mock.calls[0][1].colormap).toBe("inferno")
  })

  it("400 validation_error on an unknown colormap", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const badColormap = await post({ videoUrl: "https://example.com/v.mp4", colormap: "rainbow" })
    expect(badColormap.statusCode).toBe(400)
    expect(badColormap.json().error.code).toBe("validation_error")
    expectNothingCreated()
  })

  // Output FPS was removed as a lever (fal's output_fps retimes playback and
  // bills per output second). A client that still sends it is neither
  // rejected nor forwarded: the body schema strips the unknown key.
  it("ignores a legacy outputFps in the body: 200, never queued or persisted", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 24 })
    const res = await post({ videoUrl: "https://example.com/v.mp4", outputFps: 500 })
    expect(res.statusCode).toBe(200)
    expect(mockQueueAdd.mock.calls[0][1]).not.toHaveProperty("outputFps")
    expect(mockQueueAdd.mock.calls[0][1]).not.toHaveProperty("output_fps")
    expect(insertedRows[0].input_data).not.toHaveProperty("outputFps")
    expect(reserveCalls[0].model).toBe("video-depth-anything:15s")
  })
})
