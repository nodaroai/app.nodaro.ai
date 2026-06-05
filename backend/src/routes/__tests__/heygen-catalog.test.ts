import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// Mock the catalog module so tests never hit the network.
// Each test can override these with vi.mocked(...).mockResolvedValueOnce(...).
vi.mock("@/providers/heygen/catalog.js", () => ({
  listAvatars: vi.fn().mockResolvedValue([]),
  listVoices: vi.fn().mockResolvedValue([]),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { heygenCatalogRoutes } from "../heygen-catalog.js"
import { listAvatars, listVoices } from "../../providers/heygen/catalog.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // No auth hook — routes are public and require no userId.
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
    vi.mocked(listAvatars).mockResolvedValueOnce(mockAvatars)

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty("avatars")
    expect(Array.isArray(body.avatars)).toBe(true)
    expect(body.avatars).toHaveLength(2)
  })

  it("returns the avatar objects with expected fields", async () => {
    vi.mocked(listAvatars).mockResolvedValueOnce(mockAvatars)

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
    // listAvatars already returns [] by default in our mock (simulates unconfigured key)
    vi.mocked(listAvatars).mockResolvedValueOnce([])

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.avatars).toEqual([])
  })

  it("sets a public Cache-Control header", async () => {
    vi.mocked(listAvatars).mockResolvedValueOnce([])

    const res = await app.inject({ method: "GET", url: "/v1/heygen/avatars" })

    expect(res.headers["cache-control"]).toMatch(/public/)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/heygen/voices
// ---------------------------------------------------------------------------

describe("GET /v1/heygen/voices", () => {
  it("returns 200 with { voices: [...] } shape", async () => {
    vi.mocked(listVoices).mockResolvedValueOnce(mockVoices)

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty("voices")
    expect(Array.isArray(body.voices)).toBe(true)
    expect(body.voices).toHaveLength(2)
  })

  it("returns the voice objects with expected fields", async () => {
    vi.mocked(listVoices).mockResolvedValueOnce(mockVoices)

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
    vi.mocked(listVoices).mockResolvedValueOnce([])

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.voices).toEqual([])
  })

  it("sets a public Cache-Control header", async () => {
    vi.mocked(listVoices).mockResolvedValueOnce([])

    const res = await app.inject({ method: "GET", url: "/v1/heygen/voices" })

    expect(res.headers["cache-control"]).toMatch(/public/)
  })
})
