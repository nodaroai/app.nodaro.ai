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
    isDirectVideoFileUrl: (url: string) => /\.mp4($|[?#])/.test(url),
  }
})

// The DNS pre-resolve gate for direct-file hosts — mocked so tests never hit
// real DNS; individual tests flip it to exercise the reject path.
vi.mock("@/lib/safe-fetch.js", () => ({
  resolvesOnlyToPublicAddresses: vi.fn().mockResolvedValue(true),
}))

// The poster-frame fallback (ffmpeg) — mocked; the harness's downloaded "video"
// is fake bytes a real extraction would choke on.
vi.mock("@/utils/thumbnail.js", () => ({
  thumbnailFromLocalVideo: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
}))

vi.mock("@/lib/dynamic-origins.js", () => ({
  isOriginAllowedDynamic: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { downloadVideoRoutes } from "../download-video.js"
import { downloadYouTubeVideo } from "../../providers/video/youtube-video.js"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "../../lib/storage.js"
import { supabase } from "../../lib/supabase.js"
import { updateStorageUsage } from "../../utils/file-validation.js"
import { resolvesOnlyToPublicAddresses } from "../../lib/safe-fetch.js"
import { thumbnailFromLocalVideo } from "../../utils/thumbnail.js"

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
// Tests — maxHeight validation, clamping, and passthrough to the provider
// ---------------------------------------------------------------------------

describe("POST /v1/download-video — maxHeight", () => {
  async function maxHeightSeenByProvider(): Promise<number | undefined> {
    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    const seen = vi.mocked(downloadYouTubeVideo).mock.calls[0][0].maxHeight
    // Drain the background pipeline so its tail can't leak into the next test.
    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
    return seen
  }

  it("400 when maxHeight is not a number (strict body)", async () => {
    const res = await post({ url: YT_URL, maxHeight: "720" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("400 when maxHeight is a non-integer number (strict body)", async () => {
    const res = await post({ url: YT_URL, maxHeight: 720.5 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("threads a valid maxHeight straight through to the provider", async () => {
    const res = await post({ url: YT_URL, maxHeight: 720 })
    expect(res.statusCode).toBe(200)
    expect(await maxHeightSeenByProvider()).toBe(720)
  })

  it("clamps a below-floor value up to 144", async () => {
    const res = await post({ url: YT_URL, maxHeight: 50 })
    expect(res.statusCode).toBe(200)
    expect(await maxHeightSeenByProvider()).toBe(144)
  })

  it("clamps an above-ceiling value down to 4320", async () => {
    const res = await post({ url: YT_URL, maxHeight: 10000 })
    expect(res.statusCode).toBe(200)
    expect(await maxHeightSeenByProvider()).toBe(4320)
  })

  it("no maxHeight → provider called with maxHeight undefined (behavior unchanged)", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(200)
    expect(await maxHeightSeenByProvider()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tests — direct video-file URLs (cdn-style links)
// ---------------------------------------------------------------------------

const DIRECT_URL = "https://cdn.nodaro.ai/uploads/videos/5b3f3a3b.mp4"

describe("POST /v1/download-video — direct video-file URLs", () => {
  it("accepts a direct .mp4 URL and passes the 500MB size cap to the provider", async () => {
    const res = await post({ url: DIRECT_URL })
    expect(res.statusCode).toBe(200)

    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    const opts = vi.mocked(downloadYouTubeVideo).mock.calls[0][0]
    expect(opts.url).toBe(DIRECT_URL)
    expect(opts.maxFilesizeBytes).toBe(500 * 1024 * 1024)

    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })

  it("social URLs pass NO size cap (behavior unchanged)", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(200)

    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadYouTubeVideo).mock.calls[0][0].maxFilesizeBytes).toBeUndefined()

    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })

  it("400 when a direct URL's host resolves to a private/reserved address", async () => {
    vi.mocked(resolvesOnlyToPublicAddresses).mockResolvedValueOnce(false)
    const res = await post({ url: DIRECT_URL })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("social URLs skip the DNS pre-resolve (fixed reputable hosts)", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(downloadYouTubeVideo).toHaveBeenCalledTimes(1))
    expect(resolvesOnlyToPublicAddresses).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })

  it("still 400s a URL that is neither social nor a direct video file", async () => {
    const res = await post({ url: "https://vimeo.com/12345" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(downloadYouTubeVideo).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests — poster-frame fallback when yt-dlp wrote no sidecar thumbnail
// ---------------------------------------------------------------------------

describe("POST /v1/download-video — poster-frame fallback", () => {
  it("extracts a poster from the downloaded file when no sidecar thumbnail exists", async () => {
    // The provider mock writes ONLY the video file — no sidecar thumbnail, the
    // exact shape of a direct-file download (and of any source yt-dlp couldn't
    // fetch a thumbnail for).
    const res = await post({ url: DIRECT_URL })
    expect(res.statusCode).toBe(200)

    await vi.waitFor(() => expect(thumbnailFromLocalVideo).toHaveBeenCalledTimes(1))
    // Fed the still-on-disk downloaded file…
    expect(vi.mocked(thumbnailFromLocalVideo).mock.calls[0][0]).toMatch(/yt-video-[0-9a-f-]+\.mp4$/)
    // …and uploaded as the download's PNG poster.
    await vi.waitFor(() =>
      expect(uploadBufferToR2).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^thumbnails\/yt-[0-9a-f-]+\.png$/),
        "image/png",
      ),
    )
    await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
  })

  it("a poster-extraction failure must NOT fail the download (nice-to-have)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      vi.mocked(thumbnailFromLocalVideo).mockRejectedValueOnce(new Error("ffmpeg exploded"))
      const res = await post({ url: DIRECT_URL })
      expect(res.statusCode).toBe(200)

      // The download still completes its bookkeeping — video delivered.
      await vi.waitFor(() => expect(updateStorageUsage).toHaveBeenCalled())
    } finally {
      warnSpy.mockRestore()
    }
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
