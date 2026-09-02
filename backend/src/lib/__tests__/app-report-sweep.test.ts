import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The failure sweeps: classify recent failed jobs (content rejections vs
 * everything else), sweep orchestrator-failed executions that produced no
 * failed job, dedupe against already-written reports, and insert one
 * app_report per newly-seen failure. The sweeps must never throw — a scan
 * error just returns zeros.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "@/lib/supabase.js"
import {
  excerptPrompt,
  rejectionReportFor,
  failureReportFor,
  executionFailureReportFor,
  sweepFailedJobs,
  sweepFailedExecutions,
} from "../app-report-sweep.js"

const REJECTED = {
  id: "job-1",
  error_message: "Content policy violation: The output was blocked by the provider's safety filter.",
  error_detail: null,
  user_id: "u1",
  provider: null,
  provider_kind: "kie-image",
  source: null,
  source_detail: null,
  completed_at: "2026-07-18T00:00:00Z",
  input_data: {
    model: "seedream-5-pro",
    type: "image-generate",
    prompt: "portrait of …",
    aspectRatio: "3:2",
    resolution: "2K",
    referenceImageUrls: ["https://cdn.nodaro.ai/a.png", "https://cdn.nodaro.ai/b.png"],
    imageUrl: "https://cdn.nodaro.ai/c.png",
    executionId: "exec-9",
    origin: "studio",
  },
}
const TIMEOUT = { ...REJECTED, id: "job-2", error_message: "Provider timeout after 30s" }

const FAILED_EXECUTION = {
  id: "exec-1",
  workflow_id: "wf-1",
  user_id: "u1",
  status: "failed",
  trigger_type: "manual",
  error_message: "Unknown node type: loop-subject",
  node_states: { node_3: { status: "failed", error: "Unknown node type: loop-subject" } },
  completed_at: "2026-07-18T00:00:00Z",
}

/** Chainable+thenable stub in the house style (admin-client-apps.test.ts). */
function chain(result: Record<string, unknown>) {
  const obj: Record<string, any> = {}
  for (const m of ["select", "eq", "gte", "in", "order", "limit", "insert"]) obj[m] = vi.fn(() => obj)
  obj.then = (resolve: (v: unknown) => void) => Promise.resolve({ error: null, ...result }).then(resolve)
  return obj
}

beforeEach(() => vi.mocked(supabase.from).mockReset())

describe("sweepFailedJobs", () => {
  it("classifies every failed job: content rejections vs job failures", async () => {
    const jobsChain = chain({ data: [REJECTED, TIMEOUT] })
    const reportsChain = chain({ data: [] })
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => (table === "jobs" ? jobsChain : reportsChain) as never,
    )

    const { scanned, reported } = await sweepFailedJobs()
    expect(scanned).toBe(2)
    expect(reported).toBe(2)
    expect(reportsChain.insert).toHaveBeenCalledTimes(2)
    expect(reportsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "model-rejection",
        node: "rejection-sweep",
        severity: "warning",
        job_id: "job-1",
        user_id: "u1",
      }),
    )
    expect(reportsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "job-failure",
        node: "failure-sweep",
        severity: "error",
        job_id: "job-2",
        user_id: "u1",
      }),
    )
  })

  it("skips jobs that already have a report of either job-derived kind", async () => {
    const jobsChain = chain({ data: [REJECTED, TIMEOUT] })
    const reportsChain = chain({ data: [{ job_id: "job-1" }, { job_id: "job-2" }] })
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => (table === "jobs" ? jobsChain : reportsChain) as never,
    )

    const { reported } = await sweepFailedJobs()
    expect(reported).toBe(0)
    expect(reportsChain.insert).not.toHaveBeenCalled()
  })

  it("returns zeros (and doesn't throw) when the scan fails", async () => {
    const jobsChain = chain({ data: null, error: { message: "boom" } })
    vi.mocked(supabase.from).mockImplementation(() => jobsChain as never)

    await expect(sweepFailedJobs()).resolves.toEqual({ scanned: 0, reported: 0 })
  })
})

describe("sweepFailedExecutions", () => {
  function dispatch(execChain: any, jobsChain: any, reportsChain: any) {
    vi.mocked(supabase.from).mockImplementation(
      ((table: string) =>
        table === "workflow_executions" ? execChain : table === "jobs" ? jobsChain : reportsChain) as never,
    )
  }

  it("reports executions that failed with no failed job (never reached a provider)", async () => {
    const execChain = chain({ data: [FAILED_EXECUTION] })
    const jobsChain = chain({ data: [] })
    const reportsChain = chain({ data: [] })
    dispatch(execChain, jobsChain, reportsChain)

    const { scanned, reported } = await sweepFailedExecutions()
    expect(scanned).toBe(1)
    expect(reported).toBe(1)
    expect(reportsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "execution-failure",
        node: "execution-sweep",
        severity: "error",
        execution_id: "exec-1",
        user_id: "u1",
      }),
    )
  })

  it("skips executions whose failure is already covered by a failed job", async () => {
    const execChain = chain({ data: [FAILED_EXECUTION] })
    const jobsChain = chain({ data: [{ workflow_execution_id: "exec-1" }] })
    const reportsChain = chain({ data: [] })
    dispatch(execChain, jobsChain, reportsChain)

    const { reported } = await sweepFailedExecutions()
    expect(reported).toBe(0)
    expect(reportsChain.insert).not.toHaveBeenCalled()
  })

  it("skips executions already reported", async () => {
    const execChain = chain({ data: [FAILED_EXECUTION] })
    const jobsChain = chain({ data: [] })
    const reportsChain = chain({ data: [{ execution_id: "exec-1" }] })
    dispatch(execChain, jobsChain, reportsChain)

    const { reported } = await sweepFailedExecutions()
    expect(reported).toBe(0)
    expect(reportsChain.insert).not.toHaveBeenCalled()
  })

  it("returns zeros (and doesn't throw) when the scan fails", async () => {
    const execChain = chain({ data: null, error: { message: "boom" } })
    vi.mocked(supabase.from).mockImplementation(() => execChain as never)

    await expect(sweepFailedExecutions()).resolves.toEqual({ scanned: 0, reported: 0 })
  })
})

const COPYRIGHT = {
  ...TIMEOUT,
  id: "job-3",
  error_message:
    "The provider declined this generation: the output may resemble protected (copyrighted) content. Rephrasing the prompt usually resolves this.",
  error_detail: "task failed: [400] output video may be related to copyright restrictions",
}

describe("report builders", () => {
  it("rejectionReportFor builds the report payload from the jobs row", () => {
    const report = rejectionReportFor(REJECTED)
    expect(report.title).toContain("seedream-5-pro")
    expect(report.payload).toMatchObject({
      model: "seedream-5-pro",
      jobType: "image-generate",
      provider: "kie-image",
      prompt: "portrait of …",
    })
  })

  it("failureReportFor carries the error, provider and source provenance", () => {
    const report = failureReportFor({
      ...TIMEOUT,
      provider: "elevenlabs",
      input_data: { type: "text-to-speech", provider: "eleven-v3" },
      source: "mcp",
      source_detail: "Claude",
    })
    expect(report.title).toBe("eleven-v3 failed: Provider timeout after 30s")
    expect(report.payload).toMatchObject({
      provider: "elevenlabs",
      source: "mcp",
      sourceDetail: "Claude",
      error: "Provider timeout after 30s",
    })
    expect(report.jobId).toBe("job-2")
  })

  it("executionFailureReportFor extracts failed nodes and keys by execution", () => {
    const report = executionFailureReportFor(FAILED_EXECUTION)
    expect(report.title).toContain("Unknown node type: loop-subject")
    expect(report.executionId).toBe("exec-1")
    expect(report.payload).toMatchObject({
      workflowId: "wf-1",
      trigger: "manual",
      failedNodes: [{ nodeId: "node_3", error: "Unknown node type: loop-subject" }],
    })
  })

  it("executionFailureReportFor titles timeouts distinctly", () => {
    const report = executionFailureReportFor({ ...FAILED_EXECUTION, status: "timed_out", error_message: null })
    expect(report.title).toBe("Workflow execution timed out")
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

  it("both payloads carry the fixed params subset, never the URLs themselves", () => {
    const report = failureReportFor(REJECTED)
    expect(report.payload!.params).toEqual({
      aspectRatio: "3:2",
      resolution: "2K",
      referenceImageUrls: 2,
      imageUrl: true,
      executionId: "exec-9",
      origin: "studio",
    })
    expect(JSON.stringify(report.payload)).not.toContain("cdn.nodaro.ai/a.png")
    expect(report.payload!.providerKind).toBe("kie-image")
    expect(report.payload!.errorDetail).toBeNull()
  })

  it("a copyright message is a model-rejection with rejectionClass and provenance", async () => {
    const jobsChain = chain({ data: [COPYRIGHT] })
    const reportsChain = chain({ data: [] })
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => (table === "jobs" ? jobsChain : reportsChain) as never,
    )
    await sweepFailedJobs()
    expect(reportsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "model-rejection",
        payload: expect.objectContaining({
          rejectionClass: "copyright",
          errorDetail: "task failed: [400] output video may be related to copyright restrictions",
          source: null,
          sourceDetail: null,
        }),
      }),
    )
  })

  it("the sweep selects error_detail from jobs", async () => {
    const jobsChain = chain({ data: [] })
    vi.mocked(supabase.from).mockImplementation(() => jobsChain as never)
    await sweepFailedJobs()
    expect(jobsChain.select).toHaveBeenCalledWith(expect.stringContaining("error_detail"))
  })
})
