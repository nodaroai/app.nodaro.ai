import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — registered before module under test
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { generateCinematicAvatar } from "../cinematic.js"
import { HeygenError } from "../client.js"
import { cinematicUsdCost } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const CREATE_RESPONSE = {
  code: 0,
  message: "success",
  data: { video_id: "cine-1", status: "waiting" },
}

const STATUS_COMPLETED = {
  code: 0,
  message: "success",
  data: {
    id: "cine-1",
    status: "completed",
    video_url: "https://cdn.heygen.com/cine-1.mp4",
    duration: 10,
  },
}

const baseOpts = {
  prompt: "A cinematic city at night.",
  avatarLooks: ["look-1"],
  duration: 10,
  resolution: "720p" as const,
  aspectRatio: "16:9" as const,
  pollIntervalMs: 0,
}

/** Parse the JSON body sent to the first POST /v3/videos call. */
function postBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0]
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateCinematicAvatar — references", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does NOT include a references key when none are provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar(baseOpts)

    const body = postBody(fetchMock)
    expect(body).not.toHaveProperty("references")
  })

  it("omits references when an empty array is provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({ ...baseOpts, references: [] })

    const body = postBody(fetchMock)
    expect(body).not.toHaveProperty("references")
  })

  it("maps internal media-kind references to HeyGen's AssetUrl shape {type:'url', url}", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({
      ...baseOpts,
      references: [
        { type: "video", url: "https://r2.example.com/clip.mp4" },
        { type: "image", url: "https://r2.example.com/ref.png" },
        { type: "audio", url: "https://r2.example.com/voice.mp3" },
      ],
    })

    const body = postBody(fetchMock)
    // Every item is mapped to the source-format discriminated union AssetUrl
    // shape — the media kind is dropped (HeyGen infers it from the URL).
    expect(body.references).toEqual([
      { type: "url", url: "https://r2.example.com/clip.mp4" },
      { type: "url", url: "https://r2.example.com/ref.png" },
      { type: "url", url: "https://r2.example.com/voice.mp3" },
    ])
  })

  it("sends type:'cinematic_avatar' alongside references", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({
      ...baseOpts,
      references: [{ type: "video", url: "https://r2.example.com/clip.mp4" }],
    })

    const body = postBody(fetchMock)
    expect(body.type).toBe("cinematic_avatar")
    expect(body.references).toEqual([{ type: "url", url: "https://r2.example.com/clip.mp4" }])
  })
})

// ---------------------------------------------------------------------------
// autoDuration / duration body-shaping — the revenue-load-bearing behavior the
// round-1 reserve fix depends on. The reserve assumes that when autoDuration is
// on the provider sends `auto_duration:true` and DROPS `duration`; if a refactor
// regressed to sending `duration` alongside (or kept a stale duration), the
// 15s-ceiling reserve assumption would break and nothing would fail loudly.
// ---------------------------------------------------------------------------

describe("generateCinematicAvatar — duration body-shaping", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends auto_duration:true and OMITS duration when autoDuration is on (even with a stale duration opt)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({
      ...baseOpts,
      autoDuration: true,
      duration: 4, // stale value — MUST NOT be sent when auto_duration is on
    })

    const body = postBody(fetchMock)
    expect(body.auto_duration).toBe(true)
    expect(body).not.toHaveProperty("duration")
  })

  it("sends duration and NO auto_duration key when autoDuration is falsy", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({ ...baseOpts, autoDuration: false, duration: 12 })

    const body = postBody(fetchMock)
    expect(body.duration).toBe(12)
    expect(body).not.toHaveProperty("auto_duration")
  })

  it("sends enhance_prompt:true when enhancePrompt is true, and omits it when undefined", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))
    await generateCinematicAvatar({ ...baseOpts, enhancePrompt: true })
    expect(postBody(fetchMock).enhance_prompt).toBe(true)

    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))
    await generateCinematicAvatar(baseOpts) // enhancePrompt undefined
    expect(postBody(fetchMock)).not.toHaveProperty("enhance_prompt")
  })

  it("defaults aspect_ratio to 16:9 and resolution to 720p when not provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(STATUS_COMPLETED))

    await generateCinematicAvatar({
      prompt: "A clip.",
      avatarLooks: ["look-1"],
      pollIntervalMs: 0,
    })

    const body = postBody(fetchMock)
    expect(body.aspect_ratio).toBe("16:9")
    expect(body.resolution).toBe("720p")
  })
})

// ---------------------------------------------------------------------------
// Duration guard + cost + failure propagation. Mirrors video.test.ts for the
// avatar provider — a missing/zero duration would compute cost=0 (a free clip
// + full reservation refund), so the provider MUST throw instead.
// ---------------------------------------------------------------------------

describe("generateCinematicAvatar — duration guard, cost, failure", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("throws HeygenError when completed status is returned without a duration", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: {
            id: "cine-1",
            status: "completed",
            video_url: "https://cdn.heygen.com/cine-1.mp4",
            // duration intentionally omitted — must not give cost=0 (free video)
          },
        }),
      )

    await expect(generateCinematicAvatar(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.message === "HeyGen returned completed without a duration",
    )
  })

  it("throws HeygenError when completed status has duration=0", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: {
            id: "cine-1",
            status: "completed",
            video_url: "https://cdn.heygen.com/cine-1.mp4",
            duration: 0,
          },
        }),
      )

    await expect(generateCinematicAvatar(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.message === "HeyGen returned completed without a duration",
    )
  })

  it("returns metered cost === cinematicUsdCost(resolution, resultDuration)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: {
            id: "cine-1",
            status: "completed",
            video_url: "https://cdn.heygen.com/cine-1.mp4",
            duration: 10,
          },
        }),
      )

    const result = await generateCinematicAvatar(baseOpts)
    expect(result.cost).toBe(cinematicUsdCost("720p", 10))
    expect(result.meteredCost).toBe(true)
    expect(result.durationSec).toBe(10)
    expect(result.videoUrl).toBe("https://cdn.heygen.com/cine-1.mp4")
  })

  it("propagates a HeygenError on failed status", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: { id: "cine-1", status: "failed", error: "content policy violation" },
        }),
      )

    await expect(generateCinematicAvatar(baseOpts)).rejects.toSatisfy(
      (err: unknown) => err instanceof HeygenError && err.message === "content policy violation",
    )
  })
})
