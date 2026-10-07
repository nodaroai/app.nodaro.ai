import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import (mirrors generate-video.test.ts)
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

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../lib/prompt-policy.js"

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
    await generateVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helper — mirrors generate-video.test.ts mockJobInsert
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
// Tests — characterReferences (Gemini Omni's dedicated identity input)
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001"
const PORTRAIT = "https://cdn.example/portrait.png"
const char = (over: Record<string, unknown> = {}) => ({
  imageUrl: PORTRAIT,
  description: "A woman with short silver hair and a utility jacket",
  ...over,
})
const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/generate-video", payload: { userId: USER, prompt: "she walks", ...payload } })

describe("POST /v1/generate-video — characterReferences", () => {
  it.each(["gemini-omni-video", "gemini-omni-flash"])(
    "%s: accepts characters with NO start frame (characters count as a multimodal ref) and threads them to the queue + input_data",
    async (provider) => {
      const { mockInsert } = mockJobInsert({ data: { id: "job-c1" }, error: null })
      const characterReferences = [char({ name: "Ava" }), char({ bodyImageUrl: "https://cdn.example/body.png" })]
      const res = await post({ provider, characterReferences })

      expect(res.statusCode).toBe(200)
      const queuePayload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
      expect(queuePayload.characterReferences).toEqual(characterReferences)
      // The job is observable: the inputs are recorded on jobs.input_data.
      const inserted = mockInsert.mock.calls[0]![0] as { input_data: Record<string, unknown> }
      expect(inserted.input_data.characterReferences).toEqual(characterReferences)
    },
  )

  it("rejects a provider with no character channel with a friendly 400 naming it", async () => {
    const res = await post({ provider: "seedance-2", imageUrl: "https://example.com/i.png", characterReferences: [char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_unsupported")
    expect(res.json().error.message).toContain("seedance-2")
    expect(res.json().error.message).toContain("gemini-omni-video") // points at models that DO take them
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("an unsupported provider with characters only says 'unsupported', not 'imageUrl is required'", async () => {
    const res = await post({ provider: "kling-turbo", characterReferences: [char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_unsupported")
  })

  it("rejects characters combined with a start frame — never silently drops either", async () => {
    const res = await post({ provider: "gemini-omni-video", imageUrl: "https://example.com/start.png", characterReferences: [char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_with_start_frame")
    expect(res.json().error.message.toLowerCase()).toContain("start frame")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("the 400 for a start frame is honest: it is a Nodaro limit, not a claim about the upstream", async () => {
    const res = await post({ provider: "gemini-omni-video", imageUrl: "https://example.com/start.png", characterReferences: [char()] })
    const msg = res.json().error.message.toLowerCase() as string
    expect(msg).not.toContain("mutually exclusive")
    expect(msg).not.toContain("provider treats")
  })

  it("rejects characters combined with ONLY an end frame — it would be dropped silently otherwise", async () => {
    const res = await post({ provider: "gemini-omni-video", endFrameUrl: "https://example.com/end.png", characterReferences: [char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("character_references_with_end_frame")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("characters + a source video (the face + real-voice probe shape): both reach the queue payload and input_data", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-probe" }, error: null })
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
  })

  it("the deployment prompt policies see the description (it never joins the prompt) — queued AND recorded text is the policed one", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-pol" }, error: null })
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

  it("rejects more than 3 characters at the schema", async () => {
    const res = await post({ provider: "gemini-omni-video", characterReferences: [char(), char(), char(), char()] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("enforces the shared 7-unit budget (images + 2×videos + characters, a body image costing 2)", async () => {
    // 2 characters with bodies (4) + 1 video (2) + 2 images = 8 > 7
    const over = await post({
      provider: "gemini-omni-video",
      characterReferences: [char({ bodyImageUrl: "https://cdn.example/b1.png" }), char({ bodyImageUrl: "https://cdn.example/b2.png" })],
      referenceVideoUrls: ["https://example.com/v.mp4"],
      referenceImageUrls: ["https://example.com/r1.png", "https://example.com/r2.png"],
    })
    expect(over.statusCode).toBe(400)
    expect(over.json().error.code).toBe("character_references_quota")
    expect(over.json().error.message).toContain("7")

    // …and exactly 7 is fine: 4 + 2 + 1
    mockJobInsert({ data: { id: "job-c2" }, error: null })
    const ok = await post({
      provider: "gemini-omni-video",
      characterReferences: [char({ bodyImageUrl: "https://cdn.example/b1.png" }), char({ bodyImageUrl: "https://cdn.example/b2.png" })],
      referenceVideoUrls: ["https://example.com/v.mp4"],
      referenceImageUrls: ["https://example.com/r1.png"],
    })
    expect(ok.statusCode).toBe(200)
  })

  it.each([
    ["a missing description", { description: undefined }],
    ["a blank description", { description: "   " }],
    ["an over-long description", { description: "x".repeat(2001) }],
    ["an over-long name", { name: "n".repeat(101) }],
    ["a non-URL portrait", { imageUrl: "not a url" }],
    ["a non-URL body image", { bodyImageUrl: "nope" }],
  ])("rejects %s", async (_label, over) => {
    const res = await post({ provider: "gemini-omni-video", characterReferences: [char(over)] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("without characterReferences the request is unchanged (no key on the queue payload)", async () => {
    mockJobInsert({ data: { id: "job-c3" }, error: null })
    const res = await post({ provider: "gemini-omni-video", referenceVideoUrls: ["https://example.com/v.mp4"] })
    expect(res.statusCode).toBe(200)
    const queuePayload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queuePayload.characterReferences).toBeUndefined()
  })
})

describe("/v1/generate-video — character voice persona", () => {
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
