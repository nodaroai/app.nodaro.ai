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
