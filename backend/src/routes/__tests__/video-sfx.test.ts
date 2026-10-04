import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import * as ffmpegUtils from "../../providers/video/ffmpeg-utils.js"

// The base price of each bucket row, as the static table lists it (the
// mapping from a length to its row is tested in @nodaro/shared).
const BUCKET_BASE: Record<string, number> = {
  "replicate-mmaudio:8s": 10,
  "replicate-mmaudio:15s": 10,
  "replicate-mmaudio:30s": 20,
  "replicate-mmaudio:60s": 30,
  "replicate-mmaudio:120s": 50,
  "replicate-mmaudio:300s": 110,
}

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
  let reserveCalls: Array<{ model: string; creditOverride: number | undefined }> = []
  let guardCredits: number | undefined
  let refundCalls: string[] = []
  let jobDeleteIds: string[][] = []

  // Override knobs reset per test
  let reserveBehavior: ((jobId: string, callIndex: number) => Promise<{ usageLogId: string } | undefined> | { usageLogId: string } | undefined) | null = null

  beforeEach(async () => {
    vi.resetModules()
    insertCallCount = 0
    reserveCallCount = 0
    reserveCalls = []
    guardCredits = undefined
    refundCalls = []
    jobDeleteIds = []
    reserveBehavior = null

    app = Fastify()

    // Stub creditGuard preHandler — just stamps userId + creditReservation.
    // The route handler itself calls reserveCreditsForJob per row.
    vi.doMock("../../middleware/credit-guard.js", () => ({
      creditGuard: (_resolveModel: any, opts: any) => async (req: any) => {
        const credits = opts?.computeCredits ? await opts.computeCredits(req.body) : 0
        guardCredits = credits
        req.userId = "test-user"
        req.creditReservation = {
          usageLogId: "",
          creditsReserved: credits,
          watermark: false,
          creditOverride: credits,
        }
      },
      reserveCreditsForJob: vi.fn(async (req: any, reply: any, jobId: string, model: string) => {
        const idx = reserveCallCount
        reserveCallCount += 1
        reserveCalls.push({ model, creditOverride: req.creditReservation?.creditOverride })
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
        apps_auto_scroll_seconds: 4, nodaro_provider_prefs: null,
      }),
    }))

    // Base price of a row: the static table's bucket prices (the real lookup
    // reads model_pricing, which the supabase stub above does not serve).
    vi.doMock("../../lib/credit-base-cost.js", () => ({
      baseCreditCostFor: vi.fn(async (id: string) => BUCKET_BASE[id] ?? 0),
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
    vi.doUnmock("../../lib/credit-base-cost.js")
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

  it("prices the run from the clip length's own row: the batch is checked, each take reserves one row", async () => {
    const ffmpeg = await import("../../providers/video/ffmpeg-utils.js")
    vi.mocked(ffmpeg.probeVideoSource).mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: 30,
    } as any)

    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4", prompt: "footsteps", versions: 3 },
    })
    expect(res.statusCode).toBe(200)
    // 30 s → the :30s row (20), three takes checked up front.
    expect(guardCredits).toBe(60)
    // Each take reserves the :30s row at its own price (no markup configured here).
    expect(reserveCalls).toEqual([
      { model: "replicate-mmaudio:30s", creditOverride: 20 },
      { model: "replicate-mmaudio:30s", creditOverride: 20 },
      { model: "replicate-mmaudio:30s", creditOverride: 20 },
    ])
    const { videoQueue } = await import("../../lib/queue.js")
    const payload = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as any
    expect(payload?.duration_seconds).toBe(30)
    expect(payload?.bucketKey).toBe("replicate-mmaudio:30s")
  })

  it.each([
    [5, "replicate-mmaudio:8s", 10],
    [31, "replicate-mmaudio:60s", 30],
    [180, "replicate-mmaudio:300s", 110],
  ])("a %i s clip reserves %s (%i)", async (seconds, row, credits) => {
    const ffmpeg = await import("../../providers/video/ffmpeg-utils.js")
    vi.mocked(ffmpeg.probeVideoSource).mockResolvedValue({
      width: 1920, height: 1080, durationSeconds: seconds,
    } as any)
    const res = await app.inject({
      method: "POST", url: "/v1/video-sfx",
      payload: { videoUrl: "https://example.com/v.mp4" },
    })
    expect(res.statusCode).toBe(200)
    expect(guardCredits).toBe(credits)
    expect(reserveCalls).toEqual([{ model: row, creditOverride: credits }])
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
