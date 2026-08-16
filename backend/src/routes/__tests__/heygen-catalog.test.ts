import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// Mock the catalog module so tests never hit the network.
// Each test can override these with vi.mocked(...).mockResolvedValueOnce(...).
vi.mock("@/providers/heygen/catalog.js", () => ({
  snapshotAvatars: vi.fn().mockResolvedValue({ items: [], offset: 0, total: 0, complete: true, generation: "g1" }),
  snapshotPrivateAvatars: vi.fn().mockResolvedValue([]),
  snapshotVoices: vi.fn().mockResolvedValue({ items: [], offset: 0, total: 0, complete: true, generation: "g1" }),
  refreshHeygenCatalog: vi.fn().mockResolvedValue({ avatars: "started", privateAvatars: "started", voices: "started" }),
}))

// The manual-refresh gate: signed in, first-party, admin where the edition
// has admins (same shape as the provider-key routes' tests).
const gate = vi.hoisted(() => ({ isAdmin: vi.fn(async () => false), edition: { hasAdmin: false } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: gate.isAdmin }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "community", HEYGEN_API_KEY: undefined },
  hasAdmin: () => gate.edition.hasAdmin,
  isCloud: () => false,
  isCommunity: () => !gate.edition.hasAdmin,
}))

// The connection relay: a keyless CONNECTED install lists what the cloud can
// render (its avatar jobs run there). Default: keyed / not connected → the
// local catalog functions answer as before.
const cloudMocks = vi.hoisted(() => ({ shouldRunOnCloud: vi.fn(async () => false) }))
vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("@/lib/nodaro-connect.js", () => ({ nodaroCloudBase: () => "https://cloud.test" }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { heygenCatalogRoutes, _resetCloudHeygenCatalogForTests } from "../heygen-catalog.js"
import { refreshHeygenCatalog, snapshotAvatars, snapshotPrivateAvatars, snapshotVoices } from "../../providers/heygen/catalog.js"

/** A whole-list answer from the catalog module (generation "g1"). */
const whole = <T,>(items: T[]) => ({ items, offset: 0, total: items.length, complete: true, generation: "g1" })
/** A partial (still filling) answer from the catalog module. */
const partial = <T,>(items: T[], offset = 0) => ({ items, offset, total: offset + items.length, complete: false, generation: "g1" })

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

/** What the auth hook would leave on the request for the refresh route. */
let caller: { userId?: string; apiToken?: boolean; appAuthorization?: boolean } = {}

beforeEach(async () => {
  vi.clearAllMocks()
  cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
  gate.isAdmin.mockReset().mockResolvedValue(false)
  gate.edition.hasAdmin = false
  caller = {}
  _resetCloudHeygenCatalogForTests()

  app = Fastify({ logger: false })

  // The catalog routes are public (no userId needed); the refresh route reads
  // whatever the auth hook left — stand in for it here.
  app.addHook("preHandler", async (req) => {
    const r = req as typeof req & { userId?: string; apiToken?: unknown; appAuthorization?: unknown }
    r.userId = caller.userId
    if (caller.apiToken) r.apiToken = { id: "tok" } as never
    if (caller.appAuthorization) r.appAuthorization = { appId: "app", scopes: [] } as never
  })
  await app.register(async (instance) => {
    await heygenCatalogRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const mockAvatars = [
  {
    avatarId: "avatar-1",
    groupId: "group-a",
    name: "Alice",
    gender: "female",
    previewImageUrl: "https://cdn.example.com/alice.jpg",
    defaultVoiceId: "voice-abc",
    preferredOrientation: "portrait",
  },
  {
    avatarId: "avatar-2",
    name: "Bob",
    gender: "male",
    previewImageUrl: "https://cdn.example.com/bob.jpg",
  },
]

const mockVoices = [
  {
    voiceId: "v1",
    name: "English Male",
    language: "en",
    gender: "male",
    previewAudio: "https://cdn.example.com/v1.mp3",
    supportPause: true,
    emotionSupport: false,
    supportLocale: true,
  },
  {
    voiceId: "v2",
    name: "Spanish Female",
    language: "es",
    gender: "female",
    previewAudio: "https://cdn.example.com/v2.mp3",
    supportPause: false,
    emotionSupport: true,
    supportLocale: false,
  },
]

// ---------------------------------------------------------------------------
// GET /v1/heygen/avatars
// ---------------------------------------------------------------------------

describe("GET /v1/heygen/avatars", () => {
  it("returns 200 with { avatars: [...] } shape", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty("avatars")
    expect(Array.isArray(body.avatars)).toBe(true)
    expect(body.avatars).toHaveLength(2)
  })

  it("returns the avatar objects with expected fields", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    const { avatars } = res.json()

    const alice = avatars.find((a: { avatarId: string }) => a.avatarId === "avatar-1")
    expect(alice).toBeDefined()
    expect(alice.name).toBe("Alice")
    expect(alice.gender).toBe("female")
    expect(alice.previewImageUrl).toBe("https://cdn.example.com/alice.jpg")
    expect(alice.defaultVoiceId).toBe("voice-abc")
    expect(alice.preferredOrientation).toBe("portrait")
  })

  it("returns 200 with empty array when HEYGEN_API_KEY is not set (graceful-degrade)", async () => {
    // snapshotAvatars already returns [] by default in our mock (simulates unconfigured key)
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole([]))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.avatars).toEqual([])
  })

  it("sets a public Cache-Control header on a whole, non-empty list", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.headers["cache-control"]).toMatch(/public/)
  })

  it("never long-caches an EMPTY answer — a keyless install that pastes its key must see the pickers fill on the next poll", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole([]))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/heygen/voices
// ---------------------------------------------------------------------------

describe("GET /v1/heygen/voices", () => {
  it("returns 200 with { voices: [...] } shape", async () => {
    vi.mocked(snapshotVoices).mockResolvedValueOnce(whole(mockVoices))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty("voices")
    expect(Array.isArray(body.voices)).toBe(true)
    expect(body.voices).toHaveLength(2)
  })

  it("returns the voice objects with expected fields", async () => {
    vi.mocked(snapshotVoices).mockResolvedValueOnce(whole(mockVoices))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })
    const { voices } = res.json()

    const v1 = voices.find((v: { voiceId: string }) => v.voiceId === "v1")
    expect(v1).toBeDefined()
    expect(v1.name).toBe("English Male")
    expect(v1.language).toBe("en")
    expect(v1.gender).toBe("male")
    expect(v1.previewAudio).toBe("https://cdn.example.com/v1.mp3")
    expect(v1.supportPause).toBe(true)
    expect(v1.emotionSupport).toBe(false)
    expect(v1.supportLocale).toBe(true)
  })

  it("returns 200 with empty array when HEYGEN_API_KEY is not set (graceful-degrade)", async () => {
    vi.mocked(snapshotVoices).mockResolvedValueOnce(whole([]))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.voices).toEqual([])
  })

  it("sets a public Cache-Control header on a whole, non-empty list", async () => {
    vi.mocked(snapshotVoices).mockResolvedValueOnce(whole(mockVoices))

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.headers["cache-control"]).toMatch(/public/)
  })

  it("never long-caches an EMPTY answer", async () => {
    vi.mocked(snapshotVoices).mockResolvedValueOnce(whole([]))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
})

// ---------------------------------------------------------------------------
// The nodaro.ai connection — a keyless connected install lists the cloud's catalog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Progressive answers — a cold catalog serves what it has, and says so
// ---------------------------------------------------------------------------

describe("progressive catalog answers", () => {
  it("relays complete:true with the long public cache on a whole list", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.json().complete).toBe(true)
    expect(res.headers["cache-control"]).toMatch(/public, max-age=3600/)
  })

  it("a partial list is sent complete:false and MUST NOT be cached (no-store) — a browser must never pin half a catalog for an hour", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(partial([mockAvatars[0]]))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ avatars: [mockAvatars[0]], offset: 0, total: 1, complete: false, generation: "g1" })
    expect(res.headers["cache-control"]).toBe("no-store")

    vi.mocked(snapshotVoices).mockResolvedValueOnce(partial([mockVoices[0]]))
    const voices = await app.inject({ method: "GET", url: "/v1/heygen/voices" })
    expect(voices.json()).toEqual({ voices: [mockVoices[0]], offset: 0, total: 1, complete: false, generation: "g1" })
    expect(voices.headers["cache-control"]).toBe("no-store")
  })

  it("passes the client's ?offset=&generation= to the catalog and relays a DELTA (no-store — client-specific)", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(partial([mockAvatars[1]], 1))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=1&generation=g1" })
    expect(snapshotAvatars).toHaveBeenCalledWith({ offset: 1, generation: "g1" }, undefined)
    expect(res.json()).toEqual({ avatars: [mockAvatars[1]], offset: 1, total: 2, complete: false, generation: "g1" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("a whole list answered from an offset (a delta of a finished list) is still no-store; only from-zero whole lists get the long cache", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce({ items: [mockAvatars[1]], offset: 1, total: 2, complete: true, generation: "g1" })
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=1&generation=g1" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("ignores a malformed offset/generation pair (asks the catalog for everything)", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))
    await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=-3&generation=g1" })
    expect(snapshotAvatars).toHaveBeenCalledWith(undefined, undefined)
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))
    await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=5" })
    expect(snapshotAvatars).toHaveBeenLastCalledWith(undefined, undefined)
  })
})

describe("limit — chunked answers on the wire", () => {
  it("passes ?limit= to the catalog and never long-caches a chunk (the client is behind: items < total)", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce({ items: [mockAvatars[0]], offset: 0, total: 2, complete: true, generation: "g1" })
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars?limit=1" })
    expect(snapshotAvatars).toHaveBeenCalledWith(undefined, 1)
    expect(res.json()).toEqual({ avatars: [mockAvatars[0]], offset: 0, total: 2, complete: true, generation: "g1" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
  it("ignores an out-of-range limit", async () => {
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))
    await app.inject({ method: "GET", url: "/v1/heygen/avatars?limit=0" })
    expect(snapshotAvatars).toHaveBeenLastCalledWith(undefined, undefined)
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars))
    await app.inject({ method: "GET", url: "/v1/heygen/avatars?limit=99999" })
    expect(snapshotAvatars).toHaveBeenLastCalledWith(undefined, undefined)
  })
})

describe("GET /v1/heygen/avatars/private — the account's own looks", () => {
  it("returns the private list whole, never long-cached", async () => {
    vi.mocked(snapshotPrivateAvatars).mockResolvedValueOnce([{ ...mockAvatars[1], ownership: "private" }] as never)
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars/private" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ avatars: [{ ...mockAvatars[1], ownership: "private" }] })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
  it("is empty (200) on a keyless install", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars/private" })
    expect(res.json()).toEqual({ avatars: [] })
  })
})

describe("catalog through the nodaro.ai connection", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("relays the cloud's public avatar and voice lists instead of the local (empty) catalog", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new Response(
        JSON.stringify(url.endsWith("/avatars") ? { avatars: [mockAvatars[0]] } : { voices: [{ voiceId: "v-1", name: "Voice" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const avatars = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(avatars.statusCode).toBe(200)
    expect(avatars.json().avatars).toEqual([mockAvatars[0]])
    const voices = await app.inject({ method: "GET", url: "/v1/heygen/voices" })
    expect(voices.json().voices).toEqual([{ voiceId: "v-1", name: "Voice" }])
    expect(fetchMock).toHaveBeenCalledWith("https://cloud.test/v1/heygen/avatars", expect.anything())
    expect(fetchMock).toHaveBeenCalledWith("https://cloud.test/v1/heygen/voices", expect.anything())
    expect(snapshotAvatars).not.toHaveBeenCalled()
    expect(snapshotVoices).not.toHaveBeenCalled()
  })

  it("caches the relayed list — pickers poll, the cloud must not be hit per request", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ avatars: [mockAvatars[1]] }), { status: 200 }))
    await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("degrades to an empty list (200) when the cloud cannot be reached — never a 500 on a picker", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.statusCode).toBe(200)
    expect(res.json().avatars).toEqual([])
  })

  it("relays a partial cloud answer as complete:false without caching it, then caches the whole list", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ avatars: [mockAvatars[0]], offset: 0, total: 1, complete: false, generation: "c1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ avatars: mockAvatars, offset: 0, total: 2, complete: true, generation: "c1" }), { status: 200 }))
    const first = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(first.json()).toEqual({ avatars: [mockAvatars[0]], offset: 0, total: 1, complete: false, generation: "c1" })
    expect(first.headers["cache-control"]).toBe("no-store")
    const second = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(second.json()).toEqual({ avatars: mockAvatars, offset: 0, total: 2, complete: true, generation: "c1" })
    const third = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(third.json().avatars).toEqual(mockAvatars)
    expect(fetchMock).toHaveBeenCalledTimes(2) // the partial answer was not cached; the whole one was
  })

  it("passes a client's delta request through to the cloud while it fills, and serves deltas from its own cache once whole", async () => {
    fetchMock
      // client already holds 1 of generation c1 → the cloud is asked for the tail
      .mockResolvedValueOnce(new Response(JSON.stringify({ avatars: [mockAvatars[1]], offset: 1, total: 2, complete: false, generation: "c1" }), { status: 200 }))
      // next poll: the cloud says whole (as a delta) → the relay fetches the whole list once to cache it
      .mockResolvedValueOnce(new Response(JSON.stringify({ avatars: [], offset: 2, total: 2, complete: true, generation: "c1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ avatars: mockAvatars, offset: 0, total: 2, complete: true, generation: "c1" }), { status: 200 }))
    const tail = await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=1&generation=c1" })
    expect(fetchMock).toHaveBeenLastCalledWith("https://cloud.test/v1/heygen/avatars?offset=1&generation=c1", expect.anything())
    expect(tail.json()).toEqual({ avatars: [mockAvatars[1]], offset: 1, total: 2, complete: false, generation: "c1" })

    const done = await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=2&generation=c1" })
    expect(done.json()).toEqual({ avatars: [], offset: 2, total: 2, complete: true, generation: "c1" })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // cached now: a fresh client gets the whole list, a caught-up client gets an empty delta, no cloud call
    const fresh = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(fresh.json()).toEqual({ avatars: mockAvatars, offset: 0, total: 2, complete: true, generation: "c1" })
    expect(fresh.headers["cache-control"]).toMatch(/public/)
    const caughtUp = await app.inject({ method: "GET", url: "/v1/heygen/avatars?offset=2&generation=c1" })
    expect(caughtUp.json()).toEqual({ avatars: [], offset: 2, total: 2, complete: true, generation: "c1" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("an older cloud that sends no `complete` field is treated as whole", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ avatars: [mockAvatars[1]] }), { status: 200 }))
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.json().complete).toBe(true)
    expect(res.headers["cache-control"]).toMatch(/public/)
  })

  it("relays the private list from the cloud too, on its own short cache", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ avatars: [{ avatarId: "mine", name: "Mine", ownership: "private" }] }), { status: 200 }))
    const first = await app.inject({ method: "GET", url: "/v1/heygen/avatars/private" })
    expect(first.json()).toEqual({ avatars: [{ avatarId: "mine", name: "Mine", ownership: "private" }] })
    expect(fetchMock).toHaveBeenLastCalledWith("https://cloud.test/v1/heygen/avatars/private", expect.anything())
    await app.inject({ method: "GET", url: "/v1/heygen/avatars/private" })
    expect(fetchMock).toHaveBeenCalledTimes(1) // cached (2 min) — pickers poll it
    expect(snapshotPrivateAvatars).not.toHaveBeenCalled()
  })

  it("keeps the local catalog when the install has its own HeyGen key", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    vi.mocked(snapshotAvatars).mockResolvedValueOnce(whole(mockAvatars) as never)
    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
    expect(res.json().avatars).toHaveLength(mockAvatars.length)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("POST /v1/heygen/catalog/refresh — the operator's manual refresh", () => {
  it("requires a signed-in user", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })
    expect(res.statusCode).toBe(401)
    expect(refreshHeygenCatalog).not.toHaveBeenCalled()
  })

  it("refuses programmatic tokens (an app or API token must not spend ≈140 HeyGen calls)", async () => {
    caller = { userId: "user-1", apiToken: true }
    expect((await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })).statusCode).toBe(403)
    caller = { userId: "user-1", appAuthorization: true }
    expect((await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })).statusCode).toBe(403)
    expect(refreshHeygenCatalog).not.toHaveBeenCalled()
  })

  it("on community any signed-in user may refresh; the fills start in the background", async () => {
    caller = { userId: "user-1" }
    const res = await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mode: "local", avatars: "started", privateAvatars: "started", voices: "started" })
    expect(refreshHeygenCatalog).toHaveBeenCalledTimes(1)
  })

  it("where the edition has admins, only an admin may refresh", async () => {
    gate.edition.hasAdmin = true
    caller = { userId: "user-1" }
    expect((await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })).statusCode).toBe(403)
    gate.isAdmin.mockResolvedValue(true)
    expect((await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })).statusCode).toBe(200)
    expect(refreshHeygenCatalog).toHaveBeenCalledTimes(1)
  })

  it("on a connected install forgets the relayed copies instead (the catalog lives on nodaro.ai)", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ avatars: mockAvatars, offset: 0, total: 2, complete: true, generation: "cloud-1" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
      await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
      expect(fetchMock).toHaveBeenCalledTimes(1) // cached
      caller = { userId: "user-1" }
      const res = await app.inject({ method: "POST", url: "/v1/heygen/catalog/refresh" })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ mode: "connection", avatars: "relay-reset" })
      expect(refreshHeygenCatalog).not.toHaveBeenCalled()
      await app.inject({ method: "GET", url: "/v1/heygen/avatars" })
      expect(fetchMock).toHaveBeenCalledTimes(2) // pulled again
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
