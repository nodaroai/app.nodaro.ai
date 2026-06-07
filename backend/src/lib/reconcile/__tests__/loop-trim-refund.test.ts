import { describe, it, expect, vi, beforeEach } from "vitest"

// refundLoopTrimAddon lives in workers/shared.js (heavy deps); the helper
// lazy-imports it. Mock the whole module so the test stays light + asserts the call.
const { refundMock, fromMock } = vi.hoisted(() => ({
  refundMock: vi.fn().mockResolvedValue(undefined),
  fromMock: vi.fn(),
}))
vi.mock("../../../workers/shared.js", () => ({ refundLoopTrimAddon: refundMock }))
vi.mock("../../supabase.js", () => ({ supabase: { from: fromMock } }))

import { refundLoopTrimAddonOnReconcile } from "../loop-trim-refund.js"

/** Build a chainable stub for `supabase.from("jobs").select().eq().maybeSingle()`. */
function stubJobsQuery(result: { data: unknown }) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  return chain
}

describe("refundLoopTrimAddonOnReconcile", () => {
  beforeEach(() => vi.clearAllMocks())

  it("refunds the add-on for a SINGLE-NODE i2v job, resolving usageLogId from jobs.usage_log_id", async () => {
    // Regression: input_data has NO usageLogId — nothing writes it there. The id
    // MUST come from jobs.usage_log_id, or the refund is dead code (over-charge).
    fromMock.mockReturnValue(
      stubJobsQuery({ data: { workflow_execution_id: null, usage_log_id: "ul-1" } }),
    )
    await refundLoopTrimAddonOnReconcile("image-to-video", "job-1", {
      loopTrim: { enabled: true, framesToTest: 16 },
      duration: 8,
    })
    // addon = ceil(8/5) + ceil(16/24) = 2 + 1 = 3
    expect(fromMock).toHaveBeenCalledWith("jobs")
    expect(refundMock).toHaveBeenCalledWith("job-1", "ul-1", 3)
  })

  it("does NOT refund for an ORCHESTRATED job (addon was never reserved → would under-charge)", async () => {
    // Orchestrated i2v reserves base-only (payload-builder adds no loop-trim addon),
    // so refunding the addon here would under-charge by the addon.
    fromMock.mockReturnValue(
      stubJobsQuery({ data: { workflow_execution_id: "exec-1", usage_log_id: "ul-1" } }),
    )
    await refundLoopTrimAddonOnReconcile("image-to-video", "job-1", {
      loopTrim: { enabled: true, framesToTest: 16 },
      duration: 8,
    })
    expect(refundMock).not.toHaveBeenCalled()
  })

  it("no-ops when the job has no reserved usage_log id", async () => {
    fromMock.mockReturnValue(
      stubJobsQuery({ data: { workflow_execution_id: null, usage_log_id: null } }),
    )
    await refundLoopTrimAddonOnReconcile("image-to-video", "job-1", {
      loopTrim: { enabled: true, framesToTest: 16 },
      duration: 8,
    })
    expect(refundMock).not.toHaveBeenCalled()
  })

  it("no-ops for a non-i2v job (without even querying jobs)", async () => {
    await refundLoopTrimAddonOnReconcile("generate-image", "job-1", {
      loopTrim: { enabled: true },
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(refundMock).not.toHaveBeenCalled()
  })

  it("no-ops when loopTrim is disabled or absent", async () => {
    await refundLoopTrimAddonOnReconcile("image-to-video", "j", { loopTrim: { enabled: false } })
    await refundLoopTrimAddonOnReconcile("image-to-video", "j", {})
    await refundLoopTrimAddonOnReconcile("image-to-video", "j", null)
    expect(fromMock).not.toHaveBeenCalled()
    expect(refundMock).not.toHaveBeenCalled()
  })
})
