import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/video-schemas.js", async () => {
  const { z } = await import("zod")
  return {
    shotsSchema: z.array(z.object({ prompt: z.string(), duration: z.number() })),
    elementsSchema: z.array(z.object({ name: z.string() })),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { textToVideoRoutes } from "../text-to-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../lib/prompt-policy.js"
import { assembleVideoConnectedReferences } from "../generate-video.js"
import {
  getStylePromptHint,
  composeVideoPromptText,
  renderDirectionHints,
  VIDEO_HINT_MODE_DEFAULT,
} from "@nodaro/prompts"
import { getMaxVideoPromptChars } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await textToVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests — characterReferences (parity with /v1/generate-video)
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001"
const char = (over: Record<string, unknown> = {}) => ({
  imageUrl: "https://cdn.example/portrait.png",
  description: "A woman with short silver hair and a utility jacket",
  ...over,
})
const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/text-to-video", payload: { userId: USER, prompt: "she walks", ...payload } })

describe("POST /v1/text-to-video — characterReferences", () => {
  it("gemini: accepts characters, threads them to the queue and records them on input_data", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-t1" }, error: null })
    const characterReferences = [char({ name: "Ava" })]
    const res = await post({ provider: "gemini-omni-video", characterReferences })

    expect(res.statusCode).toBe(200)
    const queuePayload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queuePayload.characterReferences).toEqual(characterReferences)
    const inserted = mockInsert.mock.calls[0]![0] as { input_data: Record<string, unknown> }
    expect(inserted.input_data.characterReferences).toEqual(characterReferences)
  })

  it("characters + a source video (the face + real-voice probe shape): both reach the queue and input_data", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-t2" }, error: null })
    const characterReferences = [char()]
    const res = await post({
      provider: "gemini-omni-flash",
      characterReferences,
      referenceVideoUrls: ["https://example.com/black-with-voice.mp4"],
    })
    expect(res.statusCode).toBe(200)
    const queuePayload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queuePayload.characterReferences).toEqual(characterReferences)
    expect(queuePayload.referenceVideoUrls).toEqual(["https://example.com/black-with-voice.mp4"])
    const inserted = mockInsert.mock.calls[0]![0] as { input_data: Record<string, unknown> }
    expect(inserted.input_data.characterReferences).toEqual(characterReferences)
    expect(inserted.input_data.referenceVideoUrls).toEqual(["https://example.com/black-with-voice.mp4"])
  })

  it("the deployment prompt policies see the description (it never joins the prompt) — queued AND recorded text is the policed one", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-t-pol" }, error: null })
    const seen: string[] = []
    registerPromptPolicy({
      id: "test-character-policy",
      apply: (a) => {
        seen.push(a.prompt)
        return { ...a, prompt: a.prompt.includes("[policed]") ? a.prompt : `${a.prompt} [policed]` }
      },
    })
    try {
      const res = await post({ provider: "gemini-omni-video", characterReferences: [char({ name: "Ava" })] })
      expect(res.statusCode).toBe(200)
      expect(seen).toContain("A woman with short silver hair and a utility jacket")
      const queued = (vi.mocked(videoQueue.add).mock.calls[0]![1] as { characterReferences: Array<Record<string, unknown>> }).characterReferences
      expect(queued[0]!.description).toBe("A woman with short silver hair and a utility jacket [policed]")
      expect(queued[0]!.name).toBe("Ava") // a label, never policed
      const inserted = mockInsert.mock.calls[0]![0] as { input_data: { characterReferences: Array<Record<string, unknown>> } }
      expect(inserted.input_data.characterReferences[0]!.description).toBe("A woman with short silver hair and a utility jacket [policed]")
    } finally {
      clearPromptPolicies()
    }
  })

  it("connectedReferences expand into the image budget alongside characters (measured on what ships)", async () => {
    const connectedReferences = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, defaultName: `Ref ${i}`, source: "wired-image", url: `https://example.com/c${i}.png`,
    }))
    const res = await post({
      provider: "gemini-omni-video",
      characterReferences: [char(), char(), char()], // 3 units
      connectedReferences, // 5 images → 8 > 7
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_quota")
  })

  it("rejects a provider with no character channel with a friendly 400", async () => {
    const res = await post({ provider: "seedance-2", characterReferences: [char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_unsupported")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("rejects more than 3 characters at the schema", async () => {
    const res = await post({ provider: "gemini-omni-video", characterReferences: [char(), char(), char(), char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("enforces the shared 7-unit budget", async () => {
    const res = await post({
      provider: "gemini-omni-video",
      characterReferences: [char(), char(), char()], // 3
      referenceVideoUrls: ["https://example.com/v.mp4"], // 2
      referenceImageUrls: ["https://example.com/r1.png", "https://example.com/r2.png", "https://example.com/r3.png"], // 3 → 8
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_quota")
  })

  it("without characterReferences nothing changes (no key on the queue payload)", async () => {
    mockJobInsert({ data: { id: "job-t3" }, error: null })
    const res = await post({ provider: "gemini-omni-video" })
    expect(res.statusCode).toBe(200)
    expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>).characterReferences).toBeUndefined()
  })
})

describe("/v1/text-to-video — character voice persona", () => {
  const voice = { preset: "kore", description: "warm, unhurried", exampleLine: "Hello there" }

  it("threads a voiced character to the queue payload and records it on input_data", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-v1" }, error: null })
    const characterReferences = [char({ name: "Ava", voice }), char({ imageUrl: "https://cdn.example/other.png", voice: { preset: "puck" } })]
    const res = await post({ provider: "gemini-omni-video", characterReferences })
    expect(res.statusCode).toBe(200)
    const queuePayload = vi.mocked(videoQueue.add).mock.calls[0]![1] as { characterReferences: Array<Record<string, unknown>> }
    expect(queuePayload.characterReferences).toEqual(characterReferences)
    const inserted = mockInsert.mock.calls[0]![0] as { input_data: { characterReferences: Array<Record<string, unknown>> } }
    expect(inserted.input_data.characterReferences).toEqual(characterReferences)
  })

  it("rejects an unknown preset and unknown voice keys at the schema", async () => {
    for (const bad of [{ preset: "morgan" }, { description: "no preset" }, { preset: "kore", audio_id: "x" }, { preset: "kore", exampleLine: "x".repeat(121) }]) {
      const res = await post({ provider: "gemini-omni-video", characterReferences: [char({ voice: bad })] })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("a model with no character channel answers 'unsupported' for a voiced character (the voice never drops silently)", async () => {
    const res = await post({ provider: "seedance-2", imageUrl: "https://example.com/i.png", characterReferences: [char({ voice })] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_unsupported")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("the voice DESCRIPTION goes through the deployment prompt policies (queued and recorded), the example line does not", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-v-pol" }, error: null })
    const seen: string[] = []
    registerPromptPolicy({
      id: "test-voice-policy",
      apply: (a) => {
        seen.push(a.prompt)
        return { ...a, prompt: a.prompt.includes("[policed]") ? a.prompt : `${a.prompt} [policed]` }
      },
    })
    try {
      const res = await post({ provider: "gemini-omni-video", characterReferences: [char({ voice })] })
      expect(res.statusCode).toBe(200)
      expect(seen).toContain("warm, unhurried")
      const queued = (vi.mocked(videoQueue.add).mock.calls[0]![1] as { characterReferences: Array<{ voice: Record<string, unknown> }> }).characterReferences
      expect(queued[0]!.voice).toEqual({ preset: "kore", description: "warm, unhurried [policed]", exampleLine: "Hello there" })
      const inserted = mockInsert.mock.calls[0]![0] as { input_data: { characterReferences: Array<{ voice: Record<string, unknown> }> } }
      expect(inserted.input_data.characterReferences[0]!.voice.description).toBe("warm, unhurried [policed]")
    } finally {
      clearPromptPolicies()
    }
  })
})
