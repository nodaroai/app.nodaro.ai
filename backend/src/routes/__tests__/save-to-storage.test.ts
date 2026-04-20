import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: vi.fn(),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { saveToStorageRoutes } from "../save-to-storage.js"
import { supabase } from "../../lib/supabase.js"
import { uploadToR2 } from "../../lib/storage.js"

let app: FastifyInstance

function setupJobMocks() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)
  return { mockInsert, mockUpdate }
}

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
    const limitHeader = req.headers["x-storage-limit"]
    const usedHeader = req.headers["x-storage-used"]
    const limitBytes = typeof limitHeader === "string" ? Number(limitHeader) : 4096
    const usedBytes = typeof usedHeader === "string" ? Number(usedHeader) : 2048
    req.storageSnapshot = {
      usedBytes,
      limitBytes,
      tier: "pro",
    }
  })

  await app.register(async (instance) => {
    await saveToStorageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/save-to-storage", () => {
  it("returns storage_limit_exceeded when quota reservation fails", async () => {
    setupJobMocks()
    vi.mocked(uploadToR2).mockRejectedValue(
      new Error("storage-limit-exceeded: atomic reservation of 2048 bytes refused"),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/save-to-storage",
      payload: {
        mediaUrl: "https://cdn.example.com/asset",
        mediaType: "video",
      },
    })

    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({
      error: {
        code: "storage_limit_exceeded",
        message: "Storage limit exceeded",
        usedBytes: 2048,
        quotaBytes: 4096,
        remainingBytes: 2048,
        tier: "pro",
      },
    })
  })

  it("returns payload_too_large when the media exceeds the per-type limit", async () => {
    setupJobMocks()
    vi.mocked(uploadToR2).mockRejectedValue(
      new Error("upload-size-exceeded: Content-Length 999999 > cap 1024"),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/save-to-storage",
      headers: {
        "x-storage-limit": "104857600",
        "x-storage-used": "0",
      },
      payload: {
        mediaUrl: "https://cdn.example.com/asset",
        mediaType: "image",
      },
    })

    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({
      error: {
        code: "payload_too_large",
        message: "image media exceeds the allowed upload size",
      },
    })
  })

  it("passes an explicit mediaType through for extension-less URLs", async () => {
    const { mockInsert } = setupJobMocks()
    vi.mocked(uploadToR2).mockResolvedValue("https://r2.example.com/videos/job-1.mp4")

    const res = await app.inject({
      method: "POST",
      url: "/v1/save-to-storage",
      payload: {
        mediaUrl: "https://cdn.example.com/download",
        mediaType: "video",
        filename: "clip.mp4",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(uploadToR2)).toHaveBeenCalledWith(
      "https://cdn.example.com/download",
      "job-1",
      "video",
      "00000000-0000-4000-8000-000000000001",
      {
        remainingQuotaBytes: 2048,
        reserveQuota: true,
      },
    )
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          mediaType: "video",
        }),
      }),
    )
  })
})
