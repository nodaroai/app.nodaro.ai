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

// Use dynamic imports inside tests so we can control module state across tests.
// We reset modules between describe blocks where cache isolation matters.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const avatarApiResponse = {
  code: 0,
  message: "success",
  data: [
    {
      id: "avatar-1",
      group_id: "group-a",
      avatar_type: "photo_avatar",
      name: "Alice",
      gender: "Female",
      preview_image_url: "https://cdn.example.com/alice.jpg",
      default_voice_id: "voice-abc",
      preferred_orientation: "portrait",
      supported_api_engines: ["avatar_iv", "avatar_v"],
    },
    {
      id: "avatar-2",
      group_id: "group-b",
      avatar_type: "studio_avatar",    // <-- should be filtered OUT
      name: "Studio Bob",
      gender: "Male",
      preview_image_url: "https://cdn.example.com/bob.jpg",
    },
    {
      id: "avatar-3",
      group_id: "group-a",
      avatar_type: "photo_avatar",
      name: "Carol",
      gender: "unknown",
      preview_image_url: "https://cdn.example.com/carol.jpg",
      // no supported_api_engines — should map to undefined
    },
  ],
}

const voicesApiResponse = {
  code: 0,
  message: "success",
  data: {
    voices: [
      {
        voice_id: "v1",
        name: "English Male",
        language: "en",
        gender: "Male",
        preview_audio: "https://cdn.example.com/v1.mp3",
        support_pause: true,
        emotion_support: false,
        support_locale: true,
      },
      {
        voice_id: "v2",
        name: "Spanish Female",
        language: "es",
        gender: "FEMALE",
        preview_audio: "https://cdn.example.com/v2.mp3",
        support_pause: false,
        emotion_support: true,
        support_locale: false,
      },
      {
        voice_id: "v3",
        name: "Neutral",
        language: "en",
        gender: "unknown",
        preview_audio: "",
        support_pause: false,
        emotion_support: false,
        support_locale: false,
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Avatar tests
// ---------------------------------------------------------------------------

describe("listAvatars", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("filters out non-photo_avatar entries and maps fields correctly", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(avatarApiResponse))

    const { listAvatars } = await import("../catalog.js")
    const avatars = await listAvatars()

    // studio_avatar should be excluded
    expect(avatars).toHaveLength(2)

    const alice = avatars.find((a) => a.avatarId === "avatar-1")
    expect(alice).toBeDefined()
    expect(alice?.name).toBe("Alice")
    expect(alice?.gender).toBe("female")        // normalized from "Female"
    expect(alice?.previewImageUrl).toBe("https://cdn.example.com/alice.jpg")
    expect(alice?.defaultVoiceId).toBe("voice-abc")
    expect(alice?.preferredOrientation).toBe("portrait")
    expect(alice?.groupId).toBe("group-a")
    // supported_api_engines maps to supportedEngines
    expect(alice?.supportedEngines).toEqual(["avatar_iv", "avatar_v"])

    const carol = avatars.find((a) => a.avatarId === "avatar-3")
    expect(carol).toBeDefined()
    expect(carol?.gender).toBe("unknown")
    // avatar with no supported_api_engines maps to undefined
    expect(carol?.supportedEngines).toBeUndefined()
  })

  it("paginates across multiple pages, accumulating all photo_avatar results", async () => {
    const page1 = {
      code: 0,
      message: "success",
      data: [
        {
          id: "avatar-p1",
          avatar_type: "photo_avatar",
          name: "Page1",
          gender: "Male",
          preview_image_url: "https://cdn.example.com/p1.jpg",
          supported_api_engines: ["avatar_iv"],
        },
      ],
      next_token: "cursor-abc",
      has_more: true,
    }
    const page2 = {
      code: 0,
      message: "success",
      data: [
        {
          id: "avatar-p2",
          avatar_type: "photo_avatar",
          name: "Page2",
          gender: "Female",
          preview_image_url: "https://cdn.example.com/p2.jpg",
        },
      ],
      // no next_token → last page
    }

    fetchMock
      .mockResolvedValueOnce(makeResponse(page1))
      .mockResolvedValueOnce(makeResponse(page2))

    const { listAvatars } = await import("../catalog.js")
    const avatars = await listAvatars()

    expect(avatars).toHaveLength(2)
    expect(avatars.find((a) => a.avatarId === "avatar-p1")?.supportedEngines).toEqual(["avatar_iv"])
    expect(avatars.find((a) => a.avatarId === "avatar-p2")).toBeDefined()

    // First call: no token param; second call: token=cursor-abc
    const avatarCalls = fetchMock.mock.calls.filter((args) =>
      (args[0] as string).includes("/v3/avatars/looks"),
    )
    expect(avatarCalls).toHaveLength(2)
    expect(avatarCalls[1][0] as string).toContain("token=cursor-abc")
  })

  it("stops paginating when has_more is false even if a cursor is present", async () => {
    const singlePage = {
      code: 0,
      message: "success",
      data: [
        {
          id: "avatar-only",
          avatar_type: "photo_avatar",
          name: "Only",
          gender: "unknown",
          preview_image_url: "https://cdn.example.com/only.jpg",
        },
      ],
      token: "some-cursor",
      has_more: false,  // explicit false — stop despite having a cursor
    }

    fetchMock.mockResolvedValueOnce(makeResponse(singlePage))

    const { listAvatars } = await import("../catalog.js")
    const avatars = await listAvatars()

    expect(avatars).toHaveLength(1)
    const avatarCalls = fetchMock.mock.calls.filter((args) =>
      (args[0] as string).includes("/v3/avatars/looks"),
    )
    expect(avatarCalls).toHaveLength(1)
  })

  it("second call within TTL reuses cache without re-fetching", async () => {
    fetchMock.mockResolvedValue(makeResponse(avatarApiResponse))

    const { listAvatars } = await import("../catalog.js")

    await listAvatars()
    await listAvatars()

    // fetch should only have been called once (avatar endpoint + any client calls)
    // The key assertion is that the avatar endpoint is only hit once
    const avatarCalls = fetchMock.mock.calls.filter((args) =>
      (args[0] as string).includes("/v3/avatars/looks"),
    )
    expect(avatarCalls).toHaveLength(1)
  })

  it("handles empty data array gracefully", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ code: 0, message: "success", data: [] }),
    )

    const { listAvatars } = await import("../catalog.js")
    const avatars = await listAvatars()
    expect(avatars).toEqual([])
  })
})

describe("listAvatars — unconfigured key", () => {
  beforeEach(async () => {
    vi.resetModules()
    // Override mock to simulate missing API key
    vi.doMock("@/lib/config.js", () => ({
      config: { HEYGEN_API_KEY: "", NODE_ENV: "test" },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns empty array when HEYGEN_API_KEY is not set", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { listAvatars } = await import("../catalog.js")
    const avatars = await listAvatars()

    expect(avatars).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Voice tests
// ---------------------------------------------------------------------------

describe("listVoices", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    // Restore the key mock for voice tests
    vi.doMock("@/lib/config.js", () => ({
      config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" },
    }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("normalizes gender to lowercase ('Male' → 'male', 'FEMALE' → 'female')", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(voicesApiResponse))

    const { listVoices } = await import("../catalog.js")
    const voices = await listVoices()

    expect(voices).toHaveLength(3)
    const v1 = voices.find((v) => v.voiceId === "v1")
    expect(v1?.gender).toBe("male")       // from "Male"

    const v2 = voices.find((v) => v.voiceId === "v2")
    expect(v2?.gender).toBe("female")     // from "FEMALE"

    const v3 = voices.find((v) => v.voiceId === "v3")
    expect(v3?.gender).toBe("unknown")    // unchanged
  })

  it("maps preview_audio (not preview_audio_url) to previewAudio", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(voicesApiResponse))

    const { listVoices } = await import("../catalog.js")
    const voices = await listVoices()

    const v1 = voices.find((v) => v.voiceId === "v1")
    expect(v1?.previewAudio).toBe("https://cdn.example.com/v1.mp3")
  })

  it("maps support_pause, emotion_support, support_locale fields", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(voicesApiResponse))

    const { listVoices } = await import("../catalog.js")
    const voices = await listVoices()

    const v1 = voices.find((v) => v.voiceId === "v1")
    expect(v1?.supportPause).toBe(true)
    expect(v1?.emotionSupport).toBe(false)
    expect(v1?.supportLocale).toBe(true)

    const v2 = voices.find((v) => v.voiceId === "v2")
    expect(v2?.supportPause).toBe(false)
    expect(v2?.emotionSupport).toBe(true)
    expect(v2?.supportLocale).toBe(false)
  })

  it("second call within TTL reuses cache without re-fetching", async () => {
    fetchMock.mockResolvedValue(makeResponse(voicesApiResponse))

    const { listVoices } = await import("../catalog.js")
    await listVoices()
    await listVoices()

    const voiceCalls = fetchMock.mock.calls.filter((args) =>
      (args[0] as string).includes("/v2/voices"),
    )
    expect(voiceCalls).toHaveLength(1)
  })
})

describe("listVoices — unconfigured key", () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { HEYGEN_API_KEY: "", NODE_ENV: "test" },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns empty array when HEYGEN_API_KEY is not set", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { listVoices } = await import("../catalog.js")
    const voices = await listVoices()

    expect(voices).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
