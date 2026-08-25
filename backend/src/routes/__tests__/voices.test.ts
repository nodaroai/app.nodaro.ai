import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Characterization tests for the voice CATALOG routes:
//   GET /v1/voices          — full premade catalog (single upstream page of 100)
//   GET /v1/voices/library  — paginated shared/community voices
//
// These lock the wire contract the platform voice picker AND the VCP client
// consume, especially the paged form of /v1/voices/library (page / page_size /
// hasMore) and its no-param defaults. The route is a thin passthrough to
// ElevenLabs, so we mock global fetch and assert on the outgoing URL.
//
// The route module holds module-level caches (premade 6h TTL; shared 5-min TTL),
// so each test re-imports it via vi.resetModules() to start from a cold cache.
// The ElevenLabs key is read live from a getter backed by `cfgState`, so a test
// can flip it to "" to exercise the no-key branch.
// ---------------------------------------------------------------------------

// `business` gates the B4c voice-gender surface profile: surface-profile.ts's
// surfaceGateOpen() calls isBusiness()/isCloud() (imported from this same
// config module), reached now that /v1/voices filters by allowedGenders.
// Default false → the surface profile is the stock default (unrestricted), so
// every pre-existing test is byte-identical; a filter test flips it to true.
const cfgState = { key: "test-eleven-key" as string, business: false }

vi.mock("@/lib/config.js", () => ({
  config: {
    get ELEVENLABS_API_KEY() {
      return cfgState.key
    },
    // The route builds its URLs from ELEVENLABS_BASE_URL; without it the
    // fetches under test are issued against "undefined/v2/voices".
    ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  },
  isBusiness: () => cfgState.business,
  isCloud: () => false,
}))

// The premade path registers a voice-id→name lookup as a side effect; stub it.
vi.mock("@/providers/kie/audio.js", () => ({
  registerVoiceLookup: vi.fn(),
}))

let app: FastifyInstance
let fetchMock: ReturnType<typeof vi.fn>

/** Build a Response-like object matching what the route reads (`ok`, `status`, `json`). */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Return the URL string of the Nth fetch call. */
function fetchUrl(n = 0): string {
  return String(fetchMock.mock.calls[n]?.[0] ?? "")
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  cfgState.key = "test-eleven-key"
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)

  const { voicesRoutes } = await import("../voices.js")
  app = Fastify({ logger: false })
  await app.register(async (instance) => {
    await voicesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/voices — full premade catalog
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /v1/voices", () => {
  it("returns the full premade list and maps ElevenLabs labels", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        voices: [
          {
            voice_id: "v-1",
            name: "Aria",
            preview_url: "https://cdn/aria.mp3",
            labels: { gender: "female", accent: "American", age: "young" },
            category: "premade",
          },
          {
            voice_id: "v-2",
            name: "Bill",
            preview_url: "https://cdn/bill.mp3",
            labels: { gender: "male", accent: "American", age: "old" },
            category: "premade",
          },
        ],
      }),
    )

    const res = await app.inject({ method: "GET", url: "/v1/voices" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { voices: Array<Record<string, string>> }
    expect(body.voices).toHaveLength(2)
    expect(body.voices[0]).toMatchObject({ voice_id: "v-1", name: "Aria", gender: "female", accent: "American", age: "young" })
    // Upstream call fetches a single page of up to 100 premade voices.
    expect(fetchUrl()).toContain("category=premade")
    expect(fetchUrl()).toContain("page_size=100")
  })

  it("falls back to the static catalog (no fetch) when the API key is absent — and SAYS so (#647)", async () => {
    cfgState.key = ""
    const res = await app.inject({ method: "GET", url: "/v1/voices" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { voices: unknown[]; keyMissing?: boolean; hint?: string }
    expect(body.voices.length).toBeGreaterThan(0) // static FALLBACK_VOICES — still usable for TTS via the connection
    expect(fetchMock).not.toHaveBeenCalled()
    // The honest half: the response admits the list is the keyless fallback,
    // with the shared phrasing (names the key, points at the keys screen, and
    // — on an install that is NOT connected — offers nodaro.ai as the other
    // way to generate; #863).
    expect(body.keyMissing).toBe(true)
    expect(body.hint).toContain("ELEVENLABS_API_KEY")
    expect(body.hint).toContain("Integrations → Model providers")
    expect(body.hint).toContain("connect nodaro.ai")
    expect(body.hint!.length).toBeLessThanOrEqual(200)
    // A cached "key missing" notice must not survive the key being added.
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("an install already connected to nodaro.ai is not told to connect again (#863)", async () => {
    cfgState.key = ""
    // Same module generation as the route (vi.resetModules ran in beforeEach),
    // so this is the cache the route's hint reads.
    const { rememberNodaroConnected, _resetNodaroConnectedCacheForTests } = await import("@/lib/nodaro-connect-cache.js")
    try {
      rememberNodaroConnected(true)
      const res = await app.inject({ method: "GET", url: "/v1/voices" })
      const body = res.json() as { keyMissing?: boolean; hint?: string }
      expect(body.keyMissing).toBe(true)
      expect(body.hint).toContain("nodaro.ai connection")
      expect(body.hint).not.toContain("connect nodaro.ai")
      expect(body.hint).toContain("ELEVENLABS_API_KEY")
      expect(body.hint).toContain("Integrations → Model providers")
      expect(body.hint!.length).toBeLessThanOrEqual(200)

      // A known-disconnected install gets the offer, same as an unknown one.
      rememberNodaroConnected(false)
      const again = (await app.inject({ method: "GET", url: "/v1/voices" })).json() as { hint?: string }
      expect(again.hint).toContain("connect nodaro.ai")
      expect(again.hint).not.toContain("nodaro.ai connection")
    } finally {
      _resetNodaroConnectedCacheForTests()
    }
  })

  it("the keyless fallback can be auditioned: every current premade voice ships a public preview + description (#862)", async () => {
    cfgState.key = ""
    const res = await app.inject({ method: "GET", url: "/v1/voices" })
    const body = res.json() as { voices: Array<{ voice_id: string; name: string; preview_url: string; description: string }> }
    // Every entry describes itself — a label-less row is the "picker is just
    // poor" impression all over again.
    expect(body.voices.filter((v) => !v.description).map((v) => v.name)).toEqual([])
    // ElevenLabs retired these three from its catalog — nothing public to
    // play. Kept in the list only because stored node data names them. A new
    // preview-less entry must be a deliberate addition here, never an accident.
    const RETIRED_UPSTREAM = new Set(["Aria", "Charlotte", "Rachel"])
    const { resolveDirectVoiceId } = await import("@/providers/elevenlabs/direct-tts.js")
    for (const v of body.voices) {
      if (RETIRED_UPSTREAM.has(v.name)) continue
      // Public CDN objects, not the keyed /previews/audio endpoint (those URLs
      // carry a payload token) — and each one is THIS voice's object, keyed by
      // its ElevenLabs UUID, so a copy-paste swap cannot pass.
      expect(v.preview_url).toMatch(/^https:\/\/storage\.googleapis\.com\/eleven-public-prod\/premade\/voices\//)
      expect(v.preview_url).toContain(`/voices/${resolveDirectVoiceId(v.voice_id)}/`)
    }
    expect(body.voices.filter((v) => RETIRED_UPSTREAM.has(v.name)).every((v) => v.preview_url === "")).toBe(true)
    expect(body.voices.filter((v) => RETIRED_UPSTREAM.has(v.name))).toHaveLength(RETIRED_UPSTREAM.size)
  })

  it("does NOT carry the keyless marker when a key is configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [] }))
    const res = await app.inject({ method: "GET", url: "/v1/voices" })
    const body = res.json() as { keyMissing?: boolean; hint?: string }
    expect(body.keyMissing).toBeUndefined()
    expect(body.hint).toBeUndefined()
  })

  it("filters the catalog to the surface profile's allowed voice genders (B4c)", async () => {
    // Business edition + a male-only lock → the premade catalog drops every
    // non-male voice. Keyless path so the FALLBACK_VOICES catalog is served
    // deterministically. Surface module is fresh per test (vi.resetModules),
    // so setting the env before the request is enough.
    cfgState.key = ""
    cfgState.business = true
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
    try {
      const res = await app.inject({ method: "GET", url: "/v1/voices" })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { voices: Array<{ name: string; gender: string }> }
      expect(body.voices.length).toBeGreaterThan(0)
      expect(body.voices.every((v) => v.gender === "male")).toBe(true)
      expect(body.voices.some((v) => v.name === "Rachel")).toBe(false)
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/voices/library — paginated shared voices
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /v1/voices/library", () => {
  it("no-param request defaults to page=0 & page_size=30 and returns { voices, hasMore }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        voices: [{ voice_id: "lib-1", name: "Nova", preview_url: "", gender: "female" }],
        has_more: true,
      }),
    )

    const res = await app.inject({ method: "GET", url: "/v1/voices/library" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { voices: Array<Record<string, unknown>>; hasMore: boolean }

    // Backward-compat: no-param behavior — defaults baked into the upstream call.
    expect(fetchUrl()).toContain("page=0")
    expect(fetchUrl()).toContain("page_size=30")

    expect(body.hasMore).toBe(true)
    expect(body.voices).toHaveLength(1)
    expect(body.voices[0]).toMatchObject({ voice_id: "lib-1", name: "Nova" })
  })

  it("passes page and page_size straight through to ElevenLabs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [], has_more: false }))

    await app.inject({ method: "GET", url: "/v1/voices/library?page=2&page_size=50" })
    expect(fetchUrl()).toContain("page=2")
    expect(fetchUrl()).toContain("page_size=50")
  })

  it("clamps page_size above 100 down to 100", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [], has_more: false }))

    await app.inject({ method: "GET", url: "/v1/voices/library?page=1&page_size=999" })
    expect(fetchUrl()).toContain("page_size=100")
    expect(fetchUrl()).not.toContain("page_size=999")
  })

  it("clamps a negative page_size up to the floor of 1", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [], has_more: false }))

    await app.inject({ method: "GET", url: "/v1/voices/library?page_size=-5" })
    expect(fetchUrl()).toContain("page_size=1")
  })

  it("treats page_size=0 as unset and falls back to the default 30", async () => {
    // Quirk worth locking: `parseInt('0') || 30` collapses 0 to the default,
    // so page_size=0 does NOT reach the Math.max(1, …) floor.
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [], has_more: false }))

    await app.inject({ method: "GET", url: "/v1/voices/library?page_size=0" })
    expect(fetchUrl()).toContain("page_size=30")
  })

  it("forwards the search + filter params for server-side filtering", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [], has_more: false }))

    await app.inject({
      method: "GET",
      url: "/v1/voices/library?search=warm%20narrator&gender=female&accent=british",
    })
    const url = fetchUrl()
    expect(url).toContain("search=warm")
    expect(url).toContain("gender=female")
    expect(url).toContain("accent=british")
  })

  it("maps upstream has_more:false to hasMore:false (last page)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ voices: [{ voice_id: "lib-9", name: "Last" }], has_more: false }),
    )

    const res = await app.inject({ method: "GET", url: "/v1/voices/library?page=3" })
    const body = res.json() as { hasMore: boolean }
    expect(body.hasMore).toBe(false)
  })

  it("returns an empty page when the API key is absent — and SAYS so (#647)", async () => {
    cfgState.key = ""
    const res = await app.inject({ method: "GET", url: "/v1/voices/library" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { voices: unknown[]; hasMore: boolean; keyMissing?: boolean; hint?: string }
    expect(body.voices).toEqual([])
    expect(body.hasMore).toBe(false)
    expect(body.keyMissing).toBe(true)
    expect(body.hint).toContain("ELEVENLABS_API_KEY")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns an empty page (not a 500) when ElevenLabs errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 502))
    const res = await app.inject({ method: "GET", url: "/v1/voices/library?page=7" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: [], hasMore: false })
  })
})
