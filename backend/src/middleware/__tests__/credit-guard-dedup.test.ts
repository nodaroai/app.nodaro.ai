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
  // Required by the `export { MIN_IDEMPOTENCY_KEY_LENGTH } from
  // "../lib/dedup-fingerprint.js"` re-export in credit-guard.ts. Without
  // this entry, ESM strict re-export linking fails at module load and
  // every test importing credit-guard.ts gets a 500.
  MIN_IDEMPOTENCY_KEY_LENGTH: 8,
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
  }, async (req) => ({
    ok: true,
    jobId: "fresh-job",
    inputFingerprint: req.inputFingerprint,
    idempotencyKey: req.idempotencyKey,
  }))
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  // vi.clearAllMocks() resets .mock.calls/.mock.instances but does NOT
  // remove implementations set via mockImplementation. Two tests in the
  // dedup-race describe install their own mockImplementation on
  // mockSupabaseFrom; without an explicit reset their override would
  // leak into the inputFingerprint-backfill describe that runs after.
  mocks.mockSupabaseFrom.mockReset()
  // Restore the hoisted default implementation that returns the simple
  // update chain expected by the inputFingerprint-backfill tests.
  mocks.mockSupabaseFrom.mockImplementation(() => ({ update: mocks.mockSupabaseUpdate }))
  mocks.mockHasCreditsRef.value = true
  mocks.mockFindRecentMatchingJob.mockResolvedValue(null)
  mocks.mockComputeFingerprint.mockReturnValue("fp-test-123")
})

describe("creditGuard — intent-driven dedup (Idempotency-Key required)", () => {
  let app: FastifyInstance
  afterEach(async () => { if (app) await app.close() })

  it("no header → NO DEDUP, route runs normally + req.idempotencyKey undefined", async () => {
    // Critical: AI generation produces different outputs from identical
    // bodies (seeds, stochastic sampling). Two clicks on Generate with
    // same params MUST create two jobs. Body-fingerprint dedup is forbidden.
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
    // Route sees no idempotencyKey — insertWithIdempotencyKey will do a
    // plain INSERT (no dedup, fresh row every time).
    expect(body.idempotencyKey).toBeUndefined()
    // Fingerprint stays populated for diagnostics / anomaly detection,
    // but is NOT a dedup key.
    expect(body.inputFingerprint).toBe("fp-test-123")
    // Critically: findRecentMatchingJob was NEVER called — no fingerprint
    // lookup, no dedup query.
    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalled()
  })

  it("identical bodies submitted twice WITHOUT header → both run (legitimate re-generation)", async () => {
    // Direct test of the user-reported invariant: same body should not
    // collapse. Two POSTs, no header, no dedup, both proceed through
    // the credit guard.
    app = await buildApp()

    const payload = { userId: "user-1", provider: "flux", prompt: "identical prompt" }
    const r1 = await app.inject({ method: "POST", url: "/v1/test-route", payload })
    const r2 = await app.inject({ method: "POST", url: "/v1/test-route", payload })

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(r1.headers["x-dedup-hit"]).toBeUndefined()
    expect(r2.headers["x-dedup-hit"]).toBeUndefined()
    // Both calls reached creditGuardImpl (no dedup short-circuit).
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalledTimes(2)
    // Zero dedup queries — fingerprint is NEVER used as a key.
    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
  })

  it("dedup HIT via header-supplied key — short-circuits to existing job + X-Dedup-Hit", async () => {
    // Client explicitly opts in to dedup by sending a per-click UUID.
    // React StrictMode / network retry from the same logical click
    // reuses the UUID → dedup hits and avoids duplicate execution.
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce({ id: "existing-from-header" })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "client-uuid-42" },
      payload: { userId: "user-1", prompt: "cat" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ jobId: "existing-from-header", deduped: true })
    expect(mocks.mockFindRecentMatchingJob).toHaveBeenCalledWith("user-1", "client-uuid-42")
    expect(mocks.mockCreditGuardImpl).not.toHaveBeenCalled()
  })

  it("two POSTs with DIFFERENT header keys both run (intentional re-runs from distinct clicks)", async () => {
    app = await buildApp()

    const r1 = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "click-uuid-aaaaaaaa" },
      payload: { userId: "user-1", prompt: "cat" },
    })
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "click-uuid-bbbbbbbb" },
      payload: { userId: "user-1", prompt: "cat" },
    })

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(r1.headers["x-dedup-hit"]).toBeUndefined()
    expect(r2.headers["x-dedup-hit"]).toBeUndefined()
    // Both keys looked up, both missed (mock default returns null), both
    // proceeded to creditGuardImpl. Each gets its own job downstream.
    expect(mocks.mockFindRecentMatchingJob).toHaveBeenCalledTimes(2)
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalledTimes(2)
  })

  it("dedup MISS with header — route runs + req.idempotencyKey set so route can pass it to insertWithIdempotencyKey", async () => {
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce(null)
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "fresh-click-uuid" },
      payload: { userId: "user-1", prompt: "cat" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.idempotencyKey).toBe("fresh-click-uuid")
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalled()
  })

  it("dedup is skipped when opts.dedup === false", async () => {
    app = await buildApp({ dedup: false })

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "client-uuid-xxxxxxxxxxx" },
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    expect(mocks.mockCreditGuardImpl).toHaveBeenCalled()
  })

  it("dedup runs in non-cloud editions too when header is present", async () => {
    mocks.mockHasCreditsRef.value = false  // community / business
    mocks.mockFindRecentMatchingJob.mockResolvedValueOnce({ id: "existing-job-self-hosted" })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "client-uuid-selfhost" },
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
      headers: { "idempotency-key": "client-uuid-anon" },
      payload: { provider: "flux" },  // no userId
    })

    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it("malformed Idempotency-Key (below MIN length) is ignored → treated as no header", async () => {
    // Defensive: empty string or 1-char key would collide across unrelated
    // requests from buggy clients. Reject and fall through to no-dedup.
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "idempotency-key": "x" },
      payload: { userId: "user-1", prompt: "cat" },
    })

    expect(res.statusCode).toBe(200)
    expect(mocks.mockFindRecentMatchingJob).not.toHaveBeenCalled()
    const body = res.json()
    expect(body.idempotencyKey).toBeUndefined()
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

// ---------------------------------------------------------------------------
// reserveCreditsForJob — dedup-race detection (unique constraint violation
// during backfill UPDATE → loser cleanup + dedup-hit response)
// ---------------------------------------------------------------------------
//
// This covers the bug: two concurrent POSTs to a route that uses a plain
// INSERT (every route except the 4 already migrated to
// insertWithIdempotencyKey) both succeed at INSERT time because the
// idempotency_key column is NULL and the partial UNIQUE index excludes
// NULL keys. Then reserveCreditsForJob tries to backfill the key:
//   - First caller's UPDATE wins.
//   - Second caller's UPDATE hits the UNIQUE constraint (23505).
// Without this fix, the error was silently swallowed and BOTH jobs lived
// on. With the fix, the loser deletes itself, finds the winner, and
// sends the standard dedup-hit response.

describe("reserveCreditsForJob — dedup-race detection", () => {
  /**
   * Per-test mock that owns the supabase.from(...) routing for the three
   * chains exercised by the race-detection path:
   *  - .from("jobs").update(...).eq("id", X)
   *  - .from("jobs").select("id").eq("user_id", X).eq("idempotency_key", Y)
   *      .neq("id", Z).limit(1).maybeSingle()
   *  - .from("jobs").delete().eq("id", Z)
   */
  /**
   * Per-test mock router for supabase.from("jobs"). Exposes the inner
   * `delete().eq()` spy so callers can assert the exact loser id was
   * targeted — the prior `mock.calls.length > N` proxy passed even when
   * the delete didn't fire (UPDATE + SELECT alone produce 2 from() calls).
   *
   * `winnerSelectError` lets tests exercise the selectError branch of
   * resolveDedupWinnerAndCleanup without duplicating the entire chain —
   * a regression that touches the SELECT chain shape now updates one
   * place, not two.
   */
  function configureFromMock(opts: {
    updateOutcome: { data: unknown[] | null; error: { message: string; code?: string } | null }
    winnerLookup?: { id: string } | null
    winnerSelectError?: { message: string; code?: string }
  }): { deleteEqMock: ReturnType<typeof vi.fn> } {
    const deleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null })
    mocks.mockSupabaseFrom.mockImplementation(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(opts.updateOutcome),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: opts.winnerSelectError ? null : (opts.winnerLookup ?? null),
                  error: opts.winnerSelectError ?? null,
                }),
              }),
            }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({ eq: deleteEqMock }),
    }) as never)
    return { deleteEqMock }
  }

  function buildMockReply(): {
    sent: boolean
    statusCode: number | null
    headers: Record<string, string>
    body: unknown
    header: (k: string, v: string) => unknown
    code: (n: number) => unknown
    send: (b: unknown) => unknown
  } {
    const reply = {
      sent: false,
      statusCode: null as number | null,
      headers: {} as Record<string, string>,
      body: null as unknown,
      header(k: string, v: string) { this.headers[k] = v; return this },
      code(n: number) { this.statusCode = n; return this },
      send(b: unknown) { this.body = b; this.sent = true; return this },
    }
    return reply
  }

  it("unique-violation + winner found → deletes loser, sends 200 dedup-hit, skips credit reservation", async () => {
    const { deleteEqMock } = configureFromMock({
      updateOutcome: { data: null, error: { code: "23505", message: "duplicate key" } },
      winnerLookup: { id: "winner-job-123" },
    })
    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      idempotencyKey: "click-uuid-aaaaaaaa",
      inputFingerprint: "fp-test-123",
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    const result = await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "loser-job-456",
      "flux",
    )

    expect(result).toBeUndefined()
    expect(reply.sent).toBe(true)
    expect(reply.statusCode).toBe(200)
    expect(reply.headers["X-Dedup-Hit"]).toBe("1")
    expect(reply.body).toEqual({ jobId: "winner-job-123", deduped: true })
    // Critical: credit reservation MUST NOT run on a dedup-race loser —
    // the winner already reserved.
    expect(mocks.mockReserveCreditsImpl).not.toHaveBeenCalled()
    // The delete IS fire-and-forget (void) here, so we await a
    // microtask flush via setImmediate-style Promise resolution before
    // asserting. The Promise body itself runs synchronously up to its
    // first await, which is the await on the delete chain — and the
    // mock resolves synchronously.
    await Promise.resolve()
    // Direct assertion that deleteJobBestEffort targeted the loser id
    // (the prior `mock.calls.length > N` proxy passed even when no
    // delete happened — UPDATE + SELECT alone produce 2 from() calls).
    expect(deleteEqMock).toHaveBeenCalledWith("id", "loser-job-456")
  })

  it("unique-violation but winner lookup empty → sends 503 with Retry-After + dedup_race_winner_unresolvable code; deletes orphan loser; credits NOT reserved", async () => {
    // Critical-path safety: when we detect a dedup-race lost but cannot
    // find the winner (rare — winner row hard-deleted in the brief
    // window, or transient DB error), we MUST NOT fall through to credit
    // reservation. Doing so would charge credits and enqueue a BullMQ
    // worker for the loser job — the exact duplicate-execution bug this
    // layer is built to prevent. The function sends a 503 with a
    // structured error code so client SDKs can detect the retryable
    // outcome (the alternative — throw — would bypass the route's
    // `if (reply.sent) return` guard, leaking the raw message and, in
    // batch routes like video-sfx, orphaning all previously-INSERTed
    // jobs because the rollback logic lives behind that guard).
    const { deleteEqMock } = configureFromMock({
      updateOutcome: { data: null, error: { code: "23505", message: "duplicate key" } },
      winnerLookup: null,
    })
    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      idempotencyKey: "click-uuid-bbbbbbbb",
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    const result = await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "job-orphan",
      "flux",
    )

    expect(result).toBeUndefined()
    expect(reply.sent).toBe(true)
    expect(reply.statusCode).toBe(503)
    // Retry-After: 2 seconds (raised from 1s to avoid thundering-herd
    // retries when a 503 cluster correlates on a DB blip).
    expect(reply.headers["Retry-After"]).toBe("2")
    expect(reply.body).toMatchObject({
      error: { code: "dedup_race_winner_unresolvable" },
    })
    // Credit reservation MUST NOT run when the dedup-race winner is
    // unresolvable — that would be the double-execution bug.
    expect(mocks.mockReserveCreditsImpl).not.toHaveBeenCalled()
    // Direct assertion on the orphan delete — the loser id was passed.
    await Promise.resolve()
    expect(deleteEqMock).toHaveBeenCalledWith("id", "job-orphan")
  })

  it("unique-violation but winner SELECT errors → also sends 503 (distinct path from 'no rows'); orphan delete still fires", async () => {
    // Covers the SELECT-error path inside resolveDedupWinnerAndCleanup
    // (separately from the no-row path). Both paths return null to the
    // caller, but the underlying mechanism is different and must be
    // exercised independently so a regression that removes the
    // `if (selectError)` branch is caught by CI.
    const { deleteEqMock } = configureFromMock({
      updateOutcome: { data: null, error: { code: "23505", message: "duplicate key" } },
      winnerSelectError: { code: "PGRST301", message: "connection reset" },
    })

    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      idempotencyKey: "click-uuid-cccccccc",
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "job-orphan-err",
      "flux",
    )

    expect(reply.sent).toBe(true)
    expect(reply.statusCode).toBe(503)
    // Retry-After must be set on this path too — independent assertion
    // so a regression that removes the header from one branch (vs the
    // other) is caught even when the production code shares the line.
    expect(reply.headers["Retry-After"]).toBe("2")
    expect(reply.body).toMatchObject({
      error: { code: "dedup_race_winner_unresolvable" },
    })
    expect(mocks.mockReserveCreditsImpl).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(deleteEqMock).toHaveBeenCalledWith("id", "job-orphan-err")
  })

  it("non-unique-violation error → logs warning, falls through to credit reservation", async () => {
    configureFromMock({
      updateOutcome: { data: null, error: { code: "42P01", message: "transient DB error" } },
    })
    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      idempotencyKey: "click-uuid-cccccccc",
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "job-1",
      "flux",
    )

    expect(reply.sent).toBe(false)
    expect(mocks.mockReserveCreditsImpl).toHaveBeenCalled()
  })

  it("successful backfill (no error) → does not interfere with reservation", async () => {
    configureFromMock({
      updateOutcome: { data: null, error: null },
    })
    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      idempotencyKey: "click-uuid-dddddddd",
      inputFingerprint: "fp-test-456",
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "job-1",
      "flux",
    )

    expect(reply.sent).toBe(false)
    expect(mocks.mockReserveCreditsImpl).toHaveBeenCalled()
  })

  it("unique-violation but no idempotencyKey on req → treated as plain error, not a race", async () => {
    // Defensive: if the UPDATE somehow returns 23505 without us having an
    // idempotency key in flight (shouldn't happen but possible if a column
    // other than idempotency_key has a unique constraint), don't try to
    // resolve a winner.
    configureFromMock({
      updateOutcome: { data: null, error: { code: "23505", message: "some other unique violation" } },
    })
    const reply = buildMockReply()
    const req = {
      userId: "user-1",
      inputFingerprint: "fp-only",
      // no idempotencyKey
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    await reserveCreditsForJob(
      req,
      reply as unknown as Parameters<typeof reserveCreditsForJob>[1],
      "job-1",
      "flux",
    )

    expect(reply.sent).toBe(false)
    expect(mocks.mockReserveCreditsImpl).toHaveBeenCalled()
  })
})
