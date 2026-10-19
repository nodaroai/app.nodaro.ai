// @test-units-by-name drives only the episode-chapters and tighten-episode nodes it names
/**
 * A use-case run whose result is text (Chapters): the canvas's own run lands
 * the show notes on `generatedText` and the chapter list on `generatedJson` —
 * what the server reads off a saved Chapters node — through the one
 * `runWrapper` the episode lane uses too (it keeps the wrapper for Continue and
 * a failed run's finished steps). The run is followed by its own poller
 * (use-case-text-poll.ts), driven here for real against a scripted job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LocaleId } from "@nodaro/shared/i18n"

const store = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; type: string; data: Record<string, unknown> }>, updateNodeData: vi.fn() }))
const api = vi.hoisted(() => ({ runUseCase: vi.fn(), getJobStatus: vi.fn(), continueUseCase: vi.fn(), getJobStatusLean: vi.fn(), cancelJob: vi.fn(), getExecutionEstimate: vi.fn() }))
const poll = vi.hoisted(() => ({ pollJobWithNodeUpdate: vi.fn() }))
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: store.nodes,
      updateNodeData: (id: string, patch: Record<string, unknown>) => {
        store.updateNodeData(id, patch)
        store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      },
    }),
  },
}))
vi.mock("@/lib/api", () => api)
vi.mock("sonner", () => ({ toast: toasts }))
vi.mock("../poll-job", async (orig) => ({
  ...(await orig<typeof import("../poll-job")>()),
  pollJobWithNodeUpdate: poll.pollJobWithNodeUpdate,
}))

import { executeUseCase, USE_CASE_TEXT_LONG_RUN_MS } from "../use-case-executor"
import { USE_CASE_TEXT_POLL_MS, USE_CASE_TEXT_SLOW_POLL_MS } from "../use-case-text-poll"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { localizeNodeLabel } from "@/lib/i18n/labels"

const USER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000c1"
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }
const NOTES = "0:00 Intro\n12:34 Main"
const ROWS = [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }]
const LOCALES: readonly LocaleId[] = ["en", "he", "ja", "ko", "pt-BR"]

let stale = false
function makeCtx(signal?: AbortSignal) {
  return {
    userId: USER,
    signal,
    isWorkflowStale: () => stale,
    trackInterval: (i: ReturnType<typeof setInterval>) => i,
    untrackInterval: (i: ReturnType<typeof setInterval>) => clearInterval(i),
  } as never
}

function chaptersNode(data: Record<string, unknown> = {}) {
  const node = { id: "c1", type: "episode-chapters", position: { x: 0, y: 0 }, data: { label: "Chapters", fieldMappings: {}, planTier: "economy", ...data } }
  store.nodes = [node]
  return node
}
const dataNow = () => store.nodes[0]!.data

/** The job's answers, one per poll; the last one repeats. */
function jobAnswers(...answers: Array<Record<string, unknown>>) {
  let i = 0
  api.getJobStatusLean.mockImplementation(async () => answers[Math.min(i++, answers.length - 1)])
}

/** Run the node to its end, ticking the poller's timer. */
async function run(node: unknown, ctx = makeCtx()) {
  const p = executeUseCase(node as never, REC as never, ctx)
  p.catch(() => {})
  for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_POLL_MS)
  return p
}

beforeEach(() => {
  vi.useFakeTimers()
  stale = false
  store.updateNodeData.mockReset()
  api.runUseCase.mockReset().mockResolvedValue({ jobId: JOB })
  api.getJobStatus.mockReset()
  api.getJobStatusLean.mockReset()
  api.cancelJob.mockReset().mockResolvedValue({ success: true })
  poll.pollJobWithNodeUpdate.mockReset()
  Object.values(toasts).forEach((t) => t.mockReset())
})

afterEach(() => {
  vi.useRealTimers()
  useLocaleStore.setState({ locale: "en" })
})

describe("Chapters on the canvas: a text result", () => {
  it("lands the show notes and the chapter list, keeps the wrapper, writes progress, and hands the show notes on — never the episode lane", async () => {
    jobAnswers({ status: "processing", progress: 40 }, { status: "completed", output_data: { text: NOTES, json: ROWS, transcript: { words: [] }, _executionId: "exec-1" } })
    const node = chaptersNode({ generatedText: "0:00 Older", generatedJson: [{ startMs: 0, title: "Older" }] })
    expect(await run(node)).toBe(NOTES)
    expect(api.runUseCase).toHaveBeenCalledWith("episode-chapters", expect.objectContaining({ mediaUrls: ["https://r2/ep.mp4"], settings: { planTier: "economy", instructions: undefined, styleGuide: undefined } }), undefined)
    expect(poll.pollJobWithNodeUpdate).not.toHaveBeenCalled()
    expect(store.updateNodeData).toHaveBeenCalledWith("c1", { currentJobProgress: 40 })
    expect(dataNow()).toMatchObject({
      executionStatus: "completed",
      generatedText: NOTES,
      generatedJson: ROWS,
      generatedTranscript: { words: [] },
      useCaseJobId: JOB,
      useCaseExecutionId: "exec-1",
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    // The run start clears the previous run's result first.
    expect(store.updateNodeData.mock.calls[0]![1]).toMatchObject({ executionStatus: "running", generatedText: undefined, generatedJson: undefined })
  })

  it("a failed run shows its failure, keeps its wrapper for Continue and the transcript it finished", async () => {
    jobAnswers({ status: "failed", error_message: "Edit Plan: the planner timed out" })
    api.getJobStatus.mockResolvedValue({ status: "failed", output_data: { transcript: { words: [1] } } })
    const node = chaptersNode()
    await expect(run(node)).rejects.toThrow("the planner timed out")
    expect(dataNow()).toMatchObject({ executionStatus: "failed", errorMessage: "Edit Plan: the planner timed out", useCaseJobId: JOB, generatedTranscript: { words: [1] }, currentJobId: undefined })
    expect(dataNow().generatedText).toBeUndefined()
  })

  it("a failure with no message of its own says so in the reader's language — never a scrape", async () => {
    useLocaleStore.setState({ locale: "he" })
    jobAnswers({ status: "failed" })
    api.getJobStatus.mockResolvedValue(null)
    await expect(run(chaptersNode())).rejects.toThrow(translate("he", "run.unknownError"))
    expect(String(dataNow().errorMessage)).not.toMatch(/scrape/i)
  })

  it.each(LOCALES)("%s: a job cancelled elsewhere leaves the node idle (never failed) and says so in the reader's language", async (locale) => {
    useLocaleStore.setState({ locale })
    jobAnswers({ status: "processing" }, { status: "cancelled" })
    const node = chaptersNode()
    expect(await run(node)).toBe("")
    expect(dataNow()).toMatchObject({ executionStatus: "idle", currentJobId: undefined, useCaseJobId: JOB })
    expect(dataNow().errorMessage).toBeUndefined()
    expect(toasts.error).not.toHaveBeenCalled()
    expect(toasts.info).toHaveBeenCalledWith(translate(locale, "nodeRun.usecaseCancelled", { label: localizeNodeLabel("Chapters", locale) }))
  })

  it.each(LOCALES)("%s: a run that takes longer than usual is said to be still running, and is still followed to its end", async (locale) => {
    useLocaleStore.setState({ locale })
    let finished = false
    api.getJobStatusLean.mockImplementation(async () => (finished ? { status: "completed", output_data: { text: NOTES, json: ROWS } } : { status: "processing" }))
    const node = chaptersNode()
    const p = executeUseCase(node as never, REC as never, makeCtx())
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_LONG_RUN_MS + USE_CASE_TEXT_POLL_MS)
    expect(toasts.info).toHaveBeenCalledWith(translate(locale, "nodeRun.usecaseStillRunning", { label: localizeNodeLabel("Chapters", locale) }))
    expect(dataNow()).toMatchObject({ executionStatus: "running", currentJobId: JOB })
    expect(toasts.error).not.toHaveBeenCalled()
    // It keeps being asked (less often), and lands when the job ends.
    const asked = api.getJobStatusLean.mock.calls.length
    finished = true
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_SLOW_POLL_MS + USE_CASE_TEXT_POLL_MS)
    expect(api.getJobStatusLean.mock.calls.length).toBeGreaterThan(asked)
    expect(await p).toBe(NOTES)
    expect(dataNow()).toMatchObject({ executionStatus: "completed", generatedText: NOTES })
  })

  it("leaving the workflow stops the poll", async () => {
    jobAnswers({ status: "processing" })
    const p = executeUseCase(chaptersNode() as never, REC as never, makeCtx())
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_POLL_MS * 2)
    stale = true
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_POLL_MS)
    const asked = api.getJobStatusLean.mock.calls.length
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_POLL_MS * 5)
    expect(api.getJobStatusLean.mock.calls.length).toBe(asked)
    await expect(p).rejects.toBeDefined()
  })

  it("a run replaced while it ran lands nothing on the node", async () => {
    api.getJobStatusLean.mockImplementation(async () => {
      store.nodes = store.nodes.map((n) => ({ ...n, data: { ...n.data, currentJobId: "another-run" } }))
      return { status: "completed", output_data: { text: NOTES, json: ROWS } }
    })
    expect(await run(chaptersNode())).toBe("")
    expect(dataNow().generatedText).toBeUndefined()
  })

  it("Stop cancels the job and is not a failure", async () => {
    jobAnswers({ status: "processing" })
    const stop = new AbortController()
    const p = executeUseCase(chaptersNode() as never, REC as never, makeCtx(stop.signal))
    await vi.advanceTimersByTimeAsync(USE_CASE_TEXT_POLL_MS)
    stop.abort()
    expect(await p).toBe("")
    expect(api.cancelJob).toHaveBeenCalledWith(JOB)
    expect(dataNow().executionStatus).toBe("running")
  })

  it("a refused start fails the node with no wrapper to continue", async () => {
    api.runUseCase.mockRejectedValue(Object.assign(new Error("Not enough credits"), { code: "insufficient_credits" }))
    await expect(run(chaptersNode({ useCaseJobId: "old-run" }))).rejects.toThrow("Not enough credits")
    expect(dataNow()).toMatchObject({ executionStatus: "failed", errorMessage: "Not enough credits", useCaseJobId: undefined })
    expect(api.getJobStatusLean).not.toHaveBeenCalled()
  })

  it("Tighten Episode still lands through the episode lane", async () => {
    poll.pollJobWithNodeUpdate.mockImplementation(async (_id: string, start: () => Promise<{ jobId: string }>) => {
      await start()
      return "https://r2/out.mp4"
    })
    const node = { id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", fieldMappings: {} } }
    store.nodes = [node]
    expect(await executeUseCase(node as never, REC as never, makeCtx())).toBe("https://r2/out.mp4")
    expect(api.getJobStatusLean).not.toHaveBeenCalled()
    expect(store.nodes[0]!.data.useCaseJobId).toBe(JOB)
  })
})
