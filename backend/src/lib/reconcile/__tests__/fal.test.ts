import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — mirror reconcile/replicate.test.ts. The lifecycle helpers
// (finalize/refund/markFailed-via-supabase/bumpAttempts) are stubbed, plus the
// fal queue status fetch + url extractor so no network / real config loads.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchStatusMock = vi.fn()
  const extractUrlMock = vi.fn((o: unknown) => (o as { url?: string }).url ?? "https://fal.media/x.mp4")
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const bumpMock = vi.fn().mockResolvedValue(undefined)

  // markFailed() lives inside fal.ts and writes via supabase.from("jobs").update(...).eq("id",...).in("status",...).
  // Track which terminal update fired by capturing the update() arg objects.
  // markJobFailed (lib/job-failure.ts) ends its CAS with `.select("id")` and
  // reads the returned rows to answer "did WE flip it?" — the mock must model
  // that or every migrated writer sees a lost race.
  const jobsUpdateCasSelectMock = vi.fn().mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  const jobsUpdateInMock = vi.fn(() => ({ select: jobsUpdateCasSelectMock }))
  // G-7: capture every jobs.update(payload) so tests can assert on the exact
  // recorded update (lastJobsUpdate below), not just individual fields.
  const jobsUpdates: Array<Record<string, unknown>> = []
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    jobsUpdates.push(arg)
    return {
      eq: vi.fn((col: string, _val: string) => {
        if (col === "id") {
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            in: jobsUpdateInMock,
          })
        }
        return { in: jobsUpdateInMock }
      }),
    }
  })
  // A Rhea row's delivery reads the job's owner and watermark rule.
  const jobsSelectMock = vi.fn(() => ({ eq: () => ({ single: async () => ({ data: { user_id: "user-1", should_watermark: true }, error: null }) }) }))
  const fromMock = vi.fn((_table: string) => ({ update: jobsUpdateMock, select: jobsSelectMock }))
  const deliverMock = vi.fn(async (opts: { store: (p: string) => Promise<string> }) => ({ stored: await opts.store("/tmp/fitted.mp4"), width: 720, height: 1278 }))
  const storeMock = vi.fn(async () => "https://r2.example/rhea.mp4")

  // The finalize claim a Rhea delivery takes first (won unless a test says otherwise), and the claim read now.
  const claimMock = vi.fn().mockResolvedValue({ won: true, ts: "2026-11-24T10:00:00.000Z" })
  const releaseMock = vi.fn().mockResolvedValue(undefined)
  const freshClaimMock = vi.fn().mockResolvedValue(false)

  return { fetchStatusMock, extractUrlMock, finalizeMock, refundMock, bumpMock, fromMock, jobsUpdateMock, jobsUpdateInMock, jobsUpdates, deliverMock, storeMock, claimMock, releaseMock, freshClaimMock }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", async (importOriginal) => {
  // isFinalizeJobType + NOT_GENERIC_RECOVERABLE are pure lookups over static
  // sets — keep the REAL ones so the narrowing under test is the real thing,
  // not a re-declared copy that could drift from job-finalize.ts.
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return { ...actual, finalizeJobWithMedia: mocks.finalizeMock, claimJobFinalize: mocks.claimMock, releaseJobFinalizeClaim: mocks.releaseMock }
})
vi.mock("../../finalize-claim-hold.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../finalize-claim-hold.js")>()),
  hasFreshFinalizeClaimNow: mocks.freshClaimMock,
}))
// A re-pick's wait reads at no cadence here (the clock is the test's).
vi.mock("../../topaz-rhea-timeouts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../topaz-rhea-timeouts.js")>()),
  TOPAZ_RHEA_POLL_INTERVAL_MS: 0,
}))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: mocks.bumpMock }))
vi.mock("../../topaz-rhea-delivery.js", () => ({ deliverRheaOutput: mocks.deliverMock }))
vi.mock("../../../workers/shared.js", () => ({ watermarkLocalVideoAndUpload: mocks.storeMock }))
vi.mock("../../../providers/fal/client.js", () => ({
  fetchFalRequestStatus: mocks.fetchStatusMock,
  extractFalUrl: mocks.extractUrlMock,
}))

import { reconcileFalJob, type FalJobRow } from "../fal.js"

const falRow = (over: Partial<FalJobRow> = {}): FalJobRow => ({
  id: "j-fal",
  provider_kind: "fal-request",
  provider_task_id: "req-1",
  reconcile_attempts: 0,
  job_type: "lip-sync",
  input_data: { provider: "sync-lipsync-v3" },
  ...over,
})

// G-7 harness accessor (did not exist before this task).
const lastJobsUpdate = (): Record<string, unknown> => mocks.jobsUpdates.at(-1) ?? {}

describe("reconcileFalJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.claimMock.mockResolvedValue({ won: true, ts: "2026-11-24T10:00:00.000Z" })
    mocks.freshClaimMock.mockResolvedValue(false)
    mocks.jobsUpdates.length = 0
    mocks.extractUrlMock.mockImplementation(
      (o: unknown) => (o as { url?: string }).url ?? "https://fal.media/x.mp4",
    )
  })

  it("COMPLETED → finalizes with the extracted URL (providerUsed: fal, cost: null)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    await reconcileFalJob(falRow())

    // endpoint resolved from input_data.provider via FAL_LIP_SYNC_CONFIGS
    expect(mocks.fetchStatusMock).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", "req-1")
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-fal",
      jobType: "lip-sync",
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://fal.media/out.mp4",
        cost: null,
        providerUsed: "fal",
      }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  it("passes the opts.claimant through to finalize (worker stall re-pick)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    await reconcileFalJob(falRow(), { claimant: "worker" })
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ claimant: "worker" }),
    )
  })

  it("ERROR → markFailed + refund, no finalize", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "ERROR", error: "model crashed" })
    await reconcileFalJob(falRow({ id: "j-err", provider_task_id: "req-err" }))

    expect(mocks.refundMock).toHaveBeenCalledWith("j-err")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
    // markFailed wrote a terminal status via supabase
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeTruthy()
    // Spec D11: the shared markJobFailed CAS. "queued" is newly failable (these
    // sweeps could not take a queued row at all before); "pending_review" is
    // absent BY CONSTRUCTION, so no reconcile tick can fail a job under review.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })

  it("pending → bumpAttempts, no finalize, no refund", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "pending" })
    await reconcileFalJob(falRow({ id: "j-pend", provider_task_id: "req-pend" }))

    expect(mocks.bumpMock).toHaveBeenCalledWith("j-pend", expect.anything())
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("missing provider_task_id → no-op (nothing to re-fetch)", async () => {
    await reconcileFalJob(falRow({ provider_task_id: null }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  it("unresolvable endpoint (unknown/absent input_data.provider) → markFailed + refund, no status fetch", async () => {
    await reconcileFalJob(
      falRow({ id: "j-noendpoint", input_data: { provider: "not-a-fal-model" } }),
    )
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-noendpoint")
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeTruthy()
  })

  it("absent input_data entirely → markFailed + refund (no endpoint recoverable)", async () => {
    await reconcileFalJob(falRow({ id: "j-noinput", input_data: null }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-noinput")
  })

  // Video Depth: fal's second capability. The endpoint comes from the SAME
  // FAL_VIDEO_DEPTH_CONFIGS registry the live dispatch uses. This half needs no
  // finalize support: the status fetch happens before the job_type gate.
  it("resolves a video-depth row's endpoint from FAL_VIDEO_DEPTH_CONFIGS (no fail+refund)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "pending" })
    await reconcileFalJob(
      falRow({ id: "j-depth", provider_task_id: "req-depth", job_type: "video-depth", input_data: { provider: "video-depth-anything" } }),
    )
    expect(mocks.fetchStatusMock).toHaveBeenCalledWith("fal-ai/depth-anything-video", "req-depth")
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).toHaveBeenCalledWith("j-depth", expect.anything())
  })

  // Finalize half: "video-depth" is in VIDEO_JOB_TYPES (lib/job-finalize.ts),
  // so a COMPLETED row finalizes instead of bumping.
  it("COMPLETED video-depth row → finalizes via its provider's endpoint", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/d.mp4" } })
    await reconcileFalJob(falRow({ id: "j-depth", provider_task_id: "req-depth", job_type: "video-depth", input_data: { provider: "video-depth-anything" } }))
    expect(mocks.fetchStatusMock).toHaveBeenCalledWith("fal-ai/depth-anything-video", "req-depth")
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-depth",
      jobType: "video-depth",
      claimant: "cron",
      result: expect.objectContaining({ url: "https://fal.media/d.mp4", cost: null, providerUsed: "fal" }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  // A Rhea run (topaz-rhea, and Nodaro Video Upscale in transparent mode — its
  // default): its endpoint is recovered by the row's provider and mode, and a
  // COMPLETED row is delivered exactly as the worker delivers it (the planned
  // frame, the owner's watermark rule), then finalized with the stored file
  // (its hold is its charge, so the finalize commits it as reserved).
  const RHEA_PLAN = { videoUrl: "https://cdn.example/take.mp4", upscaleRatio: 1.5, upscaleBilledSec: 4.046875, upscaleFrameWidth: 720, upscaleFrameHeight: 1280, upscaleRateTier: "720p" }

  it("a file that cannot be brought to its frame (a final failure) is failed and refunded at the first look, never retried", async () => {
    const { DeterministicJobError } = await import("../../deterministic-job-error.js")
    mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
    mocks.deliverMock.mockRejectedValueOnce(new DeterministicJobError("The upscaled video could not be prepared (crop)."))
    await reconcileFalJob(falRow({ id: "j-bad", provider_task_id: "req-bad", job_type: "video-upscale", input_data: { provider: "topaz-rhea", ...RHEA_PLAN } }))
    expect(mocks.refundMock).toHaveBeenCalledWith("j-bad")
    expect(mocks.bumpMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("a stored Nodaro Video Upscale request that names no mode was made before modes existed: Sharp, not this lane", async () => {
    await reconcileFalJob(falRow({ id: "j-old", job_type: "video-upscale", input_data: { provider: "nodaro-video-upscale", tier: "2k" } }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
  })
  it.each([
    ["topaz-rhea", { provider: "topaz-rhea", ...RHEA_PLAN }],
    ["nodaro-video-upscale, transparent", { provider: "nodaro-video-upscale", mode: "transparent", tier: "720p", ...RHEA_PLAN }],
  ])("COMPLETED %s video-upscale row → delivered via the Rhea delivery and finalized", async (_name, inputData) => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
    await reconcileFalJob(falRow({ id: "j-rhea", provider_task_id: "req-rhea", job_type: "video-upscale", input_data: inputData }))
    expect(mocks.fetchStatusMock).toHaveBeenCalledWith("topaz/upscale/video/precision", "req-rhea")
    expect(mocks.deliverMock).toHaveBeenCalledWith(expect.objectContaining({ outputUrl: "https://fal.media/r.mp4", expected: { width: 720, height: 1280 }, sourceUrl: RHEA_PLAN.videoUrl, jobId: "j-rhea" }))
    expect(mocks.storeMock).toHaveBeenCalledWith("/tmp/fitted.mp4", "j-rhea", "user-1", true)
    expect(mocks.finalizeMock).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "j-rhea",
      jobType: "video-upscale",
      claimant: "cron",
      mediaUrl: "https://r2.example/rhea.mp4",
      result: expect.objectContaining({ url: "https://fal.media/r.mp4", providerUsed: inputData.provider }),
      // The stored file's probed frame, never the plan's.
      extraOutputData: { width: 720, height: 1278 },
    }))
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  // The delivery runs under the finalize claim, taken BEFORE it: the worker and
  // the cron never both do the delivery work, an overlapping tick is kept off
  // by the fresh-claim read, and a claim whose holder died lapses, so the run
  // is still recovered. (The claim is re-entrant per claimant name; the job
  // still completes once and is charged once.)
  describe("a Rhea delivery: the worker and the cron never both deliver it", () => {
    const rheaRow = () => falRow({ id: "j-rhea", provider_kind: "fal-rhea", provider_task_id: "req-rhea", job_type: "video-upscale", input_data: { provider: "topaz-rhea", ...RHEA_PLAN } })

    it("takes the claim before the delivery", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      await reconcileFalJob(rheaRow())
      expect(mocks.claimMock).toHaveBeenCalledWith("j-rhea", "cron")
      expect(mocks.claimMock.mock.invocationCallOrder[0]!).toBeLessThan(mocks.deliverMock.mock.invocationCallOrder[0]!)
    })

    it("another finalizer holds a fresh claim (the worker is delivering it): nothing is delivered, finalized, bumped or refunded", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      mocks.freshClaimMock.mockResolvedValueOnce(true)
      await reconcileFalJob(rheaRow())
      expect(mocks.claimMock).not.toHaveBeenCalled()
      expect(mocks.deliverMock).not.toHaveBeenCalled()
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(mocks.bumpMock).not.toHaveBeenCalled()
      expect(mocks.refundMock).not.toHaveBeenCalled()
    })

    it("the claim is lost to another claimant: nothing is delivered", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      mocks.claimMock.mockResolvedValueOnce({ won: false, ts: null })
      await reconcileFalJob(rheaRow())
      expect(mocks.deliverMock).not.toHaveBeenCalled()
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(mocks.bumpMock).not.toHaveBeenCalled()
    })

    it("a claim whose holder died has lapsed (no fresh claim): the run is recovered and delivered once", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      await reconcileFalJob(rheaRow())
      expect(mocks.deliverMock).toHaveBeenCalledTimes(1)
      expect(mocks.finalizeMock).toHaveBeenCalledTimes(1)
    })

    it("a worker's inline recovery (a stall re-pick) takes over its crashed predecessor's claim without the fresh-claim check", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      mocks.freshClaimMock.mockResolvedValue(true)
      await reconcileFalJob(rheaRow(), { claimant: "worker" })
      expect(mocks.freshClaimMock).not.toHaveBeenCalled()
      expect(mocks.claimMock).toHaveBeenCalledWith("j-rhea", "worker")
      expect(mocks.deliverMock).toHaveBeenCalledTimes(1)
    })

    it("the claim is taken by another finalizer mid-delivery: nothing is stored, finalized or bumped here", async () => {
      const { FinalizeClaimLostError } = await import("../../finalize-claim-hold.js")
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      mocks.deliverMock.mockRejectedValueOnce(new FinalizeClaimLostError("j-rhea"))
      await reconcileFalJob(rheaRow())
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
      expect(mocks.bumpMock).not.toHaveBeenCalled()
      expect(mocks.refundMock).not.toHaveBeenCalled()
    })

    it("a failed delivery releases the claim it took, and the row is bumped for the next tick", async () => {
      mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      mocks.claimMock.mockResolvedValueOnce({ won: true, ts: "t-claim" })
      mocks.deliverMock.mockRejectedValueOnce(new Error("download failed"))
      await reconcileFalJob(rheaRow())
      expect(mocks.releaseMock).toHaveBeenCalledWith("j-rhea", "t-claim")
      expect(mocks.bumpMock).toHaveBeenCalledTimes(1)
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
    })
  })

  // A worker's re-pick of a Rhea row still running upstream (a deploy killed
  // the worker mid-wait) waits it out inline, bounded from the request's stamp.
  describe("a worker's re-pick of a Rhea request still running", () => {
    const MIN = 60_000
    const T0 = Date.parse("2026-11-24T10:00:00.000Z")
    const rheaRow = () => falRow({ id: "j-rhea", provider_kind: "fal-rhea", provider_task_id: "req-rhea", job_type: "video-upscale", input_data: { provider: "topaz-rhea", ...RHEA_PLAN } })
    let now = T0
    const stampUpdates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
    /** The row as stamped `stampMin` minutes after T0, read now at `nowMin`. */
    const setUp = (stampMin: number, nowMin: number) => {
      now = T0 + nowMin * MIN
      vi.spyOn(Date, "now").mockImplementation(() => now)
      stampUpdates.length = 0
      mocks.fromMock.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { provider_call_started_at: new Date(T0 + stampMin * MIN).toISOString() }, error: null }),
            single: async () => ({ data: { user_id: "user-1", should_watermark: true }, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = []
          stampUpdates.push({ patch, filters })
          const chain = {
            eq: (c: string, v: unknown) => { filters.push([c, v]); return chain },
            in: (c: string, v: unknown) => { filters.push([c, v]); return chain },
            then: (r: (v: unknown) => void) => r({ data: null, error: null }),
          }
          return chain
        },
      }) as never)
    }
    afterEach(() => {
      vi.restoreAllMocks()
      mocks.fromMock.mockReset()
    })

    it("is read until it ends and delivered once, spending no recovery attempt while it waits", async () => {
      setUp(0, 20)
      mocks.fetchStatusMock
        .mockResolvedValueOnce({ status: "pending" })
        .mockResolvedValueOnce({ status: "pending" })
        .mockResolvedValueOnce({ status: "pending", error: "a status read blip" })
        .mockResolvedValueOnce({ status: "COMPLETED", output: { url: "https://fal.media/r.mp4" } })
      await reconcileFalJob(rheaRow(), { claimant: "worker", pollToEnd: true })
      expect(mocks.fetchStatusMock).toHaveBeenCalledTimes(4)
      expect(mocks.bumpMock).not.toHaveBeenCalled()
      expect(mocks.claimMock).toHaveBeenCalledWith("j-rhea", "worker")
      expect(mocks.deliverMock).toHaveBeenCalledTimes(1)
      expect(mocks.finalizeMock).toHaveBeenCalledTimes(1)
      expect(mocks.finalizeMock).toHaveBeenCalledWith(expect.objectContaining({ jobId: "j-rhea", claimant: "worker" }))
    })

    it("waits out what is left of the original hour (no restamp needed), and a wait that reaches its end is left to the cron without an attempt", async () => {
      setUp(0, 20)
      // Each read takes 10 minutes: the hour from the stamp ends after four more reads.
      mocks.fetchStatusMock.mockImplementation(async () => { now += 10 * MIN; return { status: "pending" } })
      await reconcileFalJob(rheaRow(), { claimant: "worker", pollToEnd: true })
      expect(now).toBe(T0 + 60 * MIN)
      expect(stampUpdates).toHaveLength(0)
      expect(mocks.bumpMock).not.toHaveBeenCalled()
      expect(mocks.deliverMock).not.toHaveBeenCalled()
    })

    it("a re-pick near the hour's end still waits its least wait, and moves the stamp FIRST so the cron's threshold falls past it", async () => {
      const { TOPAZ_RHEA_REPICK_MIN_WAIT_MS, TOPAZ_RHEA_MAX_WAIT_MS } = await import("../../topaz-rhea-timeouts.js")
      const { STALE_THRESHOLD_MS } = await import("../types.js")
      setUp(0, 58)
      const readsAt: number[] = []
      mocks.fetchStatusMock.mockImplementation(async () => { readsAt.push(stampUpdates.length); now += MIN; return { status: "pending" } })
      await reconcileFalJob(rheaRow(), { claimant: "worker", pollToEnd: true })
      // The one-shot look took a minute: the wait is decided at minute 59, past the hour's end at 60 by less than the least wait.
      const deadline = T0 + 59 * MIN + TOPAZ_RHEA_REPICK_MIN_WAIT_MS
      expect(now).toBeGreaterThanOrEqual(deadline)
      // The stamp moved before the first wait-read (the first read is the one-shot look before the wait).
      expect(readsAt[0]).toBe(0)
      expect(readsAt[1]).toBe(1)
      const stamped = Date.parse(stampUpdates[0]!.patch.provider_call_started_at as string)
      expect(stamped).toBe(deadline - TOPAZ_RHEA_MAX_WAIT_MS)
      expect(stampUpdates[0]!.filters).toEqual(expect.arrayContaining([["id", "j-rhea"], ["provider_kind", "fal-rhea"]]))
      // If this second process dies too, the cron takes the row over past its wait.
      expect(stamped + STALE_THRESHOLD_MS["fal-rhea"]).toBeGreaterThan(deadline)
      expect(mocks.bumpMock).not.toHaveBeenCalled()
    })

    it("the cron (no pollToEnd) still reads a running request once and bumps, as before", async () => {
      setUp(0, 80)
      mocks.fetchStatusMock.mockResolvedValue({ status: "pending" })
      await reconcileFalJob(rheaRow())
      expect(mocks.fetchStatusMock).toHaveBeenCalledTimes(1)
      expect(mocks.bumpMock).toHaveBeenCalledTimes(1)
      expect(stampUpdates).toHaveLength(0)
    })

    it("only a Rhea row waits: a plain fal request re-picked while running is read once", async () => {
      setUp(0, 20)
      mocks.fetchStatusMock.mockResolvedValue({ status: "pending" })
      await reconcileFalJob(falRow(), { claimant: "worker", pollToEnd: true })
      expect(mocks.fetchStatusMock).toHaveBeenCalledTimes(1)
      expect(mocks.bumpMock).toHaveBeenCalledTimes(1)
    })
  })

  it("a sharp-mode upscale row is not this lane's: its endpoint is unresolvable here", async () => {
    await reconcileFalJob(falRow({ id: "j-sharp", job_type: "video-upscale", input_data: { provider: "nodaro-video-upscale", mode: "sharp" } }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
  })

  // Mirror reconcileReplicateJob's B1 guard: a COMPLETED-but-finalize-failure
  // must bump reconcile_attempts (exhaust→refund) rather than markFailed/refund
  // immediately or loop forever.
  it("COMPLETED but finalize throws → bumps attempts, no markFailed, no refund, no propagation", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))

    await expect(
      reconcileFalJob(falRow({ id: "j-fin-throw" })),
    ).resolves.toBeUndefined()

    expect(mocks.bumpMock).toHaveBeenCalledWith("j-fin-throw", expect.anything())
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })

  it("COMPLETED but extractFalUrl throws (bad output shape) → bumps attempts (terminal handled by exhaust path)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { foo: "bar" } })
    mocks.extractUrlMock.mockImplementationOnce(() => {
      throw new Error("Unexpected fal output shape")
    })
    await reconcileFalJob(falRow({ id: "j-badshape" }))
    expect(mocks.bumpMock).toHaveBeenCalledWith("j-badshape", expect.anything())
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  // Task 2 (app-reports W4): jobs.error_message is user-visible — it must never
  // carry raw provider text. The raw text belongs in error_detail (admin-only),
  // redacted through redactProviderDetail.
  it("ERROR → puts a user-safe sentence in error_message and the raw provider text in error_detail", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "ERROR",
      error: "model OOM https://fal.run/req/x?token=abc",
    })
    await reconcileFalJob(falRow({ id: "j-err-raw", provider_task_id: "req-err-raw" }))

    const update = lastJobsUpdate()
    expect(update.status).toBe("failed")
    expect(update.error_message).toBe("Generation failed on the provider. Please try again.")
    expect(update.error_message).not.toContain("model OOM")
    expect(update.error_detail).toContain("model OOM")
    expect(update.error_detail).not.toContain("token=abc")
  })

  // Task 4 fix round 1: pin fal.ts's new NOT_GENERIC_RECOVERABLE / isFinalizeJobType
  // guards (mirrors the kie.ts twins in kie.test.ts).
  describe("NOT_GENERIC_RECOVERABLE rows", () => {
    it("COMPLETED with job_type null → bumps with an 'unknown job_type' reason, no finalize", async () => {
      // Pins a deliberate behavior change: the old `?? "lip-sync"` fallback
      // cast is gone, so a null job_type no longer silently finalizes as
      // lip-sync — it bumps toward exhaustion instead.
      mocks.fetchStatusMock.mockResolvedValue({
        status: "COMPLETED",
        output: { url: "https://fal.media/null-type.mp4" },
      })
      await reconcileFalJob(falRow({ id: "j-null-type", job_type: null }))

      expect(mocks.bumpMock).toHaveBeenCalledWith("j-null-type", expect.stringMatching(/unknown job_type/))
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
    })

    it("COMPLETED with a denylisted job_type (character) → bumps with a named reason, no finalize", async () => {
      mocks.fetchStatusMock.mockResolvedValue({
        status: "COMPLETED",
        output: { url: "https://fal.media/character.mp4" },
      })
      await reconcileFalJob(falRow({ id: "j-character", job_type: "character" }))

      expect(mocks.bumpMock).toHaveBeenCalledWith(
        "j-character",
        expect.stringMatching(/not generically recoverable/),
      )
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
    })
  })
})
