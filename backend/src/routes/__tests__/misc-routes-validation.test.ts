import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "user-123", tier: "pro" },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  })
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
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "u-1",
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

vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

vi.mock("@/providers/kie/client.js", () => ({
  runKieTask: vi.fn().mockResolvedValue({
    url: "https://r2.example.com/out.png",
    kieTaskId: "kie-1",
    cost: 0.02,
  }),
}))

vi.mock("@/lib/llm-client.js", () => ({
  llmComplete: vi.fn().mockResolvedValue({
    text: '{"categories":[]}',
    usage: { inputTokens: 100, outputTokens: 50 },
  }),
}))

vi.mock("@/config/prompt-templates.js", () => ({
  resolveTemplate: vi.fn().mockReturnValue("portrait of {description}, style: {style}"),
  applyTemplate: vi.fn().mockReturnValue("portrait of Hero Face, style: realistic"),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { soraStoryboardRoutes } from "../sora-storyboard.js"
import { soraCharacterRoutes } from "../sora-character.js"
import { generateCharacterRoutes } from "../generate-character.js"
import { generateFaceRoutes } from "../generate-face.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID = "00000000-0000-4000-8000-000000000001"

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

// ===========================================================================
// 1. sora-storyboard
// ===========================================================================

describe("POST /v1/sora-storyboard", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => {
      await soraStoryboardRoutes(instance)
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const validPayload = {
    shots: [{ scene: "A sunset over mountains", duration: 5 }],
    userId: UUID,
  }

  it("accepts a valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: validPayload,
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects empty shots array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, shots: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects more than 10 shots", async () => {
    const shots = Array.from({ length: 11 }, (_, i) => ({
      scene: `Shot ${i + 1}`,
      duration: 3,
    }))
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, shots },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects shot with duration 0", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: {
        ...validPayload,
        shots: [{ scene: "A scene", duration: 0 }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects shot with duration 11", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: {
        ...validPayload,
        shots: [{ scene: "A scene", duration: 11 }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(["10", "15", "25"])("accepts nFrames '%s'", async (nFrames) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, nFrames },
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects nFrames '30'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, nFrames: "30" },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(["portrait", "landscape"])("accepts aspectRatio '%s'", async (aspectRatio) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, aspectRatio },
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects aspectRatio 'square'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: { ...validPayload, aspectRatio: "square" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects characterIdList with more than 5 items", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-storyboard",
      payload: {
        ...validPayload,
        characterIdList: ["a", "b", "c", "d", "e", "f"],
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// 2. sora-character
// ===========================================================================

describe("POST /v1/sora-character", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => {
      await soraCharacterRoutes(instance)
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const validPayload = {
    mode: "video" as const,
    characterPrompt: "A young warrior",
    videoUrl: "https://example.com/v.mp4",
    userId: UUID,
  }

  it("accepts a valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: validPayload,
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing mode", async () => {
    const { mode: _, ...noMode } = validPayload
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: noMode,
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects invalid mode 'photo'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: { ...validPayload, mode: "photo" },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(["video", "sora-task"])("accepts mode '%s'", async (mode) => {
    const payload =
      mode === "sora-task"
        ? {
            mode,
            characterPrompt: "A warrior",
            kieTaskId: "task-1",
            timestamps: "0:00-0:05",
            userId: UUID,
          }
        : validPayload
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload,
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing characterPrompt", async () => {
    const { characterPrompt: _, ...noPrompt } = validPayload
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: noPrompt,
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects characterPrompt longer than 5000 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: {
        ...validPayload,
        characterPrompt: "x".repeat(5001),
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing userId", async () => {
    const { userId: _, ...noUser } = validPayload
    const res = await app.inject({
      method: "POST",
      url: "/v1/sora-character",
      payload: noUser,
    })
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// 3. generate-character
// ===========================================================================

describe("POST /v1/generate-character", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => {
      await generateCharacterRoutes(instance)
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const validPayload = {
    name: "Warrior",
    userId: UUID,
  }

  it("accepts a valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: validPayload,
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { userId: UUID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects empty name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { ...validPayload, name: "" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects name longer than 200 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { ...validPayload, name: "a".repeat(201) },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(["realistic", "anime", "3d-pixar", "illustration"])(
    "accepts style '%s'",
    async (style) => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        payload: { ...validPayload, style },
      })
      expect(res.statusCode).not.toBe(400)
    },
  )

  it("rejects invalid style 'cartoon'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { ...validPayload, style: "cartoon" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects description longer than 2000 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: {
        ...validPayload,
        description: "d".repeat(2001),
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// 4. generate-face
// ===========================================================================

describe("POST /v1/generate-face", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    await app.register(async (instance) => {
      await generateFaceRoutes(instance)
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const validPayload = {
    name: "Hero Face",
    userId: UUID,
  }

  it("accepts a valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: validPayload,
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: { userId: UUID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects empty name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: { ...validPayload, name: "" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects name longer than 200 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: { ...validPayload, name: "n".repeat(201) },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(["realistic", "anime"])("accepts style '%s'", async (style) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: { ...validPayload, style },
    })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects invalid style 'watercolor'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: { ...validPayload, style: "watercolor" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects prompt longer than 4000 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-face",
      payload: {
        ...validPayload,
        prompt: "p".repeat(4001),
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
