import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { promises as fs } from "node:fs"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// The provider is the unit under its OWN tests (youtube-video.test.ts); here it
// is mocked so these tests pin the ROUTE contract: validation of the section
// params, exactly what the route passes through to the provider, and the
// post-upload asset bookkeeping.
vi.mock("@/providers/video/youtube-video.js", () => ({
  downloadYouTubeVideo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage.js", () => ({
  uploadFileWithKeyToR2: vi.fn().mockResolvedValue("https://pub-test.r2.dev/videos/yt-x.mp4"),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://pub-test.r2.dev/thumbnails/yt-x.jpg"),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return {
    safeUrlSchema: z.string().url(),
    isAllowedSocialVideoUrl: (url: string) => url.includes("youtube.com") || url.includes("youtu.be"),
  }
})

vi.mock("@/lib/dynamic-origins.js", () => ({
  isOriginAllowedDynamic: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { downloadVideoRoutes } from "../download-video.js"
import { downloadYouTubeVideo } from "../../providers/video/youtube-video.js"
import { uploadFileWithKeyToR2 } from "../../lib/storage.js"
import { supabase } from "../../lib/supabase.js"
import { updateStorageUsage } from "../../utils/file-validation.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const YT_URL = "https://www.youtube.com/watch?v=abc123"
const FAKE_VIDEO_BYTES = "fake-video-bytes" // 16 bytes — the size the assets row must record

let app: FastifyInstance
let insertSpy: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()

  // The background task stats + unlinks the downloaded file, so the provider
  // mock must actually produce it.
  vi.mocked(downloadYouTubeVideo).mockImplementation(async (opts) => {
    await fs.writeFile(opts.outPath, FAKE_VIDEO_BYTES)
  })

  insertSpy = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabase.from).mockReturnValue({ insert: insertSpy } as never)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from the request body for protected routes.
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") {
      req.userId = body.userId
    }
  })

  await app.register(async (instance) => {
    await downloadVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/download-video",
    payload: { userId: TEST_USER_ID, ...body },
  })
}

// ---------------------------------------------------------------------------
// Tests — section param validation (both-or-neither, 0 <= start < end)
// ---------------------------------------------------------------------------

describe("POST /v1/download-video — section param validation", () => {
  it("400 when only sectionStartSec is provided", async () => {
    const res = await post({ url: YT_URL, sectionStartSec: 10 })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(JSON.stringify(body.error)).toContain("provided together")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("400 when only sectionEndSec is provided", async () => {
    const res = await post({ url: YT_URL, sectionEndSec: 20 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("400 when start >= end (equal and inverted)", async () => {
    for (const [start, end] of [[10, 10], [20, 10]]) {
      const res = await post({ url: YT_URL, sectionStartSec: start, sectionEndSec: end })
      expect(res.statusCode).toBe(400)
      expect(JSON.stringify(res.json().error)).toContain("less than sectionEndSec")
    }
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("400 when sectionStartSec is negative", async () => {
    const res = await post({ url: YT_URL, sectionStartSec: -1, sectionEndSec: 10 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("400 when the section values are not numbers", async () => {
    const res = await post({ url: YT_URL, sectionStartSec: "10", sectionEndSec: "20" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/download-video",
      payload: { url: YT_URL },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests — provider passthrough
// ---------------------------------------------------------------------------

describe("POST /v1/download-video — section passthrough to the provider", () => {
  it("passes the RAW (unpadded) section through — the ±3s pad belongs to the yt-dlp args builder", async () => {
    const res = await post({ url: YT_URL, sectionStartSec: 10, sectionEndSec: 20 })
    expect(res.statusCode).toBe(200)
    expect(res.json().downloadId).toBeTruthy()

    // The download runs fire-and-forget in the background.
    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    const opts = vi.mocked(downloadYouTubeVideo).mock.calls[0][0]
    expect(opts.url).toBe(YT_URL)
    expect(opts.section).toEqual({ startSec: 10, endSec: 20 })

    // Drain the background pipeline (storage tracking is its last async step)
    // so this download's tail can't leak into the next test's mocks.
    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })

  it("no section params → provider called with section undefined (behavior unchanged)", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(200)

    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    const opts = vi.mocked(downloadYouTubeVideo).mock.calls[0][0]
    expect(opts.section).toBeUndefined()

    // Drain — see above.
    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })
})

// ---------------------------------------------------------------------------
// Tests — ownership row + storage accounting for the downloaded video
// ---------------------------------------------------------------------------

describe("POST /v1/download-video — asset bookkeeping", () => {
  it("a completed download creates exactly ONE assets row (owned by the requester) and increments storage", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(200)

    await vi.waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1))
    expect(supabase.from).toHaveBeenCalledExactlyOnceWith("assets")

    const row = insertSpy.mock.calls[0][0]
    expect(row).toMatchObject({
      user_id: TEST_USER_ID,
      type: "video",
      mime_type: "video/mp4",
      size_bytes: FAKE_VIDEO_BYTES.length,
      upload_source: "social_download",
      r2_url: "https://pub-test.r2.dev/videos/yt-x.mp4",
    })
    expect(row.r2_key).toMatch(/^videos\/yt-[0-9a-f-]+\.mp4$/)
    // The row must record EXACTLY the key the video was uploaded under —
    // deleteSource resolves ownership by r2_key, so any drift orphans the object.
    expect(vi.mocked(uploadFileWithKeyToR2).mock.calls[0][1]).toBe(row.r2_key)
    // Row only after the object exists in R2.
    expect(insertSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(uploadFileWithKeyToR2).mock.invocationCallOrder[0],
    )

    // Increment-only accounting: the real uploaded byte count, no reservation RPC.
    await vi.waitFor(() =>
      expect(updateStorageUsage).toHaveBeenCalledExactlyOnceWith(
        TEST_USER_ID,
        FAKE_VIDEO_BYTES.length,
      ),
    )
  })

  it("an insert failure must NOT fail the download — warn, no increment, video still delivered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      insertSpy.mockResolvedValue({ error: { message: "insert exploded" } })

      const res = await post({ url: YT_URL })
      expect(res.statusCode).toBe(200)

      await vi.waitFor(() =>
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("asset record insert failed"),
        ),
      )
      expect(updateStorageUsage).not.toHaveBeenCalled()
      // The background task's failure path always console.error-s
      // "[download-video] <id> failed:" — it must never have been entered.
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
