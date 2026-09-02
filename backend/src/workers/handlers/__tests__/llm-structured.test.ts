/**
 * The async structured-draft handler. Guarantees:
 *   - a story run drafts the caller's input verbatim and completes with the
 *     output + usage, then commits the reservation (the sync route's exact
 *     lifecycle);
 *   - a movie run waits for the child, mirrors its progress into the
 *     analysis band, writes stage "drafting", composes caller text + the
 *     COMPACT stripped analysis, and carries analysisJobId + analysisCredits
 *     on the finished row;
 *   - a failed / cancelled / unreadable child fails the parent with a reason;
 *   - a failed READ of the child is retried, never reported as absence;
 *   - a cancelled parent stops waiting;
 *   - a lost completion CAS never commits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  markJobCompleted: vi.fn(),
  setJobProgress: vi.fn(async () => {}),
  commitReservedCreditsForJob: vi.fn(async () => {}),
  markProviderCallStart: vi.fn(async () => {}),
  throwIfJobCancelled: vi.fn(async () => {}),
  prepareStructuredRequest: vi.fn(),
  runStructuredCompletion: vi.fn(),
  jobUpdate: vi.fn(),
  jobRead: vi.fn(),
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return { ...actual, markJobCompleted: mocks.markJobCompleted, setJobProgress: mocks.setJobProgress }
})
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: mocks.commitReservedCreditsForJob }))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("../../../lib/job-cancellation.js", () => ({ throwIfJobCancelled: mocks.throwIfJobCancelled }))
vi.mock("../../../lib/llm-structured-request.js", () => ({
  prepareStructuredRequest: mocks.prepareStructuredRequest,
  runStructuredCompletion: mocks.runStructuredCompletion,
}))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      // select("…").eq("id", x).single() → the child row
      select: () => ({ eq: () => ({ single: async () => ({ data: mocks.jobRead(), error: null }) }) }),
      // update({...}).eq("id", x) → the stage write
      update: (row: Record<string, unknown>) => { mocks.jobUpdate(row); return { eq: async () => ({ data: null, error: null }) } },
    })),
  },
}))

import { composeAnalysisInput, handleLlmStructured, waitForAnalysis, ANALYSIS_WAIT_BUDGET_MS } from "../llm-structured.js"
import { stripDerivedAnalysisFields, videoAnalysisResultSchema } from "@nodaro/shared"

const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
const analysis = {
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Clip" },
  slots: [{ slotId: "hero", label: "Hero", source: "wired-character", role: "person", description: "tan man" }],
  // Keys in the SCHEMA's own shape order (windowSceneBase, then the
  // analyzedSceneSchema extension): the handler composes from the zod
  // PARSED analysis, which re-emits keys in shape order, and the movie-run
  // test compares the composed string byte-for-byte.
  scenes: [{ startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "push-in", visual: "{slot:hero} waves", audio: [], sceneNumber: 1, visualResolved: "Hero waves", slotRefs: ["hero"] }],
  warnings: ["one"],
}
const base = { jobId: "parent-1", usageLogId: "usage-1", system: "SYS", input: "Draft this.", jsonSchema: SCHEMA, maxRetries: 2 }
const job = (data: Record<string, unknown>) => ({ id: "bull-1", data, updateProgress: vi.fn() }) as never
const ctx = { jobId: "parent-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const prepared = { ok: true as const, model: { id: "m" }, schema: {}, modelIdentifier: "llm-structured:premium" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareStructuredRequest.mockReturnValue(prepared)
  mocks.runStructuredCompletion.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 10, outputTokens: 5 })
  mocks.markJobCompleted.mockResolvedValue(true)
})

describe("fixture", () => {
  it("is a real analysis result — every test below depends on it validating", () => {
    // On a vocabulary miss (source / shotType / angle enums) fix THIS fixture
    // against packages/shared/src/video-analysis.ts, never an assertion.
    expect(videoAnalysisResultSchema.safeParse(analysis).success).toBe(true)
  })
})

describe("composeAnalysisInput", () => {
  it("appends the COMPACT stripped analysis after a blank line", () => {
    const out = composeAnalysisInput("Draft this.", analysis as never)
    expect(out.startsWith("Draft this.\n\n{")).toBe(true)
    expect(out).toBe(`Draft this.\n\n${JSON.stringify(stripDerivedAnalysisFields(analysis))}`)
    expect(out).not.toContain("visualResolved")
    expect(out).not.toContain("warnings")
    expect(out).not.toContain("\n  ")
  })
})

describe("waitForAnalysis", () => {
  const row = (extra: Record<string, unknown>) => ({ status: "processing", progress: 0, output_data: null, error_message: null, user_id: "user-1", credits: null, ...extra })
  // An `Error` entry is a REJECTED read (a transient PostgREST failure), a
  // `null` entry a genuinely missing row — the two must not behave alike.
  const deps = (rows: Array<ReturnType<typeof row> | Error | null>) => {
    const queue = [...rows]
    let t = 0
    const readJob = async () => {
      const next = queue.shift() ?? null
      if (next instanceof Error) throw next
      return next
    }
    return {
      deps: { readJob, onProgress: vi.fn(async () => {}), sleep: async (ms: number) => { t += ms }, now: () => t },
      clock: () => t,
    }
  }
  it("mirrors progress into the analysis band and returns the validated json + credits when the child completes", async () => {
    const d = deps([row({ progress: 50 }), row({ status: "completed", progress: 100, output_data: { json: analysis }, credits: 60 })])
    const out = await waitForAnalysis("child-1", "user-1", d.deps)
    expect(out.credits).toBe(60)
    expect(out.analysis.scenes).toHaveLength(1)
    expect(d.deps.onProgress).toHaveBeenCalledWith(35) // 50% of the 0–70 band
    expect(mocks.throwIfJobCancelled).toHaveBeenCalled()
  })
  it("fails with the child's reason on failed / cancelled, on a foreign row, on an unreadable result, and on the budget", async () => {
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "failed", error_message: "Provider said no" })]).deps)).rejects.toThrow("Video analysis failed: Provider said no")
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "cancelled" })]).deps)).rejects.toThrow("Video analysis cancelled")
    await expect(waitForAnalysis("c", "user-1", deps([row({ user_id: "someone-else" })]).deps)).rejects.toThrow("not found")
    await expect(waitForAnalysis("c", "user-1", deps([row({ status: "completed", output_data: { json: { nope: true } } })]).deps)).rejects.toThrow("readable")
    const forever = deps(Array.from({ length: 400 }, () => row({})))
    await expect(waitForAnalysis("c", "user-1", forever.deps)).rejects.toThrow("did not finish")
    expect(forever.clock()).toBeGreaterThanOrEqual(ANALYSIS_WAIT_BUDGET_MS)
  })
  it("retries a failed READ and still returns the analysis when a later tick answers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const d = deps([new Error("fetch failed"), new Error("fetch failed"), row({ status: "completed", progress: 100, output_data: { json: analysis }, credits: 60 })])
    const out = await waitForAnalysis("child-1", "user-1", d.deps)
    expect(out.credits).toBe(60)
    expect(out.analysis.scenes).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[worker] analysis read failed for child-1"), expect.any(Error))
    warn.mockRestore()
  })
  it("a read that never succeeds ends on the BUDGET — never on 'not found' (which would refund a live child)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const forever = deps(Array.from({ length: 400 }, () => new Error("fetch failed")))
    await expect(waitForAnalysis("c", "user-1", forever.deps)).rejects.toThrow("did not finish")
    expect(forever.clock()).toBeGreaterThanOrEqual(ANALYSIS_WAIT_BUDGET_MS)
    warn.mockRestore()
  })
  it("stops when the PARENT is cancelled", async () => {
    mocks.throwIfJobCancelled.mockRejectedValueOnce(new Error("Job parent-1 was cancelled"))
    await expect(waitForAnalysis("c", "user-1", deps([row({})]).deps)).rejects.toThrow("cancelled")
  })
})

describe("handleLlmStructured", () => {
  it("story run: drafts the input verbatim, completes with output + usage, commits", async () => {
    await handleLlmStructured(job(base), ctx)
    expect(mocks.runStructuredCompletion).toHaveBeenCalledWith(expect.objectContaining({ system: "SYS" }), prepared, "Draft this.")
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ output_data: { stage: "drafting" } })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("parent-1", { output_data: { output: { title: "Rain" }, inputTokens: 10, outputTokens: 5 } })
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
    expect(mocks.markProviderCallStart).not.toHaveBeenCalledWith("parent-1", "anthropic-sync")
  })
  it("movie run: waits for the child, composes, writes stage drafting with the child id, carries analysisJobId + analysisCredits", async () => {
    mocks.jobRead.mockReturnValue({ status: "completed", progress: 100, output_data: { json: analysis }, error_message: null, user_id: "user-1", credits: 60 })
    await handleLlmStructured(job({ ...base, analysisJobId: "child-1" }), ctx)
    const input = mocks.runStructuredCompletion.mock.calls[0][2] as string
    expect(input).toBe(composeAnalysisInput("Draft this.", analysis as never))
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ output_data: { stage: "drafting", analysisJobId: "child-1" } })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("parent-1", {
      output_data: { output: { title: "Rain" }, inputTokens: 10, outputTokens: 5, analysisJobId: "child-1", analysisCredits: 60 },
    })
  })
  it("a pre-flight refusal at run time fails the job with its message (no completion, no commit)", async () => {
    mocks.prepareStructuredRequest.mockReturnValue({ ok: false, status: 400, error: { code: "validation_error", message: "Unknown llmModel" } })
    await expect(handleLlmStructured(job(base), ctx)).rejects.toThrow("Unknown llmModel")
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
  it("never commits when the completion CAS loses (cancelled mid-flight)", async () => {
    mocks.markJobCompleted.mockResolvedValue(false)
    await handleLlmStructured(job(base), ctx)
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})
