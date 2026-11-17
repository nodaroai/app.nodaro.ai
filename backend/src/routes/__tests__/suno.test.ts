import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockVideoQueueAdd, mockReserveCreditsForJob, mockSunoStyleBoost, mockCommitCredits, mockRefundCredits, mockJobInsert } = vi.hoisted(() => ({
  mockVideoQueueAdd: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  mockReserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 7,
    watermark: false,
  }),
  mockSunoStyleBoost: vi.fn().mockResolvedValue({ text: "boosted style text" }),
  mockCommitCredits: vi.fn().mockResolvedValue(undefined),
  mockRefundCredits: vi.fn().mockResolvedValue(undefined),
  // Spies the row `insertJob` passes to `.insert(...)`, so a test can assert
  // `input_data` (the UNCLAMPED original) separately from the enqueued
  // (CLAMPED) payload asserted via mockVideoQueueAdd.
  mockJobInsert: vi.fn(),
}))
/** The job rows a task-id lookup reads (lib/suno-id-source.ts): none by default (a task no job carries). */
const taskRows = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  /** The rows a track-id lookup among the caller's Suno Speech runs answers (Extend). */
  speechTakes: [] as Array<Record<string, unknown>>,
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

vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  // The real platform-host test: the route asks the gate exactly when the worker will import.
  const { isAllowedSocialVideoUrl } = await importOriginal<typeof import("@/lib/url-validator.js")>()
  return { safeUrlSchema: z.string().url(), isAllowedSocialVideoUrl }
})

const gate = vi.hoisted(() => ({ requireImportAllowed: vi.fn() }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: gate.requireImportAllowed,
}))

vi.mock("@/providers/kie/suno-client.js", async (importActual) => ({
  ...(await importActual<typeof import("@/providers/kie/suno-client.js")>()),
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
import { SUNO_STEM_NAMES } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { OWN_MEDIA_URL, withLinkImportsOff } from "@/test/link-imports-off.js"

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
    // How the request signed in, as the auth hook would set it (the import's way in).
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })

  await app.register(async (instance) => {
    await sunoRoutes(instance)
  })

  await app.ready()

  // Default supabase mock: insert returns a job row
  const mockFrom = vi.mocked(supabase.from)
  taskRows.rows = []
  taskRows.speechTakes = []
  mockFrom.mockReturnValue({
    // The task-id lookup (select → eq(provider_task_id) → limit) and the
    // track-id lookup among the caller's speech runs (… → contains → limit).
    select: vi.fn(() => {
      let byTrack = false
      const q = {
        eq: () => q,
        gte: () => q,
        contains: () => {
          byTrack = true
          return q
        },
        limit: async () => ({ data: byTrack ? taskRows.speechTakes : taskRows.rows, error: null }),
      }
      return q
    }),
    insert: mockJobInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: TEST_JOB_ID },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      // markJobFailed's CAS continues with .in("status", …).select("id").
      eq: vi.fn(() => {
        const done = Promise.resolve({ data: null, error: null })
        return Object.assign(done, { in: () => ({ select: () => done }) })
      }),
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

  it("returns jobId on success (default model V6)", async () => {
    const res = await authedPost("/v1/suno/generate", { prompt: "A happy song" })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe(TEST_JOB_ID)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-generate",
      expect.objectContaining({
        jobId: TEST_JOB_ID,
        prompt: "A happy song",
        model: "V6",
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

  it("passes duration to the queue (V6 custom mode)", async () => {
    const res = await authedPost("/v1/suno/generate", {
      prompt: "A pop song",
      customMode: true,
      style: "pop",
      title: "Timed",
      duration: 120,
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-generate",
      expect.objectContaining({ duration: 120 }),
    )
  })

  it("returns 400 for out-of-range duration", async () => {
    const below = await authedPost("/v1/suno/generate", { prompt: "A song", duration: 5 })
    expect(below.statusCode).toBe(400)
    const above = await authedPost("/v1/suno/generate", { prompt: "A song", duration: 400 })
    expect(above.statusCode).toBe(400)
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

  const MY_SONG = { user_id: TEST_USER_ID, job_type: "suno-generate", status: "completed", created_at: new Date().toISOString(), output_data: { sunoTaskId: "gen-task", sunoTracks: [{ id: "track-1", audioUrl: "https://example.com/audio.mp3" }, { id: "track-2", audioUrl: "https://example.com/audio-2.mp3" }] } }

  it("a request with a file covers the file exactly as before, even with my own song's ids beside it (the gate, decided 2026-11-17)", async () => {
    taskRows.rows = [MY_SONG]
    const res = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task", audioId: "track-1", uploadUrl: "https://example.com/audio.mp3" })
    expect(res.statusCode).toBe(200)
    const queued = mockVideoQueueAdd.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(queued).toMatchObject({ uploadUrl: "https://example.com/audio.mp3" })
    expect(queued).not.toHaveProperty("taskId")
    expect(queued).not.toHaveProperty("audioId")
  })

  it("my own finished song's ids alone go by id", async () => {
    taskRows.rows = [MY_SONG]
    const idsOnly = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task", audioId: "track-2" })
    expect(idsOnly.statusCode).toBe(200)
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).toMatchObject({ taskId: "gen-task", audioId: "track-2" })
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).not.toHaveProperty("uploadUrl")
  })

  it("ids alone are refused before any hold when the audio id is not one of the song's tracks, when the song is not finished, and when the prompt cannot go by id", async () => {
    taskRows.rows = [MY_SONG]
    const notATrack = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task", audioId: "someone-elses-track" })
    const promptBesideStyle = await authedPost("/v1/suno/cover", { prompt: "jazz", style: "folk", taskId: "gen-task", audioId: "track-2" })
    taskRows.rows = [{ ...MY_SONG, status: "processing" }]
    const unfinished = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task", audioId: "track-2" })
    for (const res of [notATrack, promptBesideStyle, unfinished]) {
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("suno_cover_source")
    }
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

  it("a task no job here carries is never covered by id: by the file as before, refused with none", async () => {
    const byFile = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "typed-by-hand", audioId: "a", uploadUrl: "https://example.com/audio.mp3" })
    expect(byFile.statusCode).toBe(200)
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).toMatchObject({ uploadUrl: "https://example.com/audio.mp3" })
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).not.toHaveProperty("taskId")
    const alone = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "typed-by-hand", audioId: "a" })
    expect(alone.statusCode).toBe(400)
    expect(alone.json().error.code).toBe("suno_cover_source")
  })

  it("a task that is not a song goes by the file; ids alone of another account are refused", async () => {
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-convert-wav", status: "completed", output_data: {} }]
    const byFile = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "wav-task", audioId: "a", uploadUrl: "https://example.com/audio.mp3" })
    expect(byFile.statusCode).toBe(200)
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).toMatchObject({ uploadUrl: "https://example.com/audio.mp3" })
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).not.toHaveProperty("taskId")
    taskRows.rows = [{ user_id: "someone-else", job_type: "suno-generate", status: "completed", output_data: {} }]
    const notMine = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task", audioId: "a" })
    expect(notMine.statusCode).toBe(403)
    expect(notMine.json().error.code).toBe("suno_task_not_yours")
  })

  it("ids alone of a Suno task that is not a song are refused before any hold", async () => {
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-separate", status: "completed", output_data: {} }]
    const res = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "sep-task", audioId: "stem-v" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("suno_cover_source")
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

  it("takes ids only together", async () => {
    const res = await authedPost("/v1/suno/cover", { prompt: "jazz", taskId: "gen-task" })
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
  it("refuses a Suno Speech take by its id before any hold (it is not a song)", async () => {
    taskRows.speechTakes = [{ id: "job-speech" }]
    const res = await authedPost("/v1/suno/extend", { audioId: "take-1", continueAt: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("suno_not_a_track")
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

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
  it("refuses a Suno Speech take by its ids before any hold; its audio by URL separates like any audio", async () => {
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-speech", status: "completed", output_data: { sunoTrackKind: "speech" } }]
    const byIds = await authedPost("/v1/suno/separate", { taskId: "speech-task", audioId: "take-1" })
    expect(byIds.statusCode).toBe(400)
    expect(byIds.json().error.code).toBe("suno_not_a_track")
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
    const byUrl = await authedPost("/v1/suno/separate", { audioUrl: "https://example.com/take.mp3" })
    expect(byUrl.statusCode).toBe(200)
  })

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

  it("accepts audioUrl without Suno ids and enqueues it", async () => {
    const res = await authedPost("/v1/suno/separate", {
      audioUrl: "https://cdn.example/song.mp3",
      fallbackToDemucs: true,
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-separate", {
      jobId: TEST_JOB_ID,
      audioUrl: "https://cdn.example/song.mp3",
      separateType: "separate_vocal",
      fallbackToDemucs: true,
      usageLogId: "usage-1",
    })
    expect(mockReserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), TEST_JOB_ID, "suno-separate",
    )
  })

  it("rejects neither a task id nor audioUrl with 400 validation_error", async () => {
    for (const body of [{ type: "split_stem" }, { audioId: "audio-1" }, { taskId: "  " }]) {
      const res = await authedPost("/v1/suno/separate", body)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

  // The editor and workflow runs send a task id alone when no audio id is
  // known (decided 2026-10-19: one source rule, @nodaro/render-rules).
  it("accepts a task id alone and enqueues the task id as the audio id", async () => {
    const res = await authedPost("/v1/suno/separate", { taskId: "task-1" })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-separate", {
      jobId: TEST_JOB_ID,
      taskId: "task-1",
      audioId: "task-1",
      separateType: "separate_vocal",
      usageLogId: "usage-1",
    })
  })

  it("with a task id and audioUrl, the ids win and the URL is not enqueued", async () => {
    const res = await authedPost("/v1/suno/separate", {
      taskId: "task-1", audioId: "audio-1", audioUrl: "https://cdn.example/song.mp3", type: "split_stem",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-separate", {
      jobId: TEST_JOB_ID,
      taskId: "task-1",
      audioId: "audio-1",
      separateType: "split_stem",
      usageLogId: "usage-1",
    })
  })

  it("split_stem_advanced reserves suno-separate-single and defaults stemName to Lead Vocal", async () => {
    const res = await authedPost("/v1/suno/separate", {
      audioUrl: "https://cdn.example/song.mp3",
      type: "split_stem_advanced",
    })
    expect(res.statusCode).toBe(200)
    expect(mockReserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), TEST_JOB_ID, "suno-separate-single",
    )
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-separate", {
      jobId: TEST_JOB_ID,
      audioUrl: "https://cdn.example/song.mp3",
      separateType: "split_stem_advanced",
      stemName: "Lead Vocal",
      usageLogId: "usage-1",
    })
  })

  it("forwards a chosen stemName in one-instrument mode, and drops it in any other mode", async () => {
    await authedPost("/v1/suno/separate", {
      taskId: "task-1", audioId: "audio-1", type: "split_stem_advanced", stemName: "Piano",
    })
    expect(mockVideoQueueAdd).toHaveBeenLastCalledWith("suno-separate", expect.objectContaining({ stemName: "Piano" }))
    await authedPost("/v1/suno/separate", {
      taskId: "task-1", audioId: "audio-1", type: "split_stem", stemName: "Piano",
    })
    expect(mockVideoQueueAdd.mock.lastCall?.[1]).not.toHaveProperty("stemName")
  })

  it("rejects an unknown stemName", async () => {
    const res = await authedPost("/v1/suno/separate", {
      audioUrl: "https://cdn.example/song.mp3",
      type: "split_stem_advanced",
      stemName: "Kazoo Orchestra",
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    // The MCP tool takes stem_name as a plain string (wire budget), so this
    // message is what an agent sees: it names the field and every valid name.
    const message = res.json().error.message as string
    expect(message).toMatch(/^stemName: Invalid option: expected one of /)
    for (const name of SUNO_STEM_NAMES) expect(message).toContain(`"${name}"`)
  })

  it("legacy body { taskId, audioId, type } enqueues exactly as before", async () => {
    const res = await authedPost("/v1/suno/separate", {
      taskId: "task-1",
      audioId: "audio-1",
      type: "split_stem",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-separate", {
      jobId: TEST_JOB_ID,
      taskId: "task-1",
      audioId: "audio-1",
      separateType: "split_stem",
      usageLogId: "usage-1",
    })
    expect(Object.keys(mockVideoQueueAdd.mock.lastCall?.[1] ?? {}).sort()).toEqual(
      ["audioId", "jobId", "separateType", "taskId", "usageLogId"],
    )
    expect(mockReserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), TEST_JOB_ID, "suno-separate-stem",
    )
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

  it("accepts a section past the 60s mark — the 6-60s cap is on the INTERVAL, not the end timestamp", async () => {
    const res = await authedPost("/v1/suno/replace-section", {
      taskId: "task-1",
      audioId: "audio-1",
      infillStartS: 100,
      infillEndS: 130,
      prompt: "New bridge",
      tags: "rock",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-replace-section",
      expect.objectContaining({ infillStartS: 100, infillEndS: 130 }),
    )
  })

  it("returns 400 when the replaced interval exceeds 60s", async () => {
    const res = await authedPost("/v1/suno/replace-section", {
      taskId: "task-1",
      audioId: "audio-1",
      infillStartS: 0,
      infillEndS: 90,
      prompt: "Too long",
      tags: "rock",
    })
    expect(res.statusCode).toBe(400)
  })

  it("forwards fullLyrics and negativeTags to the queue", async () => {
    const res = await authedPost("/v1/suno/replace-section", {
      taskId: "task-1",
      audioId: "audio-1",
      infillStartS: 10,
      infillEndS: 20,
      prompt: "New verse",
      tags: "rock",
      fullLyrics: "[Verse]\nAll the lyrics after the edit",
      negativeTags: "metal",
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-replace-section",
      expect.objectContaining({
        fullLyrics: "[Verse]\nAll the lyrics after the edit",
        negativeTags: "metal",
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

  it("style-boost success response carries jobId (MCP dispatchJob parses it)", async () => {
    const res = await authedPost("/v1/suno/style-boost", {
      content: "epic cinematic trailer",
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { jobId?: string; text?: string }
    expect(body.text).toBe("boosted style text")
    expect(body.jobId).toBe(TEST_JOB_ID) // ← the fix: was `{ text }` only, so MCP suno_style_boost ALWAYS returned isError
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
        model: "V6",
      }),
    )
  })

  it("validates model is one of SUNO_ADD_TRACK_MODELS (V4 rejected)", async () => {
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
  it("a stem of my Suno separation queues the stem lane (decided 2026-11-17)", async () => {
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-separate", status: "completed", output_data: { engineUsed: "suno", sunoStemIds: { vocalUrl: "stem-v" } } }]
    const res = await authedPost("/v1/suno/convert-wav", { taskId: "sep-task", audioId: "stem-v" })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith("suno-convert-wav", expect.objectContaining({ taskId: "sep-task", audioId: "stem-v", stem: true }))
  })

  it("another account's track or stem converts as it always did: no ownership check (decided 2026-11-17)", async () => {
    taskRows.rows = [{ user_id: "someone-else", job_type: "suno-generate", status: "completed", output_data: {} }]
    const track = await authedPost("/v1/suno/convert-wav", { taskId: "gen-task", audioId: "track-1" })
    expect(track.statusCode).toBe(200)
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).not.toHaveProperty("stem")
    taskRows.rows = [{ user_id: "someone-else", job_type: "suno-separate", status: "completed", output_data: { engineUsed: "suno", sunoStemIds: { vocalUrl: "stem-v" } } }]
    const stem = await authedPost("/v1/suno/convert-wav", { taskId: "sep-task", audioId: "stem-v" })
    expect(stem.statusCode).toBe(200)
    expect(mockVideoQueueAdd.mock.calls.at(-1)![1]).toMatchObject({ taskId: "sep-task", audioId: "stem-v", stem: true })
  })

  it("refuses a Demucs separation, an id that is not one of the stems and a Suno Speech take, before any hold", async () => {
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-separate", status: "completed", output_data: { engineUsed: "demucs" } }]
    const demucs = await authedPost("/v1/suno/convert-wav", { taskId: "sep-task", audioId: "stem-v" })
    expect(demucs.statusCode).toBe(400)
    expect(demucs.json().error.code).toBe("suno_wav_stem")
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-separate", status: "completed", output_data: { engineUsed: "suno", sunoStemIds: { vocalUrl: "stem-v" } } }]
    const notAStem = await authedPost("/v1/suno/convert-wav", { taskId: "sep-task", audioId: "nope" })
    expect(notAStem.statusCode).toBe(400)
    expect(notAStem.json().error.code).toBe("suno_wav_stem")
    taskRows.rows = [{ user_id: TEST_USER_ID, job_type: "suno-separate", status: "completed", output_data: { engineUsed: "suno", vocalUrl: "https://example.com/v.mp3" } }]
    const idless = await authedPost("/v1/suno/convert-wav", { taskId: "sep-task", audioId: "stem-v" })
    expect(idless.statusCode).toBe(400)
    expect(idless.json().error.code).toBe("suno_wav_stem")
    expect(idless.json().error.message).toMatch(/Run the separation again/)
    // A speech take, whoever made it.
    taskRows.rows = [{ user_id: "someone-else", job_type: "suno-speech", status: "completed", output_data: { sunoTrackKind: "speech" } }]
    const speech = await authedPost("/v1/suno/convert-wav", { taskId: "speech-task", audioId: "take-1" })
    expect(speech.statusCode).toBe(400)
    expect(speech.json().error.code).toBe("suno_not_a_track")
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

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

  it("defaults instrumental to false so KIE never sees a null", async () => {
    const res = await authedPost("/v1/suno/upload-extend", {
      uploadUrl: "https://example.com/audio.mp3",
      continueAt: 30,
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-upload-extend",
      expect.objectContaining({ instrumental: false }),
    )
  })

  it("forwards an explicit instrumental: true", async () => {
    const res = await authedPost("/v1/suno/upload-extend", {
      uploadUrl: "https://example.com/audio.mp3",
      continueAt: 30,
      instrumental: true,
    })
    expect(res.statusCode).toBe(200)
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(
      "suno-upload-extend",
      expect.objectContaining({ instrumental: true }),
    )
  })
})

// ==========================================================================
// A link to a video's page as the source (cover, upload-extend)
// ==========================================================================

describe("Suno given a link to a video's page: an import of the link", () => {
  const SOCIAL = "https://www.youtube.com/watch?v=abc"
  const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
  const ROUTES = [
    { url: "/v1/suno/cover", jobType: "suno-cover", body: { prompt: "A cover song" } },
    { url: "/v1/suno/upload-extend", jobType: "suno-upload-extend", body: { continueAt: 30 } },
  ] as const

  it.each(ROUTES)("$url: a refusal by the gate is 403 with its code, before any job or credit hold", async ({ url, body }) => {
    const refusal = Object.assign(new Error("This link can't be imported here."), { code: "import_source_disabled" })
    gate.requireImportAllowed.mockRejectedValueOnce(refusal)
    const res = await authedPost(url, { ...body, uploadUrl: SOCIAL })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "import_source_disabled", message: refusal.message })
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: TEST_USER_ID, confirmationId: undefined, lane: "route" }))
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

  it.each(ROUTES)("$url: the confirmation is checked at the route and rides in the job data for the worker to spend", async ({ url, jobType, body }) => {
    const res = await authedPost(url, { ...body, uploadUrl: SOCIAL, confirmationId: CONFIRMATION })
    expect(res.statusCode).toBe(200)
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: TEST_USER_ID, confirmationId: CONFIRMATION, lane: "route" }))
    expect(mockVideoQueueAdd).toHaveBeenCalledWith(jobType, expect.objectContaining({ uploadUrl: SOCIAL, confirmationId: CONFIRMATION }))
  })

  it.each(ROUTES)("$url: the gate is asked with the way the request came in", async ({ url, body }) => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { "x-user-id": TEST_USER_ID, "x-auth-kind": "app_token" },
      payload: { ...body, uploadUrl: SOCIAL },
    })
    expect(res.statusCode).toBe(200)
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: TEST_USER_ID, via: "app" }))
  })

  it.each(ROUTES)("$url: a link two URL parsers would read differently is a 400 before the gate, and no job", async ({ url, body }) => {
    for (const uploadUrl of ["https://www.youtube.com/watch?v=ab\ncd", "https://www.youtube.com\\@10.0.0.1/watch?v=abc"]) {
      const res = await authedPost(url, { ...body, uploadUrl })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockVideoQueueAdd).not.toHaveBeenCalled()
  })

  it.each(ROUTES)("$url: a file link never asks the gate, even on a host whose name contains a platform's", async ({ url, body }) => {
    for (const uploadUrl of ["https://example.com/audio.mp3", "https://dropbox.com/s/a/song.mp3"]) {
      const res = await authedPost(url, { ...body, uploadUrl })
      expect(res.statusCode).toBe(200)
    }
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    const payloads = mockVideoQueueAdd.mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(payloads.every((p) => !("confirmationId" in p))).toBe(true)
  })
})

// ==========================================================================
// Suno text ceilings and clamps (P7)
// ==========================================================================

describe("Suno text ceilings and clamps (P7)", () => {
  const long = (n: number) => "a".repeat(n)

  it("accepts a 10000-char generate prompt instead of 400ing, and clamps it to 5000", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/generate",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { prompt: long(10_000), model: "V5_5", customMode: true },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { prompt?: string }
    expect(enqueued.prompt?.length).toBe(5000)
  })

  it("clamps the cover prompt and lyrics to the version cap (no clamp existed here)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/cover",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        prompt: long(9000),
        lyrics: long(9000),
        uploadUrl: "https://example.com/a.mp3",
        model: "V4",
        customMode: true,
      },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { prompt?: string; lyrics?: string }
    // V4 custom mode = 3000
    expect(enqueued.prompt?.length).toBe(3000)
    expect(enqueued.lyrics?.length).toBe(3000)
  })

  it("clamps the extend prompt to the version cap", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/extend",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { audioId: "track-1", prompt: long(9000), model: "V5_5" },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { prompt?: string }
    expect(enqueued.prompt?.length).toBe(5000)
  })

  it("clamps the mashup style to the version cap (mashup has no prompt field)", async () => {
    // 900, NOT 4000: `sunoMashupBody.style` is `z.string().max(1000)` and this
    // PR deliberately does not raise the style bounds, so a 4000-char style is
    // a Zod 400 and could never reach the clamp under test.
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/mashup",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        uploadUrlList: ["https://example.com/a.mp3", "https://example.com/b.mp3"],
        model: "V4",
        style: long(900),
      },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { style?: string }
    expect(enqueued.style?.length).toBe(200) // V4 style cap
  })

  it("clamps replace-section prompt + fullLyrics", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/replace-section",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        taskId: "t1", audioId: "a1", infillStartS: 0, infillEndS: 20,
        prompt: long(9000), fullLyrics: long(9000), tags: "rock",
      },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { prompt?: string; fullLyrics?: string }
    expect(enqueued.prompt?.length).toBe(5000)
    expect(enqueued.fullLyrics?.length).toBe(5000)
  })

  it("clamps style-boost content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/style-boost",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { content: long(9000) },
    })
    expect(res.statusCode).toBe(200)
    // sunoStyleBoost takes an OBJECT, not a bare string — the existing case at
    // suno.test.ts:597 asserts `toHaveBeenCalledWith({ content: "rock pop" })`.
    expect(mockSunoStyleBoost.mock.calls.at(-1)?.[0].content).toHaveLength(5000)
  })

  it("still rejects past the hard ceiling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/generate",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { prompt: long(30_001), model: "V5_5" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("clamps upload-extend style to the version cap (no prompt field, no customMode flag)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/upload-extend",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        model: "V4",
        style: long(900),
        uploadUrl: "https://example.com/a.mp3",
        continueAt: 10,
      },
    })
    expect(res.statusCode).toBe(200)
    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { style?: string }
    expect(enqueued.style?.length).toBe(200) // V4 style cap
  })

  it("input_data keeps the UNCLAMPED text the user submitted; the enqueued payload is clamped", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/suno/generate",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { prompt: long(10_000), model: "V5_5", customMode: true },
    })
    expect(res.statusCode).toBe(200)

    const insertedRow = mockJobInsert.mock.calls.at(-1)?.[0] as { input_data?: { prompt?: string } }
    expect(insertedRow.input_data?.prompt).toHaveLength(10_000)

    const enqueued = mockVideoQueueAdd.mock.calls.at(-1)?.[1] as { prompt?: string }
    expect(enqueued.prompt).toHaveLength(5000)
  })
})

describe("Suno on a deployment that turned link imports off", () => {
  withLinkImportsOff()
  const ROUTES = [
    { url: "/v1/suno/cover", body: { prompt: "A cover song" } },
    { url: "/v1/suno/upload-extend", body: { continueAt: 30 } },
  ] as const

  it.each(ROUTES)("$url: a direct file on another site is refused before the gate, any job or credit hold", async ({ url, body }) => {
    const res = await authedPost(url, { ...body, uploadUrl: "https://example.com/song.mp3" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
  })

  it.each(ROUTES)("$url: a social link is refused the same way", async ({ url, body }) => {
    const res = await authedPost(url, { ...body, uploadUrl: "https://www.youtube.com/watch?v=abc" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
  })

  it.each(ROUTES)("$url: a file of this deployment's own storage still runs", async ({ url, body }) => {
    const res = await authedPost(url, { ...body, uploadUrl: OWN_MEDIA_URL })
    expect(res.statusCode).toBe(200)
  })
})
