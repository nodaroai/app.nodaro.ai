import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
  })
  return { supabase: { from: mockFrom } }
})

const queueAdd = vi.fn().mockResolvedValue({ id: "queue-job-1" })
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: (...args: unknown[]) => queueAdd(...args) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { textToSpeechRoutes } from "../text-to-speech.js"
import { deriveVerifiedTtsProviders } from "../voices.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  return app
}

// ═══════════════════════════════════════════════════════════════════════════
// deriveVerifiedTtsProviders — Voice Library model metadata → our providers
// ═══════════════════════════════════════════════════════════════════════════

describe("deriveVerifiedTtsProviders", () => {
  it("returns turbo first when any turbo/flash model is verified", () => {
    expect(deriveVerifiedTtsProviders(["eleven_multilingual_v2", "eleven_turbo_v2_5"]))
      .toEqual(["elevenlabs-turbo", "elevenlabs-multilingual"])
    expect(deriveVerifiedTtsProviders(["eleven_flash_v2_5"])).toEqual(["elevenlabs-turbo"])
  })

  it("returns multilingual only when turbo/flash is NOT verified", () => {
    expect(deriveVerifiedTtsProviders(["eleven_multilingual_v2", "eleven_multilingual_sts_v2"]))
      .toEqual(["elevenlabs-multilingual"])
  })

  it("returns empty for unknown/absent metadata", () => {
    expect(deriveVerifiedTtsProviders([])).toEqual([])
    expect(deriveVerifiedTtsProviders(["eleven_english_sts_v2"])).toEqual([])
  })

  it("returns v3 first when the voice is verified on eleven_v3", () => {
    expect(deriveVerifiedTtsProviders(["eleven_v3"])).toEqual(["elevenlabs-v3"])
  })

  it("puts v3 ahead of turbo/multilingual when the voice is verified on all three", () => {
    expect(deriveVerifiedTtsProviders(["eleven_v3", "eleven_multilingual_v2"]))
      .toEqual(["elevenlabs-v3", "elevenlabs-multilingual"])
    expect(deriveVerifiedTtsProviders(["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_v3"]))
      .toEqual(["elevenlabs-v3", "elevenlabs-turbo", "elevenlabs-multilingual"])
  })

  it("does NOT match v3 on turbo/flash/multilingual model ids (exact-substring guard)", () => {
    expect(deriveVerifiedTtsProviders(["eleven_turbo_v2_5"])).toEqual(["elevenlabs-turbo"])
    expect(deriveVerifiedTtsProviders(["eleven_flash_v2_5"])).toEqual(["elevenlabs-turbo"])
    expect(deriveVerifiedTtsProviders(["eleven_multilingual_v2"])).toEqual(["elevenlabs-multilingual"])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/text-to-speech — the Rachel voice_not_found fallback is scoped to
// MCP (LLM-originated) requests only
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/text-to-speech allowDefaultVoiceFallback", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    queueAdd.mockClear()
    app = createApp()
    await app.register(textToSpeechRoutes)
    await app.ready()
  })

  it("sets the fallback flag for MCP-originated requests (mcp_client present)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text: "hi", voice: "Aaa111Bbb222Ccc333Dd", voiceType: "library", userId: USER_ID, mcp_client: "Claude" },
    })
    expect(res.statusCode).toBe(200)
    expect(queueAdd).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ allowDefaultVoiceFallback: true }))
  })

  it("does NOT set the fallback flag for user requests (no silent voice substitution)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      payload: { text: "hi", voice: "Aaa111Bbb222Ccc333Dd", voiceType: "library", userId: USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(queueAdd).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ allowDefaultVoiceFallback: false }))
  })
})
