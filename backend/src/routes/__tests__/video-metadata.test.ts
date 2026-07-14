import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before the route import
// ---------------------------------------------------------------------------

// Only the provider probe is mocked. The REAL url-validator is used so the
// allowlist gate AND the YouTube-vs-other-host routing are exercised against
// the production logic — safeUrlSchema is purely syntactic (no DNS for
// hostname URLs), so this stays hermetic.
vi.mock("@/providers/video/youtube-video.js", () => ({
  ytMetadataProbe: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { videoMetadataRoutes } from "../video-metadata.js"
import { ytMetadataProbe } from "../../providers/video/youtube-video.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const YT_URL = "https://www.youtube.com/watch?v=abc123"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from the request body for protected routes.
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") {
      req.userId = body.userId
    }
  })

  await app.register(async (instance) => {
    await videoMetadataRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/video-metadata", payload: body })
}

const NULLS = { durationSec: null, title: null, isLive: false }

describe("POST /v1/video-metadata — auth + url gate", () => {
  it("401 without auth (before any body parse or probe)", async () => {
    const res = await post({ url: YT_URL })
    expect(res.statusCode).toBe(401)
    expect(ytMetadataProbe).not.toHaveBeenCalled()
  })

  it("400 for a disallowed host (not on the social allowlist)", async () => {
    const res = await post({ userId: TEST_USER_ID, url: "https://vimeo.com/123" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(ytMetadataProbe).not.toHaveBeenCalled()
  })

  it("400 for a syntactically invalid url", async () => {
    const res = await post({ userId: TEST_USER_ID, url: "not-a-url" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(ytMetadataProbe).not.toHaveBeenCalled()
  })
})

describe("POST /v1/video-metadata — YouTube probe", () => {
  it("happy path — returns the probe result verbatim", async () => {
    vi.mocked(ytMetadataProbe).mockResolvedValue({ durationSec: 212, title: "A Song", isLive: false })
    const res = await post({ userId: TEST_USER_ID, url: YT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ durationSec: 212, title: "A Song", isLive: false })
    expect(ytMetadataProbe).toHaveBeenCalledExactlyOnceWith(YT_URL)
  })

  it("relays isLive:true and null fields the probe reports", async () => {
    vi.mocked(ytMetadataProbe).mockResolvedValue({ durationSec: null, title: null, isLive: true })
    const res = await post({ userId: TEST_USER_ID, url: YT_URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ durationSec: null, title: null, isLive: true })
  })

  it("youtu.be short links are treated as YouTube (probe IS called)", async () => {
    vi.mocked(ytMetadataProbe).mockResolvedValue({ durationSec: 5, title: "t", isLive: false })
    const res = await post({ userId: TEST_USER_ID, url: "https://youtu.be/abc123" })
    expect(res.statusCode).toBe(200)
    expect(ytMetadataProbe).toHaveBeenCalledExactlyOnceWith("https://youtu.be/abc123")
  })

  it("probe failure → 200 with all-null metadata (never blocks an import)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      vi.mocked(ytMetadataProbe).mockRejectedValue(new Error("yt-dlp timed out after 15000ms"))
      const res = await post({ userId: TEST_USER_ID, url: YT_URL })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(NULLS)
      expect(ytMetadataProbe).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("POST /v1/video-metadata — non-YouTube allowlisted hosts", () => {
  it("returns 200 nulls WITHOUT calling the (YouTube-only) probe", async () => {
    for (const url of [
      "https://www.tiktok.com/@a/video/1",
      "https://www.instagram.com/reel/x",
      "https://x.com/a/status/1",
      "https://www.facebook.com/watch?v=1",
    ]) {
      const res = await post({ userId: TEST_USER_ID, url })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(NULLS)
    }
    // The probe validates against the NARROW YOUTUBE_HOSTS and would only ever
    // throw for these — so the route must short-circuit, never invoke it.
    expect(ytMetadataProbe).not.toHaveBeenCalled()
  })
})
