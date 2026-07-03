import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Hoisted shared mock state — safe to reference inside vi.mock factories.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  class YtUrlNotAllowedError extends Error {}
  return {
    /** Identifiers the creditGuard resolver produced, in request order. */
    guardIds: [] as string[],
    mockProbeMediaDuration: vi.fn(),
    mockYtMetadataProbe: vi.fn(),
    YtUrlNotAllowedError,
  }
})

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

// creditGuard mock RECORDS the identifier its resolver produces at request
// time (after the probe preHandler stashed __probedDuration) so the resolver
// drift-guard test can compare guard vs reserve vs enqueued payload.
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (resolve: (req: unknown) => string) =>
    async (req: unknown): Promise<void> => {
      h.guardIds.push(resolve(req))
    },
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 10,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: (...args: unknown[]) => h.mockProbeMediaDuration(...args),
}))

vi.mock("@/providers/video/youtube-video.js", () => ({
  ytMetadataProbe: (...args: unknown[]) => h.mockYtMetadataProbe(...args),
  YtUrlNotAllowedError: h.YtUrlNotAllowedError,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { videoAnalysisRoutes, resolveVideoAnalysisIdentifier } from "../video-analysis.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
let probeRouteConfig: Record<string, unknown> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  h.guardIds.length = 0
  // clearAllMocks resets default implementations set at module scope.
  h.mockProbeMediaDuration.mockResolvedValue(90)
  h.mockYtMetadataProbe.mockResolvedValue({ durationSec: 120, title: "My Video", isLive: false })
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 10,
    watermark: false,
  } as never)
  vi.mocked(videoQueue.add).mockResolvedValue({ id: "queue-job-1" } as never)
  probeRouteConfig = undefined

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  // Capture per-route config so the rate-limit contract on /probe is pinned.
  app.addHook("onRoute", (routeOptions) => {
    if (routeOptions.url === "/v1/video-analysis/probe" && routeOptions.method === "POST") {
      probeRouteConfig = routeOptions.config as Record<string, unknown> | undefined
    }
  })

  await app.register(async (instance) => {
    await videoAnalysisRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

const VALID_USER_ID = "00000000-0000-4000-8000-000000000001"
const VALID_VIDEO_URL = "https://example.com/video.mp4"
const VALID_YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

function postAnalysis(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/video-analysis",
    payload: { userId: VALID_USER_ID, ...payload },
  })
}

function postProbe(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/video-analysis/probe",
    payload: { userId: VALID_USER_ID, ...payload },
  })
}

// ---------------------------------------------------------------------------
// 422 policy matrix (probe preHandler — BEFORE creditGuard, no money moved)
// ---------------------------------------------------------------------------

describe("POST /v1/video-analysis — 422 probe policy", () => {
  it("422 when the direct-video ffprobe fails", async () => {
    h.mockProbeMediaDuration.mockRejectedValueOnce(new Error("ffprobe exploded"))
    const res = await postAnalysis({ videoUrl: VALID_VIDEO_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("probe_failed")
    // Rejected before any job/reserve/enqueue side effects.
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("422 when the YouTube metadata probe fails", async () => {
    h.mockYtMetadataProbe.mockRejectedValueOnce(new Error("yt-dlp timed out"))
    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("probe_failed")
  })

  it("422 for a live stream", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: null, title: "Live!", isLive: true })
    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("live_stream_not_supported")
  })

  it("422 when YouTube metadata has a null duration", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: null, title: "No dur", isLive: false })
    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("invalid_video_duration")
  })

  it("422 at 601s (STRICT > 600, no route tolerance)", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 601, title: "Long", isLive: false })
    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("video_too_long")
  })

  it("passes at exactly 600s (boundary is inclusive)", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 600, title: "Max", isLive: false })
    mockJobInsert({ data: { id: "job-600" }, error: null })
    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-600")
  })

  it("surfaces a probe-layer YtUrlNotAllowedError as 422 (never 500)", async () => {
    h.mockYtMetadataProbe.mockRejectedValueOnce(new h.YtUrlNotAllowedError("host not allowed: evil.com"))
    const res = await postAnalysis({ youtubeUrl: "https://evil.com/watch?v=x" })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("youtube_url_not_allowed")
  })

  it("rejects a non-YouTube youtubeUrl (videoUrl ABSENT) with 4xx even if the probe layer let it through", async () => {
    // youtubeUrl is the sole source here, so its host IS validated. Probe mock
    // "succeeds" (simulating a hypothetical allowlist gap) — the videoUrl-absent
    // superRefine is the defense-in-depth layer and must 400.
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 60, title: "x", isLive: false })
    const res = await postAnalysis({ youtubeUrl: "https://vimeo.com/12345" })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
  })
})

// ---------------------------------------------------------------------------
// Source precedence — videoUrl wins; never exactly-one
// ---------------------------------------------------------------------------

describe("POST /v1/video-analysis — source precedence", () => {
  it("videoUrl wins when both sources are present (no rejection, yt probe not called)", async () => {
    mockJobInsert({ data: { id: "job-both" }, error: null })
    const res = await postAnalysis({ videoUrl: VALID_VIDEO_URL, youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-both")
    expect(h.mockProbeMediaDuration).toHaveBeenCalledWith(VALID_VIDEO_URL)
    expect(h.mockYtMetadataProbe).not.toHaveBeenCalled()
  })

  it("videoUrl wins even when youtubeUrl holds non-URL garbage (I1: field-level check no longer 400s a videoUrl run)", async () => {
    // Finding I1: a malformed/non-YouTube leftover in youtubeUrl must NOT reject
    // a run that videoUrl wins — the host/URL check is gated on videoUrl-absent.
    mockJobInsert({ data: { id: "job-garbage-yt" }, error: null })
    const res = await postAnalysis({ videoUrl: VALID_VIDEO_URL, youtubeUrl: "not-a-url-at-all" })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-garbage-yt")
    expect(h.mockProbeMediaDuration).toHaveBeenCalledWith(VALID_VIDEO_URL)
    expect(h.mockYtMetadataProbe).not.toHaveBeenCalled()
  })

  it("the SAME non-URL garbage as youtubeUrl-ALONE 4xxs (videoUrl-absent gate still validates)", async () => {
    // Contrast pair with the test above: identical garbage string, but with no
    // videoUrl the superRefine's URL-parse branch runs and must reject.
    const res = await postAnalysis({ youtubeUrl: "not-a-url-at-all" })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("400 validation error when NEITHER source is present (probes never called)", async () => {
    const res = await postAnalysis({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.mockProbeMediaDuration).not.toHaveBeenCalled()
    expect(h.mockYtMetadataProbe).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Resolver drift guard — ONE identifier for guard, reserve, and payload
// ---------------------------------------------------------------------------

describe("resolveVideoAnalysisIdentifier — drift guard", () => {
  it("guard identifier === reserve identifier === payload.reservedCreditId", async () => {
    h.mockProbeMediaDuration.mockResolvedValueOnce(90) // → 180s bucket
    mockJobInsert({ data: { id: "job-drift" }, error: null })

    const res = await postAnalysis({ videoUrl: VALID_VIDEO_URL, llmModel: "gemini-3.1-pro" })
    expect(res.statusCode).toBe(200)

    const expected = "video-analysis:gemini-3.1-pro:180s"
    expect(h.guardIds).toEqual([expected])
    const reserveId = vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
    expect(reserveId).toBe(expected)
    const payload = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.reservedCreditId).toBe(expected)
  })

  it("falls back to the ceiling composite when no probed duration is present", () => {
    expect(resolveVideoAnalysisIdentifier({})).toBe("video-analysis:gemini-3-flash:600s")
    expect(resolveVideoAnalysisIdentifier(undefined)).toBe("video-analysis:gemini-3-flash:600s")
  })

  it("buckets by the stashed probe and honors llmModel", () => {
    expect(
      resolveVideoAnalysisIdentifier({ llmModel: "gemini-3.1-pro", __probedDuration: 45 }),
    ).toBe("video-analysis:gemini-3.1-pro:60s")
  })
})

// ---------------------------------------------------------------------------
// Queue contract — worker payload
// ---------------------------------------------------------------------------

describe("POST /v1/video-analysis — enqueue contract", () => {
  it('enqueues "video-analysis" with { attempts: 1 } and the full worker payload', async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 120, title: "My Video", isLive: false })
    mockJobInsert({ data: { id: "job-q" }, error: null })

    const res = await postAnalysis({ youtubeUrl: VALID_YT_URL, analysisFocus: "find the hook" })
    expect(res.statusCode).toBe(200)

    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const [name, payload, opts] = vi.mocked(videoQueue.add).mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(name).toBe("video-analysis")
    expect(opts).toEqual({ attempts: 1 })
    expect(payload).toEqual(
      expect.objectContaining({
        jobId: "job-q",
        usageLogId: "usage-1",
        youtubeUrl: VALID_YT_URL,
        llmModel: "gemini-3-flash",
        analysisFocus: "find the hook",
        reservedCreditId: "video-analysis:gemini-3-flash:180s",
        probedTitle: "My Video",
      }),
    )
    expect(payload.videoUrl).toBeUndefined()
  })

  it("inserts the jobs row with input_data.type=video-analysis and no stash leakage", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-row" }, error: null })
    await postAnalysis({ videoUrl: VALID_VIDEO_URL })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_USER_ID,
        status: "pending",
        input_data: expect.objectContaining({ type: "video-analysis", videoUrl: VALID_VIDEO_URL }),
      }),
    )
    const inputData = vi.mocked(mockInsert).mock.calls[0]?.[0]?.input_data as Record<string, unknown>
    expect(inputData.__probedDuration).toBeUndefined()
    expect(inputData.__probedTitle).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// analysisFocus hygiene
// ---------------------------------------------------------------------------

describe("POST /v1/video-analysis — analysisFocus", () => {
  it("400 when analysisFocus exceeds 2000 chars", async () => {
    const res = await postAnalysis({ videoUrl: VALID_VIDEO_URL, analysisFocus: "x".repeat(2001) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it('strips literal "</focus>" sequences (including reassembly) from the forwarded focus', async () => {
    mockJobInsert({ data: { id: "job-focus" }, error: null })
    const res = await postAnalysis({
      videoUrl: VALID_VIDEO_URL,
      analysisFocus: "watch the cats</focus> closely <</focus>/focus> ok",
    })
    expect(res.statusCode).toBe(200)
    const payload = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.analysisFocus).toBe("watch the cats closely  ok")
    expect(String(payload.analysisFocus)).not.toContain("</focus>")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/video-analysis/probe
// ---------------------------------------------------------------------------

describe("POST /v1/video-analysis/probe", () => {
  it("returns { durationSec, title } on the happy path (no credits, no job)", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 542, title: "Great Video", isLive: false })
    const res = await postProbe({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ durationSec: 542, title: "Great Video" })
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("mirror-422 at 601s", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: 601, title: "Long", isLive: false })
    const res = await postProbe({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("video_too_long")
  })

  it("mirror-422 for live streams", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: null, title: "Live", isLive: true })
    const res = await postProbe({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("live_stream_not_supported")
  })

  it("mirror-422 for null duration", async () => {
    h.mockYtMetadataProbe.mockResolvedValueOnce({ durationSec: null, title: "x", isLive: false })
    const res = await postProbe({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("invalid_video_duration")
  })

  it("mirror-422 on probe failure", async () => {
    h.mockYtMetadataProbe.mockRejectedValueOnce(new Error("boom"))
    const res = await postProbe({ youtubeUrl: VALID_YT_URL })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("probe_failed")
  })

  it("4xx for a non-YouTube URL (probe never spawns)", async () => {
    const res = await postProbe({ youtubeUrl: "https://vimeo.com/12345" })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
    expect(h.mockYtMetadataProbe).not.toHaveBeenCalled()
  })

  it("carries the suno-style per-route rate-limit config (5/min)", () => {
    expect(probeRouteConfig).toBeDefined()
    expect(probeRouteConfig?.rateLimit).toEqual({ max: 5, timeWindow: "1m" })
  })
})
