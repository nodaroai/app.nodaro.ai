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

// The ids the credit guard is asked to check, in order — the guard itself is a
// no-op here; recording its resolver's answer pins WHAT a request is priced on.
const guardIds = vi.hoisted(() => [] as string[])
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => {
    guardIds.push(resolve(req))
  },
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

vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  // The real platform-host test: the route asks the gate exactly when the worker will import.
  const { isAllowedSocialVideoUrl } = await importOriginal<typeof import("@/lib/url-validator.js")>()
  return { safeUrlSchema: z.string().url(), isAllowedSocialVideoUrl }
})

// Nemotron's file is measured before the guard (lib/nemotron-transcribe-input.ts).
const probe = vi.hoisted(() => ({ probeMediaDurationAndSize: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: vi.fn(async () => {}),
  probeMediaDurationAndSize: probe.probeMediaDurationAndSize,
}))

const gate = vi.hoisted(() => ({ requireImportAllowed: vi.fn() }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: gate.requireImportAllowed,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { transcribeRoutes } from "../transcribe.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { OWN_MEDIA_URL, withLinkImportsOff } from "@/test/link-imports-off.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardIds.length = 0

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
    // How the request signed in, as the auth hook would set it (the import's way in).
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })

  await app.register(async (instance) => {
    await transcribeRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(jobId = "job-1", error: { message: string } | null = null) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: error ? null : { id: jobId },
    error,
  })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/transcribe", () => {
  it("returns 400 when audioUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it with default provider (whisper)", async () => {
    const { mockFrom, mockInsert } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    // Verify supabase was called to insert the job
    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_UUID,
        status: "pending",
        input_data: expect.objectContaining({
          audioUrl: "https://example.com/audio.mp3",
          type: "transcribe",
        }),
      })
    )

    // Verify job was enqueued with default provider
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-1",
        audioUrl: "https://example.com/audio.mp3",
      })
    )
  })

  it("passes language param through to input_data and queue", async () => {
    mockJobInsert("job-2")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
        language: "es",
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify language in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-2",
        language: "es",
      })
    )
  })

  it("passes non-default provider (elevenlabs-stt) through", async () => {
    mockJobInsert("job-3")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
        provider: "elevenlabs-stt",
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify provider in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-3",
        provider: "elevenlabs-stt",
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert("job-1", { message: "DB connection failed" })

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// wordTimestamps × provider capability
//
// The route accepts all three engines; only the CAPABILITY differs. openai/
// whisper (the route's default for an absent provider) has no `word_timestamps`
// input on Replicate — the key is silently dropped and the job "succeeds" with
// an empty word list after credits are spent. The route rejects that pair
// BEFORE the job insert and the reservation; the other two lanes run.
// ---------------------------------------------------------------------------

describe("POST /v1/transcribe — wordTimestamps capability gate", () => {
  it("rejects wordTimestamps on the DEFAULT provider (whisper), naming the field", async () => {
    const { mockFrom } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        wordTimestamps: true,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("wordTimestamps")
    expect(body.error.issues.map((i: { path: string }) => i.path)).toContain("wordTimestamps")
    // It names EVERY provider that can do it, derived from the capability table
    // — not a hand-written list, so a new capable lane joins the message free.
    expect(body.error.message).toContain("elevenlabs-stt")
    expect(body.error.message).toContain("incredibly-fast-whisper")
    // Nothing was created, reserved or queued — the gate is pre-insert and
    // therefore pre-reservation.
    expect(mockFrom).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("accepts wordTimestamps with elevenlabs-stt", async () => {
    mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        provider: "elevenlabs-stt",
        wordTimestamps: true,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({ provider: "elevenlabs-stt", wordTimestamps: true }),
    )
  })

  it("accepts the default provider when wordTimestamps is absent (text-only run)", async () => {
    mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it("accepts wordTimestamps: false on the default provider", async () => {
    mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        wordTimestamps: false,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it("rejects an EXPLICIT whisper + wordTimestamps on the capability, not the enum", async () => {
    // The Replicate lanes are in TRANSCRIBE_PROVIDERS now (the canvas node has
    // offered them since #768, while the route's enum still 400'd them — a
    // single-node Run on Whisper failed where the same node in a workflow ran).
    // So whisper reaches superRefine and is refused on `wordTimestamps` — the
    // capability it lacks — never on `provider`, which is a legal engine.
    const { mockFrom } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        provider: "whisper",
        wordTimestamps: true,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    const paths = body.error.issues.map((i: { path: string }) => i.path)
    expect(paths).toContain("wordTimestamps")
    expect(paths).not.toContain("provider")
    expect(mockFrom).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("accepts wordTimestamps with incredibly-fast-whisper (timestamp: \"word\")", async () => {
    mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        provider: "incredibly-fast-whisper",
        wordTimestamps: true,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({ provider: "incredibly-fast-whisper", wordTimestamps: true }),
    )
  })

  it.each(["elevenlabs-stt", "whisper", "incredibly-fast-whisper"])(
    "runs %s with no wordTimestamps — every engine in the enum is accepted",
    async (provider) => {
      mockJobInsert("job-1")

      const res = await app.inject({
        method: "POST",
        url: "/v1/transcribe",
        payload: {
          audioUrl: "https://example.com/audio.mp3",
          provider,
          userId: VALID_UUID,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith(
        "transcribe",
        expect.objectContaining({ provider }),
      )
    },
  )

  it("still rejects an engine that is not one of the three", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        provider: "not-an-engine",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(body.error.issues.map((i: { path: string }) => i.path)).toContain("provider")
  })
})

describe("POST /v1/transcribe — a link to a video's page is an import of the link", () => {
  const SOCIAL = "https://www.youtube.com/watch?v=abc"
  const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/transcribe", payload: { userId: VALID_UUID, ...payload } })

  it("a refusal by the gate is 403 with its code, before any job or credit hold", async () => {
    const refusal = Object.assign(new Error("Confirm that you hold the rights to this content before it is imported."), { code: "rights_confirmation_required" })
    gate.requireImportAllowed.mockRejectedValueOnce(refusal)
    const { mockFrom } = mockJobInsert()
    const res = await post({ audioUrl: SOCIAL })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "rights_confirmation_required", message: refusal.message })
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: VALID_UUID, confirmationId: undefined, lane: "route" }))
    expect(mockFrom).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("the confirmation is checked at the route and rides in the job data for the worker to spend", async () => {
    mockJobInsert()
    const res = await post({ audioUrl: SOCIAL, confirmationId: CONFIRMATION })
    expect(res.statusCode).toBe(200)
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: VALID_UUID, confirmationId: CONFIRMATION, lane: "route" }))
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("transcribe", expect.objectContaining({ audioUrl: SOCIAL, confirmationId: CONFIRMATION }))
  })

  it("a file link never asks the gate, even on a host whose name contains a platform's", async () => {
    mockJobInsert()
    for (const audioUrl of ["https://example.com/audio.mp3", "https://dropbox.com/s/a/talk.mp3"]) {
      const res = await post({ audioUrl })
      expect(res.statusCode).toBe(200)
    }
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    const payloads = vi.mocked(videoQueue.add).mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(payloads.every((p) => !("confirmationId" in p))).toBe(true)
  })

  it("the gate is asked with the way the request came in, so a key's import can stand on a standing authorization", async () => {
    mockJobInsert()
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      headers: { "x-auth-kind": "api_token" },
      payload: { userId: VALID_UUID, audioUrl: SOCIAL },
    })
    expect(res.statusCode).toBe(200)
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(SOCIAL, expect.objectContaining({ userId: VALID_UUID, via: "api" }))
  })

  it("a link two URL parsers would read differently is a 400 before the gate, and no job", async () => {
    const { mockFrom } = mockJobInsert()
    // A control character inside the link (one at either end is trimmed by the
    // schema, so the link that passes is the link everything reads), or a backslash.
    for (const audioUrl of ["https://www.youtube.com/watch?v=ab\ncd", "https://www.you\ttube.com/watch?v=abc", "https://www.youtube.com\\@10.0.0.1/watch?v=abc"]) {
      const res = await post({ audioUrl, provider: "elevenlabs-stt" })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("a confirmation that is not an id is a 400, before the gate", async () => {
    const res = await post({ audioUrl: SOCIAL, confirmationId: "not-an-id" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.issues.map((i: { path: string }) => i.path)).toContain("confirmationId")
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })
})

describe("POST /v1/transcribe on a deployment that turned link imports off", () => {
  withLinkImportsOff()

  it("refuses a direct file on another site before any job or reservation", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { userId: VALID_UUID, audioUrl: "https://example.com/talk.mp3" } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("a file of this deployment's own storage still runs", async () => {
    mockJobInsert()
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { userId: VALID_UUID, audioUrl: OWN_MEDIA_URL } })
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith("transcribe", expect.objectContaining({ audioUrl: OWN_MEDIA_URL }))
  })
})

// ---------------------------------------------------------------------------
// Nemotron 3.5 Transcribe (2026-11-12): priced per started minute of the file,
// measured BEFORE the guard; the one engine that translates.
// ---------------------------------------------------------------------------

describe("POST /v1/transcribe — Nemotron 3.5 Transcribe", () => {
  const NEMOTRON = "nemotron-3-5-transcribe"
  const FILE = "https://example.com/talk.mp3"

  it("a forged measurement in the body is overwritten by the real one", async () => {
    probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 3000 })
    mockJobInsert("job-n5")
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: { audioUrl: FILE, provider: NEMOTRON, userId: VALID_UUID, __nemotronMeasured: { creditId: "nemotron-3-5-transcribe:1m", durationSec: 1 } },
    })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["nemotron-3-5-transcribe:50m"])
  })

  it("measures the file first, then checks and reserves its per-minute id", async () => {
    probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 125, sizeBytes: 2_000_000 })
    const { mockInsert } = mockJobInsert("job-n1")

    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: NEMOTRON, userId: VALID_UUID } })

    expect(res.statusCode).toBe(200)
    expect(probe.probeMediaDurationAndSize).toHaveBeenCalledWith(FILE)
    expect(guardIds).toEqual(["nemotron-3-5-transcribe:3m"])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-n1", "nemotron-3-5-transcribe:3m")
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      input_data: expect.objectContaining({ provider: NEMOTRON, duration_seconds: 125, bucketKey: "nemotron-3-5-transcribe:3m" }),
    }))
    // The worker settles at KIE's length against the hold it is handed.
    expect(videoQueue.add).toHaveBeenCalledWith("transcribe", expect.objectContaining({ provider: NEMOTRON, duration_seconds: 125, bucketKey: "nemotron-3-5-transcribe:3m" }))
    // The stash never reaches the job or the queue.
    expect(JSON.stringify(vi.mocked(videoQueue.add).mock.calls[0])).not.toContain("__nemotronMeasured")
  })

  it.each([
    [{ durationSec: 3601, sizeBytes: 1_000 }, "media_duration_exceeds_limit"],
    [{ durationSec: 600, sizeBytes: 201 * 1024 * 1024 }, "media_size_exceeds_limit"],
  ])("refuses a file KIE would refuse (%o) before anything is held", async (probed, code) => {
    probe.probeMediaDurationAndSize.mockResolvedValue(probed)
    const { mockFrom } = mockJobInsert()

    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: NEMOTRON, userId: VALID_UUID } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(guardIds).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("holds the 60-minute price for a file whose length cannot be read, and the worker settles at KIE's length", async () => {
    probe.probeMediaDurationAndSize.mockResolvedValue({ sizeBytes: 4_000_000 })
    const { mockInsert } = mockJobInsert("job-n4")
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: NEMOTRON, userId: VALID_UUID } })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["nemotron-3-5-transcribe:60m"])
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      input_data: expect.objectContaining({ bucketKey: "nemotron-3-5-transcribe:60m" }),
    }))
    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).toMatchObject({ bucketKey: "nemotron-3-5-transcribe:60m" })
    expect(queued).not.toHaveProperty("duration_seconds")
  })

  // (A private host is refused too: this file mocks `safeUrlSchema` as a plain
  // URL check, so that case is held in lib/__tests__/nemotron-transcribe-input.test.ts.)
  it("refuses anything but an https link, before probing it", async () => {
    for (const audioUrl of ["http://example.com/talk.mp3"]) {
      const { mockFrom } = mockJobInsert()
      const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl, provider: NEMOTRON, userId: VALID_UUID } })
      expect(res.statusCode, audioUrl).toBe(400)
      expect(res.json().error.code, audioUrl).toBe("invalid_media_url")
      expect(mockFrom).not.toHaveBeenCalled()
    }
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
    expect(guardIds).toEqual([])
  })

  it("refuses a link to a video's page (its sound would only exist after the hold), without probing it", async () => {
    mockJobInsert()
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: { audioUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: NEMOTRON, userId: VALID_UUID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("media_page_link_unsupported")
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("translates: targetLanguage reaches the worker, and costs the same minutes", async () => {
    probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 30 })
    mockJobInsert("job-n2")
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: NEMOTRON, targetLanguage: "en", userId: VALID_UUID } })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["nemotron-3-5-transcribe:1m"])
    expect(videoQueue.add).toHaveBeenCalledWith("transcribe", expect.objectContaining({ targetLanguage: "en" }))
  })

  it("refuses a translation together with word timings, before probing the file", async () => {
    mockJobInsert()
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: { audioUrl: FILE, provider: NEMOTRON, targetLanguage: "en", wordTimestamps: true, userId: VALID_UUID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(JSON.stringify(res.json())).toContain("word timings")
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
    expect(guardIds).toEqual([])
  })

  it.each(["elevenlabs-stt", "whisper", "incredibly-fast-whisper", undefined])(
    "refuses a translation on %s (only Nemotron translates)",
    async (provider) => {
      const { mockFrom } = mockJobInsert()
      const res = await app.inject({
        method: "POST",
        url: "/v1/transcribe",
        payload: { audioUrl: FILE, ...(provider ? { provider } : {}), targetLanguage: "en", userId: VALID_UUID },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(JSON.stringify(res.json())).toContain(NEMOTRON)
      expect(mockFrom).not.toHaveBeenCalled()
    },
  )

  it("refuses a target language KIE does not translate into", async () => {
    mockJobInsert()
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: NEMOTRON, targetLanguage: "vi", userId: VALID_UUID } })
    expect(res.statusCode).toBe(400)
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
  })

  it("leaves every other engine as it was: priced on its own id, nothing probed", async () => {
    mockJobInsert("job-n3")
    const res = await app.inject({ method: "POST", url: "/v1/transcribe", payload: { audioUrl: FILE, provider: "elevenlabs-stt", userId: VALID_UUID } })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["elevenlabs-stt"])
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).not.toHaveProperty("targetLanguage")
    expect(queued).not.toHaveProperty("duration_seconds")
  })
})
