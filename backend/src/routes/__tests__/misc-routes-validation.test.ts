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
// 1. generate-character
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

  // Studio Identity Foundation: schema now requires at least one of
  // `seedPrompt`, `referencePhotos`, or `description` (in addition to name).
  // A bare `{ name }` payload is no longer accepted — these tests carry a
  // description so they exercise non-refine branches (style, length, etc.).
  const validPayload = {
    name: "Warrior",
    userId: UUID,
    description: "a stoic warrior with a scar",
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
      payload: { userId: UUID, description: "x" },
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
// 2. generate-face
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
