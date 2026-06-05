import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 80,
    watermark: false,
  }),
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

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  // Mirror the protocol gate of the real safeUrlSchema so obvious bad-protocol
  // cases get the same treatment as in prod.
  const safeUrlSchema = z
    .string()
    .url()
    .refine((url) => {
      try {
        const { protocol } = new URL(url)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
  return { safeUrlSchema }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { cinematicAvatarRoutes } from "../cinematic-avatar.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

function setupSupabaseMock() {
  const jobSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })
  return { jobInsert }
}

beforeEach(async () => {
  vi.clearAllMocks()
  setupSupabaseMock()

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await cinematicAvatarRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    prompt: "A cinematic city at night.",
    avatarLooks: ["look-1"],
    duration: 10,
    resolution: "720p",
    aspectRatio: "16:9",
    ...extra,
  }
}

function post(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/cinematic-avatar",
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
}

const ref = (type: string, url: string) => ({ type, url })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/cinematic-avatar — references", () => {
  it("accepts a valid references array and forwards it to the queue", async () => {
    const references = [
      ref("video", "https://r2.example.com/clip.mp4"),
      ref("image", "https://r2.example.com/ref.png"),
      ref("audio", "https://r2.example.com/voice.mp3"),
    ]
    const res = await post(basePayload({ references }))
    expect(res.statusCode).toBe(200)

    const addCall = vi.mocked(videoQueue.add).mock.calls[0]
    expect(addCall[0]).toBe("cinematic-avatar")
    expect((addCall[1] as { references?: unknown }).references).toEqual(references)
  })

  it("succeeds with no references (references is optional)", async () => {
    const res = await post(basePayload())
    expect(res.statusCode).toBe(200)
    const addCall = vi.mocked(videoQueue.add).mock.calls[0]
    expect((addCall[1] as { references?: unknown }).references).toBeUndefined()
  })

  // ── Caps: at most 3 video references ─────────────────────────────────────

  it("allows exactly 3 video references", async () => {
    const references = [
      ref("video", "https://r2.example.com/a.mp4"),
      ref("video", "https://r2.example.com/b.mp4"),
      ref("video", "https://r2.example.com/c.mp4"),
    ]
    const res = await post(basePayload({ references }))
    expect(res.statusCode).toBe(200)
  })

  it("rejects 4 video references (exceeds the 3-video cap)", async () => {
    const references = [
      ref("video", "https://r2.example.com/a.mp4"),
      ref("video", "https://r2.example.com/b.mp4"),
      ref("video", "https://r2.example.com/c.mp4"),
      ref("video", "https://r2.example.com/d.mp4"),
    ]
    const res = await post(basePayload({ references }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  // ── Caps: at most 9 images across avatar looks + image references ────────

  it("rejects when avatarLooks + image references exceed 9 images", async () => {
    // 3 avatar looks (image looks) + 7 image references = 10 > 9
    const references = Array.from({ length: 7 }, (_, i) =>
      ref("image", `https://r2.example.com/img-${i}.png`),
    )
    const res = await post(
      basePayload({ avatarLooks: ["l1", "l2", "l3"], references }),
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("allows exactly 9 images across avatar looks + image references", async () => {
    // 1 avatar look + 8 image references = 9 (cap)
    const references = Array.from({ length: 8 }, (_, i) =>
      ref("image", `https://r2.example.com/img-${i}.png`),
    )
    const res = await post(basePayload({ avatarLooks: ["l1"], references }))
    expect(res.statusCode).toBe(200)
  })

  it("does not count video/audio references toward the image cap", async () => {
    // 1 avatar look + 3 videos + 5 audio + 5 images = 6 images total (≤9), 3 videos (≤3)
    const references = [
      ...Array.from({ length: 3 }, (_, i) => ref("video", `https://r2.example.com/v-${i}.mp4`)),
      ...Array.from({ length: 5 }, (_, i) => ref("audio", `https://r2.example.com/a-${i}.mp3`)),
      ...Array.from({ length: 5 }, (_, i) => ref("image", `https://r2.example.com/i-${i}.png`)),
    ]
    const res = await post(basePayload({ avatarLooks: ["l1"], references }))
    expect(res.statusCode).toBe(200)
  })

  // ── Item shape validation ────────────────────────────────────────────────

  it("rejects an unknown reference type", async () => {
    const res = await post(
      basePayload({ references: [ref("gif", "https://r2.example.com/x.gif")] }),
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects a non-http(s) reference url", async () => {
    const res = await post(
      basePayload({ references: [ref("video", "ftp://r2.example.com/x.mp4")] }),
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
