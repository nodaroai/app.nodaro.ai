/**
 * The work Trim, Loop and Combine Videos do before a charge is bounded:
 * - the credit guard checks the balance at the one-unit floor before anything
 *   is fetched (a payer who cannot afford one unit probes nothing);
 * - the body is parsed with the route's own schema first: a url the real
 *   `safeUrlSchema` refuses (a loopback or private address) and a Combine
 *   Videos of more than 100 clips are refused with a 400, nothing probed;
 * - a probe that times out is a retryable 503 `probe_timeout`, never "cannot
 *   be read";
 * - the whole measure has one deadline, 90 s (below the ~100 s the proxy in
 *   front of the API waits): each clip's header read gets at most 30 s, the
 *   packet scan at most the rest; past it, a 503 `probe_timeout`;
 * - a client that goes away stops the measure, and no job is created and
 *   nothing reserved.
 * The real url validator runs here (the measured-charge suite mocks it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  probe: vi.fn(async (_src: string, _opts?: { deadlineAt?: number; signal?: AbortSignal }) => 12),
  allowed: { value: true },
  reserve: vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 0, watermark: false })),
  insert: vi.fn(),
  /** The response of the request in flight: closing it before the answer is a client going away. */
  raw: { current: undefined as undefined | { emit: (event: string) => boolean; destroy: () => void } },
  /** Drop the client during the floor check (its close fires before the measure listens). */
  dropDuringGuard: { value: false },
}))

vi.mock("../../lib/config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/config.js")>()), hasCredits: () => true, isCloud: () => true }))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })) }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        const profile = { role: "user", tier: "standard", subscription_tier: "standard", subscription_credits: 1000, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: null, storage_used_bytes: 0, storage_limit_bytes: 1e10 }
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: (row: unknown) => (h.insert(row), { select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) }), update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      return {}
    }),
  },
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
    checkCreditsWithProfile: vi.fn(async () => {
      if (h.dropDuringGuard.value) {
        h.dropDuringGuard.value = false
        h.raw.current?.destroy()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return h.allowed.value ? { allowed: true, watermark: false } : { allowed: false, error: "Insufficient credits", required: 11, balance: 0 }
    }),
    reserveCredits: h.reserve,
  },
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 10, isEnabled: true, tierRestriction: null })),
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: vi.fn(async () => ({ id: "queue-1" })) } }))
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  assertSafeProbeSource: vi.fn(async () => undefined),
}))
vi.mock("../../lib/video-utility-probe.js", () => ({ probeClipLengthSec: h.probe, ClipUnreadableError: class ClipUnreadableError extends Error {} }))

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
    h.raw.current = reply.raw
  })
  await (await import("../trim-video.js")).trimVideoRoutes(app)
  await (await import("../combine-videos.js")).combineVideosRoutes(app)
  return app
}

const clip = (i: number) => `https://cdn.example.com/clip-${i}.mp4`

beforeEach(() => {
  vi.clearAllMocks()
  h.dropDuringGuard.value = false
  h.allowed.value = true
  h.probe.mockImplementation(async () => 12)
})

describe("before any clip is fetched", () => {
  it("a payer who cannot afford one unit gets the 402, and nothing is probed", async () => {
    h.allowed.value = false
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: clip(1), trimMode: "seconds" } })
    expect(res.statusCode).toBe(402)
    expect(h.probe).not.toHaveBeenCalled()
    await app.close()
  })

  it.each([
    ["a loopback address", "http://127.0.0.1/clip.mp4"],
    ["a private address", "http://10.0.0.5/clip.mp4"],
    ["localhost", "http://localhost:3000/clip.mp4"],
  ])("%s fails the real url validator: 400, nothing probed", async (_label, url) => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: url, trimMode: "seconds" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.probe).not.toHaveBeenCalled()
    await app.close()
  })

  it("a Combine Videos of 101 clips is a 400 before any clip is fetched; 100 are measured", async () => {
    const app = await buildApp()
    const over = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: Array.from({ length: 101 }, (_, i) => clip(i)) } })
    expect(over.statusCode).toBe(400)
    expect(over.json().error.code).toBe("validation_error")
    expect(h.probe).not.toHaveBeenCalled()
    const at = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: Array.from({ length: 100 }, (_, i) => clip(i)) } })
    expect(at.statusCode).toBe(200)
    expect(h.probe).toHaveBeenCalledTimes(100)
    await app.close()
  })
})

describe("a probe that times out is retryable, never 'cannot be read'", () => {
  it("503 probe_timeout, nothing reserved", async () => {
    h.probe.mockRejectedValueOnce(Object.assign(new Error("ffprobe failed: killed"), { timedOut: true }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: clip(1), trimMode: "seconds" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toEqual({ code: "probe_timeout", message: "Timed out reading the video — run it again." })
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })

  it("each header read gets 30 s, within the request's 90 s deadline, at the length the node's worker reads (Trim the container, Combine each clip's video stream)", async () => {
    const app = await buildApp()
    const before = Date.now()
    await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: clip(1), trimMode: "seconds" } })
    const trimOpts = h.probe.mock.calls[0]![1]!
    expect(trimOpts).toEqual(expect.objectContaining({ timeoutMs: 30_000, reading: "container", sourceChecked: true, signal: expect.any(AbortSignal) }))
    expect(trimOpts).not.toHaveProperty("packetTimeoutMs")
    expect(trimOpts.deadlineAt).toBeGreaterThanOrEqual(before + 90_000)
    expect(trimOpts.deadlineAt).toBeLessThanOrEqual(Date.now() + 90_000)
    await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [clip(2), clip(3)] } })
    expect(h.probe).toHaveBeenCalledWith(clip(2), expect.objectContaining({ timeoutMs: 30_000, reading: "video-stream", sourceChecked: true }))
    await app.close()
  })

  it("past the request's deadline the clips not yet read are not read: 503 probe_timeout, nothing reserved", async () => {
    // The first four clips are read together; the first takes 95 s, so the fifth starts past the deadline.
    const realNow = Date.now
    let now = realNow()
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    h.probe.mockImplementation(async (src: string) => {
      if (src === clip(1)) now += 95_000
      return 12
    })
    try {
      const app = await buildApp()
      const res = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [1, 2, 3, 4, 5].map(clip) } })
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toEqual({ code: "probe_timeout", message: "Timed out reading clip 5 of 5 — run it again." })
      expect(h.probe).toHaveBeenCalledTimes(4)
      expect(h.reserve).not.toHaveBeenCalled()
      expect(h.insert).not.toHaveBeenCalled()
      await app.close()
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe("a client that goes away before its charge creates nothing", () => {
  // Closing the response before the answer is how the inject harness drops a client: its own promise rejects.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

  it("closed while its clip is read: the read is stopped, no job, no reservation", async () => {
    let stopped: AbortSignal | undefined
    h.probe.mockImplementation(
      (_src: string, opts?: { signal?: AbortSignal }) =>
        new Promise<number>((_resolve, reject) => {
          stopped = opts?.signal
          opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("ffprobe killed"), { aborted: true })))
          h.raw.current?.emit("close")
        }),
    )
    const app = await buildApp()
    await expect(app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: clip(1), trimMode: "seconds" } })).rejects.toThrow(/destroyed/)
    await settle()
    expect(stopped?.aborted).toBe(true)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })

  it("closed after its clips were read but before the job: no job, no reservation", async () => {
    h.probe.mockImplementation(async () => {
      h.raw.current?.emit("close")
      return 12
    })
    const app = await buildApp()
    await expect(app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [clip(1), clip(2)] } })).rejects.toThrow(/destroyed/)
    await settle()
    expect(h.probe).toHaveBeenCalledTimes(2)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })

  it("gone during the floor check, before the measure listens (its close already fired): nothing read, no job, no reservation", async () => {
    h.dropDuringGuard.value = true
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: clip(1), trimMode: "seconds" } }).catch(() => undefined)
    await settle()
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })

  it("a client that stays gets its job (the same request, no close)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [clip(1), clip(2)] } })
    expect(res.statusCode).toBe(200)
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.reserve).toHaveBeenCalledTimes(1)
    await app.close()
  })
})
