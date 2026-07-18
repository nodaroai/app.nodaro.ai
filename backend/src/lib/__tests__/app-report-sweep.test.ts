import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The model-rejection sweep: classify recent failed jobs, dedupe against
 * already-written reports, and insert one 'model-rejection' app_report per
 * newly-seen rejected job. The sweep must never throw — a scan error just
 * returns zeros.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "@/lib/supabase.js"
import { excerptPrompt, rejectionReportFor, sweepModelRejections } from "../app-report-sweep.js"

const REJECTED = {
  id: "job-1",
  error_message: "Content policy violation: The output was blocked by the provider's safety filter.",
  user_id: "u1",
  provider_kind: "kie-image",
  completed_at: "2026-07-18T00:00:00Z",
  input_data: { model: "seedream-5-pro", type: "image-generate", prompt: "portrait of …" },
}
const TIMEOUT = { ...REJECTED, id: "job-2", error_message: "Provider timeout after 30s" }

/** Chainable+thenable stub in the house style (admin-client-apps.test.ts). */
function chain(result: Record<string, unknown>) {
  const obj: Record<string, any> = {}
  for (const m of ["select", "eq", "gte", "in", "order", "limit", "insert"]) obj[m] = vi.fn(() => obj)
  obj.then = (resolve: (v: unknown) => void) => Promise.resolve({ error: null, ...result }).then(resolve)
  return obj
}

beforeEach(() => vi.mocked(supabase.from).mockReset())

describe("sweepModelRejections", () => {
  it("reports only content-rejected jobs not already reported", async () => {
    const jobsChain = chain({ data: [REJECTED, TIMEOUT] })
    const reportsChain = chain({ data: [] })
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => (table === "jobs" ? jobsChain : reportsChain) as never,
    )

    const { scanned, reported } = await sweepModelRejections()
    expect(scanned).toBe(2)
    expect(reported).toBe(1)
    // The one insert is for the rejected job, in app_reports shape.
    expect(reportsChain.insert).toHaveBeenCalledTimes(1)
    expect(reportsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "model-rejection",
        node: "rejection-sweep",
        severity: "warning",
        job_id: "job-1",
        user_id: "u1",
      }),
    )
  })

  it("skips jobs that already have a model-rejection report", async () => {
    const jobsChain = chain({ data: [REJECTED] })
    const reportsChain = chain({ data: [{ job_id: "job-1" }] })
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => (table === "jobs" ? jobsChain : reportsChain) as never,
    )

    const { reported } = await sweepModelRejections()
    expect(reported).toBe(0)
    expect(reportsChain.insert).not.toHaveBeenCalled()
  })

  it("returns zeros (and doesn't throw) when the scan fails", async () => {
    const jobsChain = chain({ data: null, error: { message: "boom" } })
    vi.mocked(supabase.from).mockImplementation(() => jobsChain as never)

    await expect(sweepModelRejections()).resolves.toEqual({ scanned: 0, reported: 0 })
  })
})

describe("rejectionReportFor / excerptPrompt", () => {
  it("builds the report payload from the jobs row", () => {
    const report = rejectionReportFor(REJECTED)
    expect(report.title).toContain("seedream-5-pro")
    expect(report.payload).toMatchObject({
      model: "seedream-5-pro",
      jobType: "image-generate",
      provider: "kie-image",
      prompt: "portrait of …",
    })
  })

  it("prefers the mirrored userPrompt and caps length", () => {
    expect(excerptPrompt({ userPrompt: "original", prompt: "derived" })).toBe("original")
    expect(excerptPrompt({ prompt: "x".repeat(5000) })).toHaveLength(1000)
    expect(excerptPrompt(null)).toBeNull()
    expect(excerptPrompt({})).toBeNull()
  })

  it("falls back to the job type when input_data has no model", () => {
    const report = rejectionReportFor({ ...REJECTED, input_data: { type: "video-generate" } })
    expect(report.title).toContain("video-generate")
  })

  it("reads character-asset jobs' model from the legacy `provider` key and attributes origin", () => {
    const report = rejectionReportFor({
      ...REJECTED,
      input_data: { type: "generate-character", provider: "nano-banana", origin: "person" },
    })
    expect(report.title).toContain("nano-banana")
    expect(report.appSlug).toBe("person")
    expect(report.payload).toMatchObject({ model: "nano-banana" })
  })
})
