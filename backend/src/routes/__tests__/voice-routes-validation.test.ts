import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "user-123", tier: "pro" }, error: null }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({
  runVoiceChanger: vi.fn().mockResolvedValue({ audioUrl: "https://r2.example.com/out.mp3", cost: 0.10 }),
}))

vi.mock("@/providers/elevenlabs/voice-design.js", () => ({
  runVoiceDesign: vi.fn().mockResolvedValue({ audioUrl: "https://r2.example.com/out.mp3", generatedVoiceId: "voice-1", cost: 0.10 }),
}))

vi.mock("@/providers/elevenlabs/dubbing.js", () => ({
  runDubbing: vi.fn().mockResolvedValue({ audioUrl: "https://r2.example.com/out.mp3", cost: 0.10 }),
}))

vi.mock("@/providers/elevenlabs/forced-alignment.js", () => ({
  runForcedAlignment: vi.fn().mockResolvedValue({ alignment: [], cost: 0.05 }),
}))

vi.mock("@/providers/elevenlabs/voice-remix.js", () => ({
  runVoiceRemix: vi.fn().mockResolvedValue({ audioUrl: "https://r2.example.com/out.mp3", cost: 0.10 }),
}))

vi.mock("@/providers/elevenlabs/direct-tts.js", () => ({
  directElevenLabsTTS: vi.fn().mockResolvedValue({ audioUrl: "https://r2.example.com/out.mp3", cost: 0.05 }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { voiceChangerRoutes } from "../voice-changer.js"
import { voiceDesignRoutes } from "../voice-design.js"
import { dubbingRoutes } from "../dubbing.js"
import { forcedAlignmentRoutes } from "../forced-alignment.js"
import { textToDialogueRoutes } from "../text-to-dialogue.js"
import { voiceRemixRoutes } from "../voice-remix.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-8000-000000000001"

function createApp() {
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
// 1. Voice Changer
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/voice-changer", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await voiceChangerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { audioUrl: "https://example.com/a.mp3", voiceId: "voice-abc", userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects when neither audioUrl nor videoUrl is provided", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { voiceId: "voice-abc", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts videoUrl-only (video mode)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { videoUrl: "https://example.com/clip.mp4", voiceId: "voice-abc", userId: USER_ID } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts both audioUrl and videoUrl (video wins server-side)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, videoUrl: "https://example.com/clip.mp4" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing voiceId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { audioUrl: "https://example.com/a.mp3", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects empty voiceId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, voiceId: "" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts stability 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, stability: 0 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts stability 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, stability: 1 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects stability 1.5", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, stability: 1.5 } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts similarityBoost 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, similarityBoost: 0 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts similarityBoost 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, similarityBoost: 1 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts style 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, style: 0 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts style 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, style: 1 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects style 1.5", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { ...validBody, style: 1.5 } })
    expect(res.statusCode).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Voice Design
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/voice-design", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await voiceDesignRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { text: "a".repeat(100), voiceDescription: "deep male voice", userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects text shorter than 100 chars", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { ...validBody, text: "too short" } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects text longer than 1000 chars", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { ...validBody, text: "a".repeat(1001) } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing voiceDescription", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { text: "a".repeat(100), userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts model eleven_ttv_v3", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { ...validBody, model: "eleven_ttv_v3" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts model eleven_multilingual_ttv_v2", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { ...validBody, model: "eleven_multilingual_ttv_v2" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects an invalid model", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-design", payload: { ...validBody, model: "invalid_model" } })
    expect(res.statusCode).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Dubbing
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/dubbing", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await dubbingRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { audioUrl: "https://example.com/a.mp3", targetLanguage: "es", userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing audioUrl", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { targetLanguage: "es", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing targetLanguage", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { audioUrl: "https://example.com/a.mp3", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects targetLanguage shorter than 2 chars", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { ...validBody, targetLanguage: "x" } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects numSpeakers 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { ...validBody, numSpeakers: 0 } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts numSpeakers 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { ...validBody, numSpeakers: 1 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts numSpeakers 20", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { ...validBody, numSpeakers: 20 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects numSpeakers 21", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/dubbing", payload: { ...validBody, numSpeakers: 21 } })
    expect(res.statusCode).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Forced Alignment
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/forced-alignment", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await forcedAlignmentRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { audioUrl: "https://example.com/a.mp3", transcript: "Hello world", userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/forced-alignment", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing audioUrl", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/forced-alignment", payload: { transcript: "Hello world", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing transcript", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/forced-alignment", payload: { audioUrl: "https://example.com/a.mp3", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects empty transcript", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/forced-alignment", payload: { ...validBody, transcript: "" } })
    expect(res.statusCode).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Text-to-Dialogue
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/text-to-dialogue", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await textToDialogueRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { dialogue: [{ text: "Hello", voice: "voice-1" }], userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects empty dialogue array", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { dialogue: [], userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects dialogue item with missing text", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { dialogue: [{ voice: "voice-1" }], userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects dialogue item with missing voice", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { dialogue: [{ text: "Hello" }], userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts stability 0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { ...validBody, stability: 0 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts stability 0.5", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { ...validBody, stability: 0.5 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts stability 1", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { ...validBody, stability: 1 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects stability 0.3 (must be exactly 0, 0.5, or 1)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/text-to-dialogue", payload: { ...validBody, stability: 0.3 } })
    expect(res.statusCode).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Voice Remix
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /v1/voice-remix", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => { await voiceRemixRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = { text: "Hello world", voiceDescription: "warm female", userId: USER_ID }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-remix", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing text", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-remix", payload: { voiceDescription: "warm female", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing voiceDescription", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-remix", payload: { text: "Hello world", userId: USER_ID } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects empty text", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-remix", payload: { ...validBody, text: "" } })
    expect(res.statusCode).toBe(400)
  })
})
