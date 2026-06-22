import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client (no auth needed, but apiJson always calls getSession)
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { voiceChangerProApi } from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// voiceChangerProApi
// ---------------------------------------------------------------------------

describe("voiceChangerProApi", () => {
  it("posts videoUrl + ordered voiceIds, omitting absent optionals", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const res = await voiceChangerProApi(
      undefined,
      [{ voiceId: "vA" }, { voiceId: "vB" }],
      "u1",
      undefined,
      true,
      undefined,
      "https://r2/v.mp4",
    )

    expect(res).toEqual({ jobId: "j1" })

    expect(mock).toHaveBeenCalledWith(
      "/v1/voice-changer-pro",
      expect.objectContaining({ method: "POST" }),
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      orderedVoices: [{ voiceId: "vA" }, { voiceId: "vB" }],
      videoUrl: "https://r2/v.mp4",
      userId: "u1",
      preserveBackground: true,
    })
  })

  it("posts audioUrl when no videoUrl, omitting absent optionals", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    const res = await voiceChangerProApi("https://r2/a.mp3", [{ voiceId: "vC" }])

    expect(res).toEqual({ jobId: "j2" })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      orderedVoices: [{ voiceId: "vC" }],
      audioUrl: "https://r2/a.mp3",
    })
  })

  it("passes per-voice settings through as-is", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jp" })
    vi.stubGlobal("fetch", mock)

    await voiceChangerProApi("https://r2/a.mp3", [
      { voiceId: "vA", stability: 0.8, similarityBoost: 0.6, style: 0.3, useSpeakerBoost: false, volume: 150 },
      { voiceId: "vB" },
    ])

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.orderedVoices).toEqual([
      { voiceId: "vA", stability: 0.8, similarityBoost: 0.6, style: 0.3, useSpeakerBoost: false, volume: 150 },
      { voiceId: "vB" },
    ])
  })

  it("includes all optional fields when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await voiceChangerProApi(
      "https://r2/a.mp3",
      [{ voiceId: "vA" }],
      "u2",
      "eleven_multilingual_v2",
      false,
      true,
      "https://r2/v.mp4",
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      orderedVoices: [{ voiceId: "vA" }],
      audioUrl: "https://r2/a.mp3",
      videoUrl: "https://r2/v.mp4",
      userId: "u2",
      model: "eleven_multilingual_v2",
      preserveBackground: false,
      removeBackgroundNoise: true,
    })
  })

  it("passes per-voice seed through as-is (including 0)", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "js" })
    vi.stubGlobal("fetch", mock)

    await voiceChangerProApi("https://r2/a.mp3", [
      { voiceId: "vA", seed: 0 },
      { voiceId: "vB", seed: 4242 },
      { voiceId: "vC" },
    ])

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.orderedVoices).toEqual([
      { voiceId: "vA", seed: 0 },
      { voiceId: "vB", seed: 4242 },
      { voiceId: "vC" },
    ])
  })

  it("includes voiceFx when provided and omits it otherwise", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jfx" })
    vi.stubGlobal("fetch", mock)

    await voiceChangerProApi(
      "https://r2/a.mp3",
      [{ voiceId: "vA" }],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { preset: "hall", wetDryMix: 60 },
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.voiceFx).toEqual({ preset: "hall", wetDryMix: 60 })

    // Second call with no voiceFx → key omitted entirely.
    const mock2 = mockFetchJson({ jobId: "jno" })
    vi.stubGlobal("fetch", mock2)
    await voiceChangerProApi("https://r2/a.mp3", [{ voiceId: "vA" }])
    const body2 = JSON.parse(mock2.mock.calls[0][1].body as string)
    expect("voiceFx" in body2).toBe(false)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: "Voice recast failed" } }),
        text: () => Promise.resolve(JSON.stringify({ error: { message: "Voice recast failed" } })),
      }),
    )

    await expect(voiceChangerProApi(undefined, [{ voiceId: "vA" }])).rejects.toThrow(
      "Voice recast failed",
    )
  })
})
