import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockVideoQueueAdd, mockReserveCreditsForJob, mockSunoStyleBoost, mockCommitCredits, mockRefundCredits } = vi.hoisted(() => ({
  mockVideoQueueAdd: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  mockReserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 7,
    watermark: false,
  }),
  mockSunoStyleBoost: vi.fn().mockResolvedValue({ text: "boosted style text" }),
  mockCommitCredits: vi.fn().mockResolvedValue(undefined),
  mockRefundCredits: vi.fn().mockResolvedValue(undefined),
}))

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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mockReserveCreditsForJob,
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: mockVideoQueueAdd,
    getJob: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: "render-job-1" }),
  },
  redis: {},
  tryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/providers/kie/suno-client.js", () => ({
  sunoStyleBoost: mockSunoStyleBoost,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    commitCredits: mockCommitCredits,
    refundCredits: mockRefundCredits,
    getModelCreditCost: vi.fn().mockResolvedValue(7),
  },
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { sunoRoutes } from "../suno.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_JOB_ID = "00000000-0000-4000-8000-000000000050"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await sunoRoutes(instance)
  })

  await app.ready()

  // Default supabase mock: insert returns a job row
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: TEST_JOB_ID },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  } as never)
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedPost(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
}

// ==========================================================================
// POST /v1/suno/generate
// ==========================================================================

describe("POST /v1/suno/generate", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/generate",
      payload: { prompt: "A happy song" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 for missing prompt", async () => {
    const res = await authedPost("/v1/suno/generate", {})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for empty prompt", async () => {
    const res = await authedPost("/v1/suno/generate", { prompt: "" })
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success (default model V5_5)", async () => {
    const res = await authedPost("/v1/suno/generate", { prompt: "A happy song" })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-generate",
      expect.objectContaining({
        jobId: TEST_JOB_ID,
        prompt: "A happy song",
        model: "V5_5",
      }),
    )
  })

  it("passes V4 model to queue", async () => {
    const res = await authedPost("/v1/suno/generate", {
      prompt: "A jazz song",
      model: "V4",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-generate",
      expect.objectContaining({ model: "V4" }),
    )
  })

  it("passes custom mode and instrumental options", async () => {
    const res = await authedPost("/v1/suno/generate", {
      prompt: "An instrumental piece",
      customMode: true,
      instrumental: true,
      lyrics: "[Verse] some lyrics",
      style: "jazz",
      title: "My Song",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-generate",
      expect.objectContaining({
        customMode: true,
        instrumental: true,
        lyrics: "[Verse] some lyrics",
        style: "jazz",
        title: "My Song",
      }),
    )
  })

  it("returns 400 for invalid model", async () => {
    const res = await authedPost("/v1/suno/generate", {
      prompt: "Song",
      model: "INVALID_MODEL",
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 500 when DB insert fails", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DB down" },
          }),
        }),
      }),
    } as never)

    const res = await authedPost("/v1/suno/generate", { prompt: "A song" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ==========================================================================
// POST /v1/suno/cover
// ==========================================================================

describe("POST /v1/suno/cover", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await authedPost("/v1/suno/cover", { prompt: "Cover" })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 for invalid uploadUrl", async () => {
    const res = await authedPost("/v1/suno/cover", {
      prompt: "Cover",
      uploadUrl: "not-a-url",
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/cover", {
      prompt: "A cover song",
      uploadUrl: "https://example.com/audio.mp3",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-cover",
      expect.objectContaining({
        jobId: TEST_JOB_ID,
        prompt: "A cover song",
        uploadUrl: "https://example.com/audio.mp3",
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/extend
// ==========================================================================

describe("POST /v1/suno/extend", () => {
  it("returns 400 for missing audioId", async () => {
    const res = await authedPost("/v1/suno/extend", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/extend", {
      audioId: "audio-123",
      continueAt: 30,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-extend",
      expect.objectContaining({
        audioId: "audio-123",
        continueAt: 30,
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/lyrics
// ==========================================================================

describe("POST /v1/suno/lyrics", () => {
  it("returns 400 for missing prompt", async () => {
    const res = await authedPost("/v1/suno/lyrics", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/lyrics", { prompt: "Write a love song" })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-lyrics",
      expect.objectContaining({
        jobId: TEST_JOB_ID,
        prompt: "Write a love song",
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/separate
// ==========================================================================

describe("POST /v1/suno/separate", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await authedPost("/v1/suno/separate", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId with default type (separate_vocal)", async () => {
    const res = await authedPost("/v1/suno/separate", {
      taskId: "task-1",
      audioId: "audio-1",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-separate",
      expect.objectContaining({
        separateType: "separate_vocal",
      }),
    )
  })

  it("returns jobId with split_stem type", async () => {
    const res = await authedPost("/v1/suno/separate", {
      taskId: "task-1",
      audioId: "audio-1",
      type: "split_stem",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-separate",
      expect.objectContaining({
        separateType: "split_stem",
      }),
    )
  })

  it("returns 400 for invalid type", async () => {
    const res = await authedPost("/v1/suno/separate", {
      taskId: "task-1",
      audioId: "audio-1",
      type: "invalid_type",
    })
    expect(res.statusCode).toBe(400)
  })
})

// ==========================================================================
// POST /v1/suno/music-video
// ==========================================================================

describe("POST /v1/suno/music-video", () => {
  it("returns 400 for missing fields", async () => {
    const res = await authedPost("/v1/suno/music-video", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/music-video", {
      taskId: "task-1",
      audioId: "audio-1",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-music-video",
      expect.objectContaining({
        taskId: "task-1",
        audioId: "audio-1",
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/mashup
// ==========================================================================

describe("POST /v1/suno/mashup", () => {
  it("returns 400 for missing uploadUrlList", async () => {
    const res = await authedPost("/v1/suno/mashup", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when uploadUrlList has only 1 item", async () => {
    const res = await authedPost("/v1/suno/mashup", {
      uploadUrlList: ["https://example.com/a.mp3"],
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/mashup", {
      uploadUrlList: [
        "https://example.com/a.mp3",
        "https://example.com/b.mp3",
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-mashup",
      expect.objectContaining({
        uploadUrlList: [
          "https://example.com/a.mp3",
          "https://example.com/b.mp3",
        ],
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/replace-section
// ==========================================================================

describe("POST /v1/suno/replace-section", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await authedPost("/v1/suno/replace-section", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 when infillEndS < 6", async () => {
    const res = await authedPost("/v1/suno/replace-section", {
      taskId: "task-1",
      audioId: "audio-1",
      infillStartS: 0,
      infillEndS: 3,
      prompt: "New section",
      tags: "rock",
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/replace-section", {
      taskId: "task-1",
      audioId: "audio-1",
      infillStartS: 10,
      infillEndS: 20,
      prompt: "New verse",
      tags: "rock",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-replace-section",
      expect.objectContaining({
        taskId: "task-1",
        audioId: "audio-1",
        infillStartS: 10,
        infillEndS: 20,
        prompt: "New verse",
        tags: "rock",
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/style-boost (Synchronous)
// ==========================================================================

describe("POST /v1/suno/style-boost", () => {
  it("returns 400 for missing content", async () => {
    const res = await authedPost("/v1/suno/style-boost", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns boosted text on success", async () => {
    const res = await authedPost("/v1/suno/style-boost", {
      content: "rock pop",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().text).toBe("boosted style text")
    expect(mockSunoStyleBoost).toHaveBeenCalledWith({ content: "rock pop" })
    expect(mockCommitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("refunds credits on failure", async () => {
    mockSunoStyleBoost.mockRejectedValueOnce(new Error("KIE API down"))

    const res = await authedPost("/v1/suno/style-boost", {
      content: "rock pop",
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-1")
  })
})

// ==========================================================================
// POST /v1/suno/add-instrumental
// ==========================================================================

describe("POST /v1/suno/add-instrumental", () => {
  it("returns 400 for missing fields", async () => {
    const res = await authedPost("/v1/suno/add-instrumental", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/add-instrumental", {
      taskId: "task-1",
      audioId: "audio-1",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-add-instrumental",
      expect.objectContaining({
        taskId: "task-1",
        audioId: "audio-1",
        model: "V5_5",
      }),
    )
  })

  it("validates model is V4_5PLUS, V5, or V5_5 only", async () => {
    const res = await authedPost("/v1/suno/add-instrumental", {
      taskId: "task-1",
      audioId: "audio-1",
      model: "V4",
    })
    expect(res.statusCode).toBe(400)
  })
})

// ==========================================================================
// POST /v1/suno/add-vocals
// ==========================================================================

describe("POST /v1/suno/add-vocals", () => {
  it("returns 400 for missing fields", async () => {
    const res = await authedPost("/v1/suno/add-vocals", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/add-vocals", {
      taskId: "task-1",
      audioId: "audio-1",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
  })
})

// ==========================================================================
// POST /v1/suno/convert-wav
// ==========================================================================

describe("POST /v1/suno/convert-wav", () => {
  it("returns 400 for missing fields", async () => {
    const res = await authedPost("/v1/suno/convert-wav", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/convert-wav", {
      taskId: "task-1",
      audioId: "audio-1",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-convert-wav",
      expect.objectContaining({
        taskId: "task-1",
        audioId: "audio-1",
      }),
    )
  })
})

// ==========================================================================
// POST /v1/suno/upload-extend
// ==========================================================================

describe("POST /v1/suno/upload-extend", () => {
  it("returns 400 for missing fields", async () => {
    const res = await authedPost("/v1/suno/upload-extend", {})
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 for invalid uploadUrl", async () => {
    const res = await authedPost("/v1/suno/upload-extend", {
      uploadUrl: "not-a-url",
      continueAt: 30,
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns jobId on success", async () => {
    const res = await authedPost("/v1/suno/upload-extend", {
      uploadUrl: "https://example.com/audio.mp3",
      continueAt: 30,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-upload-extend",
      expect.objectContaining({
        uploadUrl: "https://example.com/audio.mp3",
        continueAt: 30,
      }),
    )
  })
})
