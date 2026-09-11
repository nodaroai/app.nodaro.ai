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
  /** What `select(…).eq(…).eq(…).maybeSingle()` answers. */
  read: vi.fn(),
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
  const selectEqUser = (col: string, val: string) => {
    mocks.eqUser(col, val)
    return { maybeSingle: async () => mocks.read() }
  }
  const selectEqId = (col: string, val: string) => {
    mocks.eqId(col, val)
    return { eq: selectEqUser }
  }
  return {
    supabase: {
      from: vi.fn((table: string) => ({
        update: (row: Record<string, unknown>) => { mocks.jobUpdate(table, row); return { eq: eqId } },
        delete: () => { mocks.jobDelete(table); mocks.order.push("delete"); return { eq: eqId } },
        select: () => ({ eq: selectEqId }),
      })),
    },
  }
})
vi.mock("../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))

import { stampAnalysisChild, discardUnstartedJob, readOwnAnalysisChild } from "../llm-structured-job-row.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order = []
  mocks.refundReservedCreditsForJob.mockImplementation(async () => { mocks.order.push("refund"); return 1 })
})

describe("stampAnalysisChild", () => {
  it("writes the child id into the stored projection and opens output_data at the analyzing stage", async () => {
    await stampAnalysisChild("parent-1", "user-1", { type: "llm-structured", origin: "studio" }, { analysisJobId: "child-1" })
    expect(mocks.jobUpdate).toHaveBeenCalledWith("jobs", {
      input_data: { type: "llm-structured", origin: "studio", analysisJobId: "child-1" },
      output_data: { stage: "analyzing", analysisJobId: "child-1" },
    })
  })
  it("carries the child's price into BOTH halves — input_data survives every output_data rewrite", async () => {
    await stampAnalysisChild("parent-1", "user-1", { type: "llm-structured" }, { analysisJobId: "child-1", analysisCredits: 60 })
    expect(mocks.jobUpdate).toHaveBeenCalledWith("jobs", {
      input_data: { type: "llm-structured", analysisJobId: "child-1", analysisCredits: 60 },
      output_data: { stage: "analyzing", analysisJobId: "child-1", analysisCredits: 60 },
    })
  })
  it("a REUSED child opens at the drafting stage, marked, and prices nothing", async () => {
    await stampAnalysisChild("parent-1", "user-1", { type: "llm-structured" }, { analysisJobId: "child-1", reused: true })
    expect(mocks.jobUpdate).toHaveBeenCalledWith("jobs", {
      input_data: { type: "llm-structured", analysisJobId: "child-1", analysisReused: true },
      output_data: { stage: "drafting", analysisJobId: "child-1" },
    })
  })
  it("never mutates the projection it was handed", async () => {
    const inputData = { type: "llm-structured" }
    await stampAnalysisChild("parent-1", "user-1", inputData, { analysisJobId: "child-1" })
    expect(inputData).toEqual({ type: "llm-structured" })
  })
  it("scopes the update to the caller's own row", async () => {
    await stampAnalysisChild("parent-1", "user-1", {}, { analysisJobId: "child-1" })
    expect(mocks.eqId).toHaveBeenCalledWith("id", "parent-1")
    expect(mocks.eqUser).toHaveBeenCalledWith("user_id", "user-1")
  })
})

describe("readOwnAnalysisChild", () => {
  it("reads the caller's OWN row — pinned by id AND user — and answers it", async () => {
    const row = { id: "a-1", job_type: "video-analysis", status: "completed", output_data: { json: {} }, credits: 60 }
    mocks.read.mockResolvedValue({ data: row, error: null })
    await expect(readOwnAnalysisChild("a-1", "user-1")).resolves.toEqual(row)
    expect(mocks.eqId).toHaveBeenCalledWith("id", "a-1")
    expect(mocks.eqUser).toHaveBeenCalledWith("user_id", "user-1")
  })
  it("missing and foreign are the same null (no ownership oracle); a read FAILURE throws instead", async () => {
    mocks.read.mockResolvedValue({ data: null, error: null })
    await expect(readOwnAnalysisChild("a-1", "user-1")).resolves.toBeNull()
    mocks.read.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(readOwnAnalysisChild("a-1", "user-1")).rejects.toThrow("boom")
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
