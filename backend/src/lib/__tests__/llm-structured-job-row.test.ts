/**
 * The async structured-draft route's two row writes, which the route itself
 * may no longer make (it would have to import the service-role client —
 * `scripts/check-admin-client-import.mjs`). What must hold: both writes are
 * pinned to the caller's OWN row, the stamp carries the child id into both
 * the stored projection and `output_data`, and the discard refunds BEFORE it
 * deletes (a delete-first order would orphan a `reserved` hold).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  jobUpdate: vi.fn(),
  jobDelete: vi.fn(),
  eqId: vi.fn(),
  eqUser: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  order: [] as string[],
}))

vi.mock("../supabase.js", () => {
  // update({...}).eq("id", x).eq("user_id", y) / delete().eq(…).eq(…)
  const eqUser = (col: string, val: string) => {
    mocks.eqUser(col, val)
    return Promise.resolve({ data: null, error: null })
  }
  const eqId = (col: string, val: string) => {
    mocks.eqId(col, val)
    return { eq: eqUser }
  }
  return {
    supabase: {
      from: vi.fn((table: string) => ({
        update: (row: Record<string, unknown>) => { mocks.jobUpdate(table, row); return { eq: eqId } },
        delete: () => { mocks.jobDelete(table); mocks.order.push("delete"); return { eq: eqId } },
      })),
    },
  }
})
vi.mock("../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))

import { stampAnalysisChild, discardUnstartedJob } from "../llm-structured-job-row.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order = []
  mocks.refundReservedCreditsForJob.mockImplementation(async () => { mocks.order.push("refund"); return 1 })
})

describe("stampAnalysisChild", () => {
  it("writes the child id into the stored projection and opens output_data at the analyzing stage", async () => {
    await stampAnalysisChild("parent-1", "user-1", { type: "llm-structured", origin: "studio" }, "child-1")
    expect(mocks.jobUpdate).toHaveBeenCalledWith("jobs", {
      input_data: { type: "llm-structured", origin: "studio", analysisJobId: "child-1" },
      output_data: { stage: "analyzing", analysisJobId: "child-1" },
    })
  })
  it("never mutates the projection it was handed", async () => {
    const inputData = { type: "llm-structured" }
    await stampAnalysisChild("parent-1", "user-1", inputData, "child-1")
    expect(inputData).toEqual({ type: "llm-structured" })
  })
  it("scopes the update to the caller's own row", async () => {
    await stampAnalysisChild("parent-1", "user-1", {}, "child-1")
    expect(mocks.eqId).toHaveBeenCalledWith("id", "parent-1")
    expect(mocks.eqUser).toHaveBeenCalledWith("user_id", "user-1")
  })
})

describe("discardUnstartedJob", () => {
  it("refunds BEFORE deleting — the reserve path's own undo order", async () => {
    await discardUnstartedJob("parent-1", "user-1")
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
    expect(mocks.jobDelete).toHaveBeenCalledWith("jobs")
    expect(mocks.order).toEqual(["refund", "delete"])
  })
  it("scopes the delete to the caller's own row", async () => {
    await discardUnstartedJob("parent-1", "user-1")
    expect(mocks.eqId).toHaveBeenCalledWith("id", "parent-1")
    expect(mocks.eqUser).toHaveBeenCalledWith("user_id", "user-1")
  })
})
