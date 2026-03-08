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
    creditsReserved: 2,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(undefined),
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateScriptRoutes } from "../generate-script.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_JOB_ID = "00000000-0000-4000-8000-000000000099"

function mockJobInsertSuccess() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_JOB_ID }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return { mockInsert }
}

function mockJobInsertError(message: string) {
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message } })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header or userId in body
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
    } else {
      const body = req.body as Record<string, unknown> | undefined
      if (body?.userId && typeof body.userId === "string") {
        req.userId = body.userId
      }
    }
  })
  await app.register(async (instance) => {
    await generateScriptRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// POST /v1/generate-script
// ---------------------------------------------------------------------------

describe("POST /v1/generate-script", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when prompt is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "Write a story about space" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsertError("DB insert failed")

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "Write a story about space", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 200 with jobId on success", async () => {
    mockJobInsertSuccess()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "Write a story about space", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
  })

  it("queues job to videoQueue with correct data", async () => {
    mockJobInsertSuccess()

    await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "Write a story about space", userId: TEST_USER_ID },
    })

    expect(videoQueue.add).toHaveBeenCalledWith("generate-script", {
      jobId: TEST_JOB_ID,
      prompt: "Write a story about space",
      sceneCount: undefined,
      tone: undefined,
      targetDuration: undefined,
      provider: undefined,
      usageLogId: "usage-1",
    })
  })

  it("handles optional fields", async () => {
    mockJobInsertSuccess()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: {
        prompt: "Write a story",
        userId: TEST_USER_ID,
        sceneCount: 5,
        tone: "dramatic",
        targetDuration: 120,
        provider: "claude",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-script",
      expect.objectContaining({
        sceneCount: 5,
        tone: "dramatic",
        targetDuration: 120,
        provider: "claude",
      }),
    )
  })

  it("calls reserveCreditsForJob with correct model identifier", async () => {
    mockJobInsertSuccess()

    await app.inject({
      method: "POST",
      url: "/v1/generate-script",
      payload: { prompt: "Write a story", userId: TEST_USER_ID, provider: "claude" },
    })

    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TEST_JOB_ID,
      "claude",
    )
  })
})
