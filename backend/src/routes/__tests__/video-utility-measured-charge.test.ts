/**
 * Trim Video, Loop Video and Combine Videos are charged by the measured length
 * of the clips they are given: each route probes every clip before its credit
 * guard prices the request, prices the node's own unit formula at those
 * lengths (a length the request sends is ignored), and refuses a clip it
 * cannot read (400) before anything is reserved. The units and the lengths
 * they were charged for ride the job row and the queue payload — the render
 * re-measures against them — and a client cannot set either.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  probe: vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 12 })),
  reserve: vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 0, watermark: false })),
  insert: vi.fn((_row: Record<string, unknown>) => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) })),
  queueAdd: vi.fn(async (_name: string, _payload: Record<string, unknown>) => ({ id: "queue-1" })),
}))

vi.mock("../../lib/config.js", () => ({ hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })) }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        const profile = { role: "user", tier: "standard", subscription_tier: "standard", subscription_credits: 1000, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: null, storage_used_bytes: 0, storage_limit_bytes: 1e10 }
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: h.insert, update: vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) })) }
      return {}
    }),
  },
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
    checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
    reserveCredits: h.reserve,
  },
  // Each node's one-unit row is 10 credits.
  getModelCreditBaseCost: vi.fn(async (_id: string) => ({ creditCost: 10, isEnabled: true, tierRestriction: null })),
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: h.queueAdd } }))
vi.mock("../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: h.probe, assertSafeProbeSource: async () => undefined }))

// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
vi.mock("../../lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string) => (await h.probe(src)).durationSeconds,
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string; isAppRun: boolean }).userId = "u-1"
    ;(req as unknown as { userId: string; isAppRun: boolean }).isAppRun = false
  })
  await (await import("../trim-video.js")).trimVideoRoutes(app)
  await (await import("../loop-video.js")).loopVideoRoutes(app)
  await (await import("../combine-videos.js")).combineVideosRoutes(app)
  return app
}

const A = "https://cdn.example/a.mp4"
const B = "https://cdn.example/b.mp4"
const reserved = () => (h.reserve.mock.calls[0] as unknown as [string, string, string, number, number, { creditOverride?: number }])
const inputData = () => (h.insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }).input_data
const queued = () => h.queueAdd.mock.calls[0]![1]

beforeEach(() => {
  vi.clearAllMocks()
  h.probe.mockImplementation(async (url: string) => ({ width: 640, height: 360, durationSeconds: url === B ? 7.5 : 12 }))
})

describe("Trim Video: charged by the video's measured length", () => {
  it("a whole-clip trim of a 12 s video is 3 units (30 credits), whatever upstreamDuration the request sends", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: A, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0, upstreamDuration: 2 } })
    expect(res.statusCode).toBe(200)
    expect(h.probe).toHaveBeenCalledWith(A)
    expect(reserved()[2]).toBe("trim-video")
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: 30 }))
    // The units and the length they were charged for ride the row and the payload; trimMode stays for the render's check.
    expect(inputData()).toEqual(expect.objectContaining({ billedUnits: 3, upstreamDuration: 12 }))
    expect(queued()).toEqual(expect.objectContaining({ billedUnits: 3, upstreamDuration: 12, trimMode: "seconds" }))
    await app.close()
  })

  it("a fixed window is priced by its window — the video is still measured", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: A, trimMode: "time", startTime: 0, endTime: 4 } })
    expect(res.statusCode).toBe(200)
    expect(h.probe).toHaveBeenCalledWith(A)
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: 10 }))
    await app.close()
  })

  // Priced by what the worker cuts: the branch the fields it is sent select, in
  // the worker's own order, never only the `trimMode` the request names (which
  // the worker does not read). Each on the 12 s clip (11.9 s less the grace).
  it.each([
    // The MCP `trim_video` verb sends no trimMode: the fields of its mode only.
    ["MCP smart loop cut", { smartLoopCut: true }, 4], // ⌈11.9/5⌉ = 3 + ⌈16/24⌉ = 1
    ["MCP smart loop cut, 48 frames searched", { smartLoopCut: true, smartLoopCutLookback: 48 }, 5],
    ["MCP frames", { trimStartFrames: 24, trimEndFrames: 48 }, 2], // 11.9 − 1 − 2 = 8.9 s
    ["MCP time window", { startTime: 2, endTime: 9 }, 2], // 7 s
    // A window past the clip's end ends at the clip: what the worker cuts.
    ["a 0–60 s window on the 12 s clip", { startTime: 0, endTime: 60 }, 3], // 11.9 s, not 60
    ["a 2–60 s window on the 12 s clip", { startTime: 2, endTime: 60 }, 2], // 9.9 s
    ["a window that starts past the clip", { startTime: 12.5, endTime: 20 }, 1], // nothing: the one-unit minimum
    // The SDK's `media.trimVideo` sends the fields it is given, no trimMode either.
    ["SDK keep the last 7 s", { keepLastSeconds: 7 }, 2],
    ["SDK keep the first 3 s", { keepFirstSeconds: 3 }, 1],
    ["SDK trim 2 s off the start", { trimStartSeconds: 2 }, 2], // 9.9 s
    // A time cut with no end runs to the clip's end: from its start to the end.
    ["no end, from the start", {}, 3], // 11.9 s
    ["no end, from 2 s", { startTime: 2 }, 2], // 9.9 s
    ["no end, from 7 s", { trimMode: "time", startTime: 7 }, 1], // 4.9 s
    // Fields of two branches: priced at the larger.
    ["keep the first 3 s and a frames trim", { keepFirstSeconds: 3, trimEndFrames: 24 }, 3], // frames: 10.9 s
    // A named mode with none of its fields: the worker cuts by time, and so is it priced.
    ["keep-first named with no seconds, a time window of 11 s", { trimMode: "keep-first-seconds", startTime: 0, endTime: 11 }, 3],
    ["smart-loop-cut named without smartLoopCut: true, a 4 s window", { trimMode: "smart-loop-cut", startTime: 0, endTime: 4 }, 1],
  ])("%s → %i units", async (_label, fields, units) => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: A, ...fields } })
    expect(res.statusCode).toBe(200)
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: units * 10 }))
    expect(queued()).toEqual(expect.objectContaining({ billedUnits: units, upstreamDuration: 12 }))
    await app.close()
  })

  it("a video that cannot be read is refused with a 400, before any job or reservation", async () => {
    h.probe.mockRejectedValueOnce(new Error("probeVideoSource failed to parse"))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: A, trimMode: "seconds" } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { code: "invalid_video_duration", message: "Could not read the video. The file may be corrupted or an unsupported format." } })
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })

  it("a client cannot set the units or the measurement: a stash or billedUnits it sends is replaced", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST", url: "/v1/trim-video",
      payload: { videoUrl: A, trimMode: "seconds", billedUnits: 1, __videoUtilityMeasured: { secs: [1], units: 1 } },
    })
    expect(res.statusCode).toBe(200)
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: 30 }))
    expect(queued()).toEqual(expect.objectContaining({ billedUnits: 3, upstreamDuration: 12 }))
    expect(queued()).not.toHaveProperty("__videoUtilityMeasured")
    await app.close()
  })

  it("an unsafe url is never probed: the parse answers it", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl: "not a url", trimMode: "seconds" } })
    expect(res.statusCode).toBe(400)
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("Loop Video: charged by the video's measured length", () => {
  it("×2 of a 12 s video is 24 s — 5 units (50 credits)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/loop-video", payload: { videoUrl: A, mode: "repeat", repeatCount: 2, upstreamDuration: 1 } })
    expect(res.statusCode).toBe(200)
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: 50 }))
    expect(inputData()).toEqual(expect.objectContaining({ billedUnits: 5, upstreamDuration: 12 }))
    expect(queued()).toEqual(expect.objectContaining({ billedUnits: 5, upstreamDuration: 12 }))
    await app.close()
  })
})

describe("Combine Videos: charged by each clip's measured length", () => {
  it("a 12 s and a 7.5 s clip (cut, default trims) are 19.5 s − 3 frames each — 4 units (40 credits)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [A, B], trimStartFrames: 1, trimEndFrames: 2, upstreamDurations: [1, 1] } })
    expect(res.statusCode).toBe(200)
    expect(h.probe).toHaveBeenCalledWith(A)
    expect(h.probe).toHaveBeenCalledWith(B)
    expect(reserved()[5]).toEqual(expect.objectContaining({ creditOverride: 40 }))
    expect(inputData()).toEqual(expect.objectContaining({ billedUnits: 4, upstreamDurations: [12, 7.5] }))
    expect(queued()).toEqual(expect.objectContaining({ billedUnits: 4, upstreamDurations: [12, 7.5] }))
    await app.close()
  })

  it("a clip that cannot be read is refused by its place, before any reservation", async () => {
    h.probe.mockImplementation(async (url: string) => {
      if (url === B) throw new Error("unreadable")
      return { width: 640, height: 360, durationSeconds: 12 }
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/combine-videos", payload: { videoUrls: [A, B] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "invalid_video_duration", message: "Could not read clip 2 of 2. The file may be corrupted or an unsupported format." })
    expect(h.reserve).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("the frame grace: up to 0.1 s past a 5-second mark is free on each clip", () => {
  const charged = async (url: string, payload: Record<string, unknown>, sec: number) => {
    h.probe.mockImplementation(async () => ({ width: 640, height: 360, durationSeconds: sec }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url, payload })
    expect(res.statusCode).toBe(200)
    await app.close()
    const units = (h.queueAdd.mock.calls.at(-1)![1] as { billedUnits: number }).billedUnits
    return units
  }
  const trim = { videoUrl: A, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 }

  it.each([
    [10.042, 2, "a clean 10 s generation (one frame past)"],
    [10.08, 2, "an upload of 10.08 s"],
    [10.1, 2, "a clip at the edge of the grace"],
    [10.11, 3, "a clip past the grace"],
    [10.15, 3, "a clip of 10.15 s"],
    [15.042, 3, "a clean 15 s generation"],
  ])("Trim of a %s s clip is %s units (%s)", async (sec, units) => {
    expect(await charged("/v1/trim-video", trim, sec)).toBe(units)
  })

  it("Loop takes the grace off the clip before its copies: a clean 10 s generation ×2 is 4 units, ×3 is 6", async () => {
    expect(await charged("/v1/loop-video", { videoUrl: A, mode: "repeat", repeatCount: 2 }, 10.042)).toBe(4)
    expect(await charged("/v1/loop-video", { videoUrl: A, mode: "repeat", repeatCount: 3 }, 10.042)).toBe(6)
  })

  it("Combine takes it off each clip: two clean 10 s generations (cut, no trims sent) are 4 units", async () => {
    expect(await charged("/v1/combine-videos", { videoUrls: [A, B] }, 10.042)).toBe(4)
  })
})
