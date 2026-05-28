import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { bucketBaseCreditsFor, bucketKeyFor } from "../video-sfx.js"
import * as ffmpegUtils from "../../providers/video/ffmpeg-utils.js"

describe("bucketBaseCreditsFor", () => {
  it.each([
    [1, 1],       // very short → :8s bucket
    [5, 1],       // 5s → :8s
    [8, 1],       // 8s exact → :8s
    [9, 1],       // 9s → :15s
    [15, 1],      // 15s exact → :15s
    [16, 2],      // 16s → :30s
    [30, 2],      // 30s exact → :30s
    [31, 3],      // 31s → :60s
    [60, 3],      // 60s exact → :60s
    [61, 5],      // 61s → :120s
    [120, 5],     // 120s exact → :120s
    [121, 11],    // 121s → :300s
    [300, 11],    // 300s exact → :300s
  ])("durationSeconds=%i → %i BASE credits", (dur, expected) => {
    expect(bucketBaseCreditsFor(dur)).toBe(expected)
  })
})

describe("bucketKeyFor", () => {
  it.each([
    [1,   "replicate-mmaudio:8s"],
    [8,   "replicate-mmaudio:8s"],
    [9,   "replicate-mmaudio:15s"],
    [15,  "replicate-mmaudio:15s"],
    [16,  "replicate-mmaudio:30s"],
    [30,  "replicate-mmaudio:30s"],
    [31,  "replicate-mmaudio:60s"],
    [60,  "replicate-mmaudio:60s"],
    [61,  "replicate-mmaudio:120s"],
    [120, "replicate-mmaudio:120s"],
    [121, "replicate-mmaudio:300s"],
    [300, "replicate-mmaudio:300s"],
  ])("durationSeconds=%i → %s", (dur, expected) => {
    expect(bucketKeyFor(dur)).toBe(expected)
  })
})

describe("probeDurationPreHandler", () => {
  const makeReq = (videoUrl: string) => ({
    body: { videoUrl },
    log: { warn: vi.fn() },
  } as any)
  const makeReply = () => {
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as any
    return reply
  }

  beforeEach(() => vi.restoreAllMocks())

  it("stashes probedDuration on req for valid video", async () => {
    vi.spyOn(ffmpegUtils, "probeVideoSource").mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: 12.3,
    } as any)
    const { probeDurationPreHandler } = await import("../video-sfx.js")
    const req = makeReq("https://example.com/v.mp4")
    const reply = makeReply()
    await probeDurationPreHandler(req, reply)
    expect(req.probedDuration).toBe(13)  // Math.ceil(12.3)
    expect(req.body.__probedDuration).toBe(13)  // mirrored on body for computeCredits
    expect(reply.code).not.toHaveBeenCalled()
  })

  it("falls back to 8s on probe failure (logs warning)", async () => {
    vi.spyOn(ffmpegUtils, "probeVideoSource").mockRejectedValue(new Error("ffprobe failed"))
    const { probeDurationPreHandler } = await import("../video-sfx.js")
    const req = makeReq("https://example.com/v.mp4")
    const reply = makeReply()
    await probeDurationPreHandler(req, reply)
    expect(req.probedDuration).toBe(8)
    expect(req.body.__probedDuration).toBe(8)
    expect(req.log.warn).toHaveBeenCalled()
    expect(reply.code).not.toHaveBeenCalled()
  })

  it("rejects 400 invalid_video_duration when probed duration is 0", async () => {
    vi.spyOn(ffmpegUtils, "probeVideoSource").mockResolvedValue({
      width: 1, height: 1, durationSeconds: 0,
    } as any)
    const { probeDurationPreHandler } = await import("../video-sfx.js")
    const req = makeReq("https://example.com/v.mp4")
    const reply = makeReply()
    await probeDurationPreHandler(req, reply)
    expect(reply.code).toHaveBeenCalledWith(400)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: "invalid_video_duration",
    }))
  })

  it("rejects 400 video_duration_exceeds_limit when probed duration > 300", async () => {
    vi.spyOn(ffmpegUtils, "probeVideoSource").mockResolvedValue({
      width: 1, height: 1, durationSeconds: 305,
    } as any)
    const { probeDurationPreHandler } = await import("../video-sfx.js")
    const req = makeReq("https://example.com/v.mp4")
    const reply = makeReply()
    await probeDurationPreHandler(req, reply)
    expect(reply.code).toHaveBeenCalledWith(400)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: "video_duration_exceeds_limit",
    }))
  })
})

describe("POST /v1/video-sfx", () => {
  let app: ReturnType<typeof Fastify>
  let insertCallCount = 0
  let reserveCallCount = 0
  let refundCalls: string[] = []
  let jobDeleteIds: string[][] = []

  // Override knobs reset per test
  let reserveBehavior: ((jobId: string, callIndex: number) => Promise<{ usageLogId: string } | undefined> | { usageLogId: string } | undefined) | null = null

  beforeEach(async () => {
    vi.resetModules()
    insertCallCount = 0
    reserveCallCount = 0
    refundCalls = []
    jobDeleteIds = []
    reserveBehavior = null

    app = Fastify()

    // Stub creditGuard preHandler — just stamps userId + creditReservation.
    // The route handler itself calls reserveCreditsForJob per row.
    vi.doMock("../../middleware/credit-guard.js", () => ({
      creditGuard: (_resolveModel: any, opts: any) => async (req: any) => {
        const credits = opts?.computeCredits ? await opts.computeCredits(req.body) : 0
        req.userId = "test-user"
        req.creditReservation = {
          usageLogId: "",
          creditsReserved: credits,
          watermark: false,
          creditOverride: credits,
        }
      },
      reserveCreditsForJob: vi.fn(async (_req: any, reply: any, jobId: string, _model: string) => {
        const idx = reserveCallCount
        reserveCallCount += 1
        if (reserveBehavior) {
          const result = await reserveBehavior(jobId, idx)
          if (result === undefined) {
            // Mimic reserveCreditsForJobImpl failure path: delete the failing
            // row and send a 500 reply. The route detects reply.sent and
            // rolls back the rest of the batch.
            await (await import("../../lib/supabase.js")).supabase.from("jobs").delete().eq("id", jobId)
            reply.status(500).send({ error: { code: "credit_reservation_failed", message: "mock failure" } })
            return undefined
          }
          return { usageLogId: result.usageLogId, creditsReserved: 1, watermark: false }
        }
        return { usageLogId: `ulog-${idx}`, creditsReserved: 1, watermark: false }
      }),
    }))

    // Stub video queue
    vi.doMock("../../lib/queue.js", () => ({
      videoQueue: { add: vi.fn().mockResolvedValue({ id: "queued-job-id" }) },
    }))

    // Stub ffmpeg probe (resetModules invalidated the top-level import)
    vi.doMock("../../providers/video/ffmpeg-utils.js", () => ({
      probeVideoSource: vi.fn().mockResolvedValue({
        width: 1920, height: 1080, durationSeconds: 12,
      }),
    }))

    // Stub supabase jobs table: insert returns distinct ids per call.
    vi.doMock("../../lib/supabase.js", () => {
      const supabaseStub = {
        from: vi.fn((table: string) => {
          if (table === "jobs") {
            return {
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => {
                    insertCallCount += 1
                    return { data: { id: `job-${insertCallCount}` }, error: null }
                  }),
                })),
              })),
              delete: vi.fn(() => ({
                in: vi.fn(async (_col: string, ids: string[]) => {
                  jobDeleteIds.push(ids)
                  return { data: null, error: null }
                }),
                eq: vi.fn(async () => ({ data: null, error: null })),
              })),
            }
          }
          return {}
        }),
      }
      return { supabase: supabaseStub }
    })

    // Stub hasCredits() so the route walks the cloud-edition branch
    // (per-row creditOverride + rollback refund import).
    vi.doMock("../../lib/config.js", () => ({
      hasCredits: () => true,
      isCloud: () => true,
      isCommunity: () => false,
      isBusiness: () => false,
      hasAdmin: () => true,
    }))

    // Stub app-settings (markup) so the per-row creditOverride math is deterministic
    vi.doMock("../../lib/app-settings.js", () => ({
      getAppSettings: vi.fn().mockResolvedValue({
        ai_provider: "replicate",
        cost_markup_percent: 0,
        carousel_video_autoplay: true,
        apps_page_video_autoplay: true,
        featured_app_ids: [],
        featured_apps_limit: 20,
        apps_auto_scroll_seconds: 4,
      }),
    }))

    // Stub CreditsService.refundCredits used in rollback
    vi.doMock("../../ee/services/credits.js", () => ({
      CreditsService: {
        refundCredits: vi.fn(async (usageLogId: string) => {
          refundCalls.push(usageLogId)
          return { refunded: 1 }
        }),
      },
    }))

    const { default: videoSfxRoutes } = await import("../video-sfx.js")
    await app.register(videoSfxRoutes)
  })

  afterEach(async () => {
    await app.close()
    vi.doUnmock("../../middleware/credit-guard.js")
    vi.doUnmock("../../lib/queue.js")
    vi.doUnmock("../../providers/video/ffmpeg-utils.js")
    vi.doUnmock("../../lib/supabase.js")
    vi.doUnmock("../../lib/config.js")
    vi.doUnmock("../../lib/app-settings.js")
    vi.doUnmock("../../ee/services/credits.js")
  })

  it("inserts 1 job for default versions and returns { jobId }", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4", prompt: "rain" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.jobIds).toBeUndefined()
    expect(insertCallCount).toBe(1)
    expect(reserveCallCount).toBe(1)

    const { videoQueue } = await import("../../lib/queue.js")
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as any
    expect(payload?.jobId).toBe("job-1")
    expect(payload?.usageLogId).toBe("ulog-0")
  })

  it("inserts N jobs for versions=3 with distinct seeds when seed provided", async () => {
    const ffmpeg = await import("../../providers/video/ffmpeg-utils.js")
    vi.mocked(ffmpeg.probeVideoSource).mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: 30,
    } as any)

    const { videoQueue } = await import("../../lib/queue.js")
    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4", prompt: "footsteps", versions: 3, seed: 42 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2", "job-3"])
    expect(body.jobId).toBeUndefined()
    expect(insertCallCount).toBe(3)
    expect(reserveCallCount).toBe(3)

    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledTimes(3)
    const seeds = vi.mocked(videoQueue.add).mock.calls.map((c: any) => c[1].seed)
    expect(seeds).toEqual([42, 43, 44])
    const jobIds = vi.mocked(videoQueue.add).mock.calls.map((c: any) => c[1].jobId)
    expect(jobIds).toEqual(["job-1", "job-2", "job-3"])
    const usageLogIds = vi.mocked(videoQueue.add).mock.calls.map((c: any) => c[1].usageLogId)
    expect(usageLogIds).toEqual(["ulog-0", "ulog-1", "ulog-2"])
  })

  it("uses random seed (-1) per version when no seed provided", async () => {
    const ffmpeg = await import("../../providers/video/ffmpeg-utils.js")
    vi.mocked(ffmpeg.probeVideoSource).mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: 30,
    } as any)

    const { videoQueue } = await import("../../lib/queue.js")
    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4", versions: 2 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2"])

    const seeds = vi.mocked(videoQueue.add).mock.calls.map((c: any) => c[1].seed)
    expect(seeds).toEqual([-1, -1])
  })

  it("rollback: when reservation fails on 2nd of 3 versions, refund the 1st and delete the 3rd un-reserved row", async () => {
    const ffmpeg = await import("../../providers/video/ffmpeg-utils.js")
    vi.mocked(ffmpeg.probeVideoSource).mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: 8,
    } as any)

    // Reservation succeeds for call 0, fails for call 1, never reached for call 2.
    reserveBehavior = (_jobId: string, idx: number) => {
      if (idx === 0) return { usageLogId: "ulog-0" }
      if (idx === 1) return undefined  // triggers reply.sent=true + row delete
      return { usageLogId: `ulog-${idx}` }
    }

    const { videoQueue } = await import("../../lib/queue.js")
    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4", versions: 3 },
    })

    // The mock reserve sent a 500 directly; the route must NOT have
    // attempted to enqueue ANY rows after rollback.
    expect(res.statusCode).toBe(500)
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()

    // 3 rows were inserted up front.
    expect(insertCallCount).toBe(3)
    // 2 reservations were attempted: call 0 succeeded, call 1 failed (and aborted the loop).
    expect(reserveCallCount).toBe(2)

    // The successful first reservation must have been refunded.
    expect(refundCalls).toEqual(["ulog-0"])

    // The failing row (job-2) was deleted by the mock reserve via supabase.eq().
    // The route additionally deletes the un-reserved orphan (job-3) via supabase.in().
    // Verify the .in() delete call: only job-3 should be in it.
    expect(jobDeleteIds).toEqual([["job-3"]])
  })
})
