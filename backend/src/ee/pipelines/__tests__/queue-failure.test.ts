/**
 * `settleUnqueuedPipeline` (ee/pipelines/queue-failure.ts): a new pipeline
 * whose first drive the queue refused is ended at once — nothing else would:
 * the reconcile cron reads only running/stopping pipelines and the queued
 * sweep only those a run lane parked. Failed from `queued` (a CAS: a drive
 * that claimed it meanwhile wins) with failure reason `queue_refused`, its
 * open stages failed, its reservation refunded last; a failure write that
 * fails is filed as an app report. The refund is confirmed by a read (the
 * helper behind it swallows its own errors): a reservation still held after it
 * is sent again once, then filed as an app report too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  pipelineStatus: "queued" as string,
  pipelineWriteError: null as { message: string } | null,
  pipelineWrites: [] as Array<{ patch: Record<string, unknown>; eqs: Array<[string, unknown]> }>,
  /** `pipelines.reservation_usage_log_id`: what the refund reads and clears. */
  reservationLink: "log-1" as string | null,
  /** `usage_logs.status` of that reservation. */
  logStatus: "reserved" as string,
  /** A read of the pipeline's reservation errors. */
  readError: false,
  refund: vi.fn(),
  publish: vi.fn(),
  insertAppReport: vi.fn(),
}))

vi.mock("../credits.js", () => ({ refundPipelineCredits: m.refund }))
vi.mock("../events.js", () => ({ pipelineEvents: { publish: m.publish } }))
vi.mock("../../../lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))

import { failWaitingPipeline, settleUnqueuedPipeline, UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND, UNQUEUED_PIPELINE_UNSETTLED_KIND } from "../queue-failure.js"

/** A client over one pipeline row and its stages (none open). */
function fakeSupabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (m.readError) return { data: null, error: { message: "read failed" } }
            if (table === "pipelines") return { data: { reservation_usage_log_id: m.reservationLink }, error: null }
            return { data: { status: m.logStatus }, error: null }
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        const eqs: Array<[string, unknown]> = []
        const q: Record<string, unknown> = {}
        q.eq = (col: string, val: unknown) => {
          eqs.push([col, val])
          return q
        }
        q.in = () => q
        q.select = async () => {
          if (table !== "pipelines") return { data: [], error: null }
          m.pipelineWrites.push({ patch, eqs })
          if (m.pipelineWriteError) return { data: null, error: m.pipelineWriteError }
          const status = eqs.find(([col]) => col === "status")?.[1]
          if (status !== m.pipelineStatus) return { data: [], error: null }
          m.pipelineStatus = String(patch.status)
          return { data: [{ id: "pipe-1" }], error: null }
        }
        return q
      },
    }),
  }
}

const settle = () =>
  settleUnqueuedPipeline({ supabase: fakeSupabase() as never, pipelineId: "pipe-1", userId: "u1", err: new Error("Connection is closed.") })

beforeEach(() => {
  vi.clearAllMocks()
  m.pipelineStatus = "queued"
  m.pipelineWriteError = null
  m.pipelineWrites = []
  m.reservationLink = "log-1"
  m.logStatus = "reserved"
  m.readError = false
  // The refund releases the reservation: it settles the usage log and clears the pipeline's link.
  m.refund.mockImplementation(async () => {
    m.logStatus = "refunded"
    m.reservationLink = null
  })
  m.insertAppReport.mockResolvedValue(true)
})

describe("settleUnqueuedPipeline", () => {
  it("fails a pipeline still queued with reason queue_refused (a CAS from queued) and refunds its reservation", async () => {
    expect(await settle()).toBe("failed")
    expect(m.pipelineWrites).toEqual([
      { patch: { status: "failed", failure_reason: "queue_refused" }, eqs: [["id", "pipe-1"], ["status", "queued"]] },
    ])
    expect(m.refund).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", pipelineId: "pipe-1", reason: "queue_refused" }))
    expect(m.publish).toHaveBeenCalledWith({ type: "pipeline:status", pipelineId: "pipe-1", status: "failed" })
  })

  it("a pipeline a drive already claimed (no longer queued) moved on: nothing refunded", async () => {
    m.pipelineStatus = "running"
    expect(await settle()).toBe("moved-on")
    expect(m.pipelineStatus).toBe("running")
    expect(m.refund).not.toHaveBeenCalled()
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a failure write that fails is unsettled: filed as an app report, nothing refunded", async () => {
    m.pipelineWriteError = { message: "connection reset" }
    expect(await settle()).toBe("unsettled")
    expect(m.refund).not.toHaveBeenCalled()
    expect(m.insertAppReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: UNQUEUED_PIPELINE_UNSETTLED_KIND, severity: "error", userId: "u1", payload: expect.objectContaining({ pipelineId: "pipe-1" }) }),
    )
  })
})

describe("the refund of a pipeline that never ran", () => {
  const failWaiting = () => failWaitingPipeline({ supabase: fakeSupabase() as never, pipelineId: "pipe-1", userId: "u1", reason: "queue_refused" })

  it("a confirmed refund (the reservation released) files nothing and sends the refund once", async () => {
    expect(await failWaiting()).toBe(true)
    expect(m.refund).toHaveBeenCalledTimes(1)
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a pipeline that never reserved has nothing to confirm: no report", async () => {
    m.reservationLink = null
    expect(await failWaiting()).toBe(true)
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a refund that swallowed its error (the reservation still held) is sent again once, then filed as an app report", async () => {
    m.refund.mockImplementation(async () => undefined)
    expect(await failWaiting()).toBe(true)
    expect(m.refund).toHaveBeenCalledTimes(2)
    expect(m.insertAppReport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND,
        severity: "error",
        userId: "u1",
        payload: expect.objectContaining({ pipelineId: "pipe-1", reason: "queue_refused" }),
      }),
    )
  })

  it("a refund that failed the first time and landed the second is confirmed: no report", async () => {
    m.refund.mockImplementationOnce(async () => undefined).mockImplementation(async () => {
      m.logStatus = "refunded"
      m.reservationLink = null
    })
    expect(await failWaiting()).toBe(true)
    expect(m.refund).toHaveBeenCalledTimes(2)
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a refund that threw is retried, and reported when it never lands", async () => {
    m.refund.mockRejectedValue(new Error("rpc down"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await failWaiting()).toBe(true)
    expect(m.refund).toHaveBeenCalledTimes(2)
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND }))
  })

  it("a read that fails cannot confirm the refund: reported, never thrown", async () => {
    m.readError = true
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await failWaiting()).toBe(true)
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND }))
  })

  it("the settle of a refused first drive reports the same way", async () => {
    m.refund.mockImplementation(async () => undefined)
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await settle()).toBe("failed")
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND }))
  })
})
