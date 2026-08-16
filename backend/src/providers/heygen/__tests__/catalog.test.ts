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

// ---------------------------------------------------------------------------
// Progressive snapshots — nobody waits for the whole paginated fill
// ---------------------------------------------------------------------------

describe("snapshotAvatars — progressive fill", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  /** A page of one photo_avatar look; `next` sets the cursor to the next page. */
  function page(id: string, next?: string) {
    return {
      code: 0,
      message: "success",
      data: [{ id, avatar_type: "photo_avatar", name: id, gender: "Female", preview_image_url: `https://cdn.example.com/${id}.jpg` }],
      ...(next ? { next_token: next, has_more: true } : {}),
    }
  }

  /** A fetch that hands back a page only when the test releases it. */
  function gate() {
    let release!: () => void
    const opened = new Promise<void>((r) => { release = r })
    return { opened, release }
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" },
    }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("answers with the first page (complete:false) while later pages are still loading, then the whole list", async () => {
    const page2 = gate()
    fetchMock
      .mockResolvedValueOnce(makeResponse(page("look-1", "cursor-2")))
      .mockImplementationOnce(async () => { await page2.opened; return makeResponse(page("look-2")) })

    const { snapshotAvatars } = await import("../catalog.js")

    const first = await snapshotAvatars()
    expect(first.complete).toBe(false)
    expect(first.items.map((a) => a.avatarId)).toEqual(["look-1"])

    // Still filling — a second caller gets the same partial answer at once (no new fetch).
    const again = await snapshotAvatars()
    expect(again).toEqual(first)
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/v3/avatars/looks"))).toHaveLength(2)

    page2.release()
    await new Promise((r) => setTimeout(r, 0))
    const done = await snapshotAvatars()
    expect(done.complete).toBe(true)
    expect(done.items.map((a) => a.avatarId)).toEqual(["look-1", "look-2"])
  })

  it("serves a stale complete list immediately and refreshes it in the background", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(makeResponse(page("old-look")))
    const { snapshotAvatars } = await import("../catalog.js")
    expect((await snapshotAvatars()).items.map((a) => a.avatarId)).toEqual(["old-look"])

    // Past the TTL: the old list comes back at once (complete), and a refresh starts.
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    const refreshGate = gate()
    fetchMock.mockImplementationOnce(async () => { await refreshGate.opened; return makeResponse(page("new-look")) })
    const stale = await snapshotAvatars()
    expect(stale.complete).toBe(true)
    expect(stale.items.map((a) => a.avatarId)).toEqual(["old-look"])
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/v3/avatars/looks"))).toHaveLength(2)

    refreshGate.release()
    await vi.advanceTimersByTimeAsync(0)
    const fresh = await snapshotAvatars()
    expect(fresh.items.map((a) => a.avatarId)).toEqual(["new-look"])
    expect(fresh.complete).toBe(true)
  })

  it("keeps the pages it has when a later page fails, and RESUMES from that cursor after the back-off", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(makeResponse(page("look-1", "cursor-2")))
      .mockRejectedValueOnce(new Error("HeyGen 502"))
    const { snapshotAvatars } = await import("../catalog.js")

    const first = await snapshotAvatars()
    expect(first.items.map((a) => a.avatarId)).toEqual(["look-1"])
    expect(first.complete).toBe(false)
    await vi.advanceTimersByTimeAsync(0) // let the failing page settle

    // Inside the back-off: still the same partial answer, and no retry yet.
    const during = await snapshotAvatars()
    expect(during).toMatchObject({ items: first.items, complete: false })
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/v3/avatars/looks"))).toHaveLength(2)

    // After the back-off the next request resumes from cursor-2 — not from page one.
    vi.setSystemTime(Date.now() + 11_000)
    fetchMock.mockResolvedValueOnce(makeResponse(page("look-2")))
    await snapshotAvatars()
    await vi.advanceTimersByTimeAsync(0)
    const calls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/v3/avatars/looks"))
    expect(calls).toHaveLength(3)
    expect(calls[2][0] as string).toContain("token=cursor-2")
    const done = await snapshotAvatars()
    expect(done.complete).toBe(true)
    expect(done.items.map((a) => a.avatarId)).toEqual(["look-1", "look-2"])
  })

  it("a fill that fails before its first page answers empty + complete:false and never hangs the caller", async () => {
    fetchMock.mockRejectedValueOnce(new Error("HeyGen down"))
    const { snapshotAvatars } = await import("../catalog.js")
    const res = await snapshotAvatars()
    expect(res).toMatchObject({ items: [], complete: false })
  })

  it("is complete + empty on an unconfigured install (nothing to wait for)", async () => {
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "", NODE_ENV: "test" } }))
    const { snapshotAvatars, snapshotVoices } = await import("../catalog.js")
    expect(await snapshotAvatars()).toMatchObject({ items: [], complete: true })
    expect(await snapshotVoices()).toMatchObject({ items: [], complete: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("listAvatars (the full-list API) still waits for every page", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(page("look-1", "cursor-2")))
      .mockResolvedValueOnce(makeResponse(page("look-2")))
    const { listAvatars, snapshotAvatars } = await import("../catalog.js")
    const all = await listAvatars()
    expect(all.map((a) => a.avatarId)).toEqual(["look-1", "look-2"])
    expect(await snapshotAvatars()).toMatchObject({ items: all, complete: true, offset: 0, total: 2 })
  })
})

// ---------------------------------------------------------------------------
// Delta answers — a client that holds part of a generation gets only the rest
// ---------------------------------------------------------------------------

describe("snapshotAvatars — offset / generation deltas", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  function page(id: string, next?: string) {
    return {
      code: 0,
      message: "success",
      data: [{ id, avatar_type: "photo_avatar", name: id, gender: "Female", preview_image_url: `https://cdn.example.com/${id}.jpg` }],
      ...(next ? { next_token: next, has_more: true } : {}),
    }
  }
  function gate() {
    let release!: () => void
    const opened = new Promise<void>((r) => { release = r })
    return { opened, release }
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" } }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("answers only the items after the caller's offset when the generation matches, and everything otherwise", async () => {
    const page2 = gate()
    fetchMock
      .mockResolvedValueOnce(makeResponse(page("look-1", "cursor-2")))
      .mockImplementationOnce(async () => { await page2.opened; return makeResponse(page("look-2")) })
    const { snapshotAvatars } = await import("../catalog.js")

    const first = await snapshotAvatars()
    expect(first).toMatchObject({ offset: 0, total: 1, complete: false })
    expect(first.generation).toEqual(expect.any(String))
    expect(first.generation).not.toBe("none")

    page2.release()
    await new Promise((r) => setTimeout(r, 0))

    // Same generation, holding 1 → just the tail.
    const tail = await snapshotAvatars({ offset: 1, generation: first.generation })
    expect(tail).toEqual({ items: [expect.objectContaining({ avatarId: "look-2" })], offset: 1, total: 2, complete: true, generation: first.generation })
    // Caught up → an empty delta, still complete.
    expect(await snapshotAvatars({ offset: 2, generation: first.generation })).toMatchObject({ items: [], offset: 2, total: 2, complete: true })
    // Wrong generation (another server, an older fill) → the whole list from zero.
    const whole = await snapshotAvatars({ offset: 1, generation: "stale-gen" })
    expect(whole).toMatchObject({ offset: 0, total: 2 })
    expect(whole.items.map((a) => a.avatarId)).toEqual(["look-1", "look-2"])
    // An offset past what is known → from zero as well (never a negative slice).
    expect(await snapshotAvatars({ offset: 99, generation: first.generation })).toMatchObject({ offset: 0, total: 2 })
  })

  it("a background refresh gets a NEW generation, so a client holding the old list is re-sent from zero", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(makeResponse(page("old-look")))
    const { snapshotAvatars } = await import("../catalog.js")
    const g1 = (await snapshotAvatars()).generation

    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    fetchMock.mockResolvedValueOnce(makeResponse(page("new-look")))
    await snapshotAvatars() // serves stale g1, kicks the refresh
    await vi.advanceTimersByTimeAsync(0)
    const fresh = await snapshotAvatars({ offset: 1, generation: g1 })
    expect(fresh.generation).not.toBe(g1)
    expect(fresh).toMatchObject({ offset: 0, total: 1, complete: true })
    expect(fresh.items.map((a) => a.avatarId)).toEqual(["new-look"])
  })

  it("warmHeygenCatalog starts both fills in the background without waiting, and is a no-op without a key", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      makeResponse((url as string).includes("/v3/avatars/looks") ? page("look-1") : voicesApiResponse),
    )
    const { warmHeygenCatalog, snapshotAvatars, snapshotVoices } = await import("../catalog.js")
    warmHeygenCatalog()
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/v3/avatars/looks"))).toBe(true)
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/v2/voices"))).toBe(true)
    expect((await snapshotAvatars()).complete).toBe(true)
    expect((await snapshotVoices()).total).toBe(3)

    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "", NODE_ENV: "test" } }))
    fetchMock.mockClear()
    const keyless = await import("../catalog.js")
    keyless.warmHeygenCatalog()
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("the safety cap is far above HeyGen's real ≈460 pages (the old 50 silently cut the catalog to 1,000 looks)", async () => {
    // 60 pages, each with a cursor → the old cap would have stopped at 50.
    let served = 0
    fetchMock.mockImplementation(async () => {
      served++
      return makeResponse(page(`look-${served}`, served < 60 ? `cursor-${served + 1}` : undefined))
    })
    const { listAvatars } = await import("../catalog.js")
    const all = await listAvatars()
    expect(all).toHaveLength(60)
  })
})

describe("fetch shape — what we ask HeyGen for", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" } }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("asks /v3/avatars/looks for photo avatars only, 50 per page, and threads the cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({ code: 0, message: "ok", data: [], next_token: "c2", has_more: true }))
      .mockResolvedValueOnce(makeResponse({ code: 0, message: "ok", data: [] }))
    const { listAvatars } = await import("../catalog.js")
    await listAvatars()
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])))
    expect(urls).toHaveLength(2)
    for (const u of urls) {
      expect(u.pathname).toBe("/v3/avatars/looks")
      expect(u.searchParams.get("avatar_type")).toBe("photo_avatar")
      expect(u.searchParams.get("limit")).toBe("50") // HeyGen's documented maximum; the default is 20
    }
    expect(urls[0].searchParams.get("token")).toBeNull()
    expect(urls[1].searchParams.get("token")).toBe("c2")
  })
})
