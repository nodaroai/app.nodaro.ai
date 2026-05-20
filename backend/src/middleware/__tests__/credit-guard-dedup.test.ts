import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockFindRecentMatchingJob = vi.fn()
  const mockComputeFingerprint = vi.fn().mockReturnValue("fp-test-123")
  const mockCreditGuardImpl = vi.fn().mockResolvedValue(undefined)
  const mockReserveCreditsImpl = vi.fn().mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 5,
    watermark: false,
  })
  const mockSupabaseUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const mockSupabaseFrom = vi.fn(() => ({ update: mockSupabaseUpdate }))

  return {
    mockHasCreditsRef,
    mockFindRecentMatchingJob,
    mockComputeFingerprint,
    mockCreditGuardImpl,
    mockReserveCreditsImpl,
    mockSupabaseUpdate,
    mockSupabaseFrom,
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => mocks.mockHasCreditsRef.value,
  isCloud: () => mocks.mockHasCreditsRef.value,
  isCommunity: () => !mocks.mockHasCreditsRef.value,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockSupabaseFrom },
}))

vi.mock("@/lib/dedup-fingerprint.js", () => ({
  computeFingerprint: mocks.mockComputeFingerprint,
  findRecentMatchingJob: mocks.mockFindRecentMatchingJob,
  DEDUP_TTL_MS: 10_000,
}))

// The ee impl runs the heavy credit-check + reservation logic. Mock it so we
// can test that dedup hit bypasses it entirely (creditGuardImpl never called).
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => mocks.mockCreditGuardImpl,
  reserveCreditsForJobImpl: mocks.mockReserveCreditsImpl,
}))

import { creditGuard, reserveCreditsForJob } from "../credit-guard.js"

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

async function buildApp(opts?: { dedup?: boolean }): Promise<FastifyInstance> {
  const app = Fastify()
  // Stub req.userId from body so test payloads can drive auth state.
  app.addHook("preHandler", async (req) => {
    const body = req.body as { userId?: string } | undefined
    if (body?.userId) req.userId = body.userId
  })
  app.post("/v1/test-route", {
    preHandler: creditGuard(() => "flux", opts),
  }, async (req) => ({ ok: true, jobId: "fresh-job", inputFingerprint: req.inputFingerprint }))
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCreditsRef.value = true
  mocks.mockFindRecentMatchingJob.mockResolvedValue(null)
  mocks.mockComputeFingerprint.mockReturnValue("fp-test-123")
})

describe("creditGuard — anti-double-click dedup", () => {
  let app: FastifyInstance
  afterEach(async () => { if (app) await app.close() })

  it("dedup HIT: returns 200 with { jobId, deduped: true } + X-Dedup-Hit header", async () => {
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce({ id: "existing-job-7" })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux", prompt: "cat" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ jobId: "existing-job-7", deduped: true })
    // Credit logic must NOT run on a dedup hit
    expect(mocks.mockCreditGuardImpl).not.toHaveBeenCalled()
  })

  it("dedup MISS: route runs normally + req.inputFingerprint is set", async () => {
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce(null)
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux", prompt: "cat" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.inputFingerprint).toBe("fp-test-123")
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalled()
  })

  it("dedup is skipped when opts.dedup === false (voice-clone-style opt-out)", async () => {
    app = await buildApp({ dedup: false })

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalled()
  })

  it("dedup runs in non-cloud editions too (catches double-click everywhere)", async () => {
    mocks.mockHasCreditsRef.value = false  // community / business
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce({ id: "existing-job-self-hosted" })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ jobId: "existing-job-self-hosted", deduped: true })
  })

  it("dedup is skipped for anonymous requests (no userId)", async () => {
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { provider: "flux" },  // no userId
    })

    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it("computeFingerprint receives the route URL + body", async () => {
    app = await buildApp()
    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", prompt: "cat" },
    })

    expect(mocks.mockComputeFingerprint).toHaveBeenCalledWith(
      expect.stringContaining("/v1/test-route"),
      expect.objectContaining({ userId: "user-1", prompt: "cat" }),
    )
  })
})

describe("reserveCreditsForJob — inputFingerprint backfill", () => {
  it("writes input_fingerprint to the jobs row when set on req", async () => {
    const mockReq = { userId: "user-1", inputFingerprint: "fp-test-xyz" } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {} as unknown as Parameters<typeof reserveCreditsForJob>[1]

    await reserveCreditsForJob(mockReq, mockReply, "job-7", "flux")

    expect(mocks.mockSupabaseFrom).toHaveBeenCalledWith("jobs")
    expect(mocks.mockSupabaseUpdate).toHaveBeenCalledWith({ input_fingerprint: "fp-test-xyz" })
  })

  it("skips the UPDATE when req.inputFingerprint is undefined", async () => {
    const mockReq = { userId: "user-1" } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {} as unknown as Parameters<typeof reserveCreditsForJob>[1]

    await reserveCreditsForJob(mockReq, mockReply, "job-7", "flux")

    expect(mocks.mockSupabaseFrom).not.toHaveBeenCalled()
  })

  it("non-cloud edition: backfills fingerprint but skips reservation", async () => {
    mocks.mockHasCreditsRef.value = false
    const mockReq = { userId: "user-1", inputFingerprint: "fp-test" } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {} as unknown as Parameters<typeof reserveCreditsForJob>[1]

    const result = await reserveCreditsForJob(mockReq, mockReply, "job-7", "flux")

    expect(mocks.mockSupabaseFrom).toHaveBeenCalledWith("jobs")
    expect(result).toBeUndefined()
    expect(mocks.mockReserveCreditsImpl).not.toHaveBeenCalled()
  })
})
