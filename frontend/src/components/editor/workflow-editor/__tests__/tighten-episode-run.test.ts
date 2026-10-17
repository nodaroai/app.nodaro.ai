/**
 * Tighten Episode run from the canvas (use-case-executor.ts): a fresh run on
 * the wired recording, a Continue (that run's option, never node data), the continue route's
 * answers followed, and a failed run's finished outputs kept on the node.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

/* eslint-disable @typescript-eslint/no-explicit-any */
const api = vi.hoisted(() => ({
  runUseCase: vi.fn(),
  continueUseCase: vi.fn(),
  getJobStatus: vi.fn(),
}))
const store = vi.hoisted(() => ({
  nodes: [] as any[],
  updateNodeData: vi.fn(),
}))
const poll = vi.hoisted(() => ({
  /** What the poll of a started job does: resolve its URL, or reject as a failed job. */
  outcome: (_jobId: string, _extra: any, _opts: any): Promise<string> => Promise.resolve("https://r2/out.mp4"),
  calls: [] as Array<{ keys: unknown; label: string }>,
}))
const toastError = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/api", () => api)
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: async (_nodeId: string, apiCall: () => Promise<{ jobId: string }>, keys: unknown, label: string, _ctx: unknown, extra: any, _est: unknown, opts: any) => {
    poll.calls.push({ keys, label })
    const { jobId } = await apiCall()
    return poll.outcome(jobId, extra, opts)
  },
}))

import { executionErrorText } from "@/lib/execution-error-text"
import { iterationIdempotencyKey } from "@/lib/idempotency-key"
import { tx } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared/i18n"
import {
  USE_CASE_MAX_GENERATION_HOPS,
  USE_CASE_SETTLING_RETRIES,
  continueAskKey,
  USE_CASE_SETTLING_RETRY_MS,
  executeUseCase,
} from "../use-case-executor"

const ctx = (over: Record<string, unknown> = {}): any => ({
  userId: "00000000-0000-4000-8000-000000000001",
  isWorkflowStale: () => false,
  trackInterval: (i: unknown) => i,
  untrackInterval: () => {},
  ...over,
})

function tightenNode(data: Record<string, unknown>): any {
  const node = { id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", fieldMappings: {}, ...data } }
  store.nodes = [node]
  return node
}

/** The store as the canvas has it: every update merged into the node. */
function liveStore() {
  store.updateNodeData.mockImplementation((id: string, patch: Record<string, unknown>) => {
    store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  })
}

const executeNodeFor = (node: any, inputs: Record<string, unknown>, c = ctx(), opts: Record<string, unknown> = {}) =>
  executeUseCase(node, inputs as never, c, opts)
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }

function pollFails(message = "Tighten Episode failed: Render") {
  poll.outcome = () => Promise.reject(new Error(message))
}

beforeEach(() => {
  vi.useRealTimers()
  api.runUseCase.mockReset()
  api.continueUseCase.mockReset()
  api.getJobStatus.mockReset()
  store.updateNodeData.mockReset()
  store.nodes = []
  toastError.mockReset()
  poll.calls = []
  poll.outcome = () => Promise.resolve("https://r2/out.mp4")
})

describe("a fresh run", () => {
  it("starts the run with the node's settings and the wired recording, and remembers the wrapper job", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    await executeNodeFor(tightenNode({ captions: false, planTier: "premium" }), REC)
    expect(api.runUseCase.mock.calls[0]![0]).toBe("tighten-episode")
    expect(api.runUseCase.mock.calls[0]![1]).toEqual(expect.objectContaining({ mediaUrl: "https://r2/ep.mp4", settings: expect.objectContaining({ captions: false, planTier: "premium" }) }))
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", expect.objectContaining({ useCaseJobId: "job-1" }))
    expect(poll.calls[0]).toEqual({ keys: ["generatedVideoUrl", "generatedAudioUrl"], label: "Tighten Episode" })
  })

  it("sends the music bed and the framing when set", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    const framing = { aspect: "9:16", layout: "stacked" }
    await executeNodeFor(tightenNode({ framing }), { ...REC, useCaseMusic: "https://r2/bed.mp3" })
    expect(api.runUseCase.mock.calls[0]![1]).toEqual(expect.objectContaining({ musicUrl: "https://r2/bed.mp3", settings: expect.objectContaining({ framing }) }))
  })

  it("names the node type in the no-recording refusal (not the node's own name)", async () => {
    const node = tightenNode({ label: "My Episode" })
    await expect(executeUseCase(node, {}, ctx())).rejects.toThrow()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Connect a recording to Tighten Episode first"))
  })

  it("names the node type in the no-recording refusal in the reader's language (Tighten Episode's own sentence)", async () => {
    const CASES: ReadonlyArray<readonly [LocaleId, string]> = [
      ["en", "Connect a recording to Tighten Episode first"],
      ["he", "חברו קודם הקלטה להידוק פרק"],
      ["ja", "先に「エピソードを引き締める」に録音を接続してください"],
      ["ko", "먼저 “에피소드 다듬기”에 녹음을 연결하세요"],
      ["pt-BR", "Conecte primeiro uma gravação ao Enxugar episódio"],
    ]
    try {
      for (const [locale, sentence] of CASES) {
        useLocaleStore.setState({ locale })
        toastError.mockReset()
        await expect(executeNodeFor(tightenNode({}), {})).rejects.toThrow()
        expect(String(toastError.mock.calls[0]![0]), locale).toContain(sentence)
      }
    } finally {
      useLocaleStore.setState({ locale: "en" })
    }
  })

  it("no recording: refuses with the node's message, no API call", async () => {
    await expect(executeNodeFor(tightenNode({}), {})).rejects.toThrow()
    expect(api.runUseCase).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("lands the episode's one medium (the other cleared), the plan and transcript, and the take's quality", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    let landed: Record<string, unknown> = {}
    let take: Record<string, unknown> = {}
    poll.outcome = (_id, extra, opts) => {
      const od = {
        audioUrl: "https://r2/ep.m4a", json: { v: 1 }, plan: { v: 1 }, transcript: { words: [] }, quality: "proxy", _executionId: "exec-1",
        planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb", useCaseSettings: { captions: false, reviewBeforeRender: true },
      }
      landed = extra(od)
      take = opts.resultFields(od)
      return Promise.resolve("https://r2/ep.m4a")
    }
    await executeNodeFor(tightenNode({ generatedVideoUrl: "https://r2/old.mp4" }), REC)
    expect(landed).toEqual({ generatedVideoUrl: undefined, generatedJson: { v: 1 }, generatedTranscript: { words: [] }, useCaseExecutionId: "exec-1" })
    // The take: its stamps, and what it keeps of its run (its plan, transcript and settings).
    expect(take).toEqual({
      quality: "proxy", planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb",
      generatedJson: { v: 1 }, generatedTranscript: { words: [] }, useCaseSettings: { captions: false, reviewBeforeRender: true },
    })
  })
})

describe("a Continue (this run's option)", () => {
  it("runs a from-failed continuation of the job it names, and writes no continuation on the node", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "started", jobId: "job-2" })
    await executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
    expect(api.continueUseCase.mock.calls[0]![0]).toEqual(expect.objectContaining({ jobId: "job-0", mode: "from-failed" }))
    expect(store.updateNodeData).not.toHaveBeenCalledWith("t1", expect.objectContaining({ useCaseContinue: expect.anything() }))
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", { useCaseJobId: "job-2" })
  })

  it("is this run's only: after a refused continue, the next plain Run is a fresh run", async () => {
    liveStore()
    api.continueUseCase.mockRejectedValue(Object.assign(new Error("nope"), { code: "continuation_not_failed" }))
    await expect(executeNodeFor(tightenNode({}), REC, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })).rejects.toThrow()
    expect(store.nodes[0].data).not.toHaveProperty("useCaseContinue")
    api.runUseCase.mockResolvedValue({ jobId: "job-3" })
    await executeNodeFor(store.nodes[0], REC)
    expect(api.runUseCase).toHaveBeenCalledTimes(1)
    expect(api.continueUseCase).toHaveBeenCalledTimes(1)
  })

  it("a refusal code shows its words in the reader's language", async () => {
    api.continueUseCase.mockRejectedValue(Object.assign(new Error("server words"), { code: "continuation_not_failed" }))
    const err = await executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } }).catch((e: Error) => e)
    expect((err as Error).message).not.toBe("server words")
    expect((err as { code?: string }).code).toBe("continuation_not_failed")
  })

  it("a refused Render final fails the node with its code (its words, no Continue), nothing followed", async () => {
    liveStore()
    api.continueUseCase.mockRejectedValue(Object.assign(new Error("Already rendered with this edit."), { code: "render_final_already_rendered", jobId: "job-f" }))
    const err = await executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "render-final", jobId: "job-1" } }).catch((e: Error) => e)
    expect((err as { code?: string }).code).toBe("render_final_already_rendered")
    expect((store.nodes[0]!.data as Record<string, unknown>).errorCode).toBe("render_final_already_rendered")
  })

  it("Render final sends the reviewer's edit", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "started", jobId: "job-3" })
    const edit = { v: 1, kind: "edl" }
    await executeNodeFor(tightenNode({ editedEdl: edit }), {}, ctx(), { usecaseContinue: { mode: "render-final", jobId: "job-1" } })
    expect(api.continueUseCase.mock.calls[0]![0]).toEqual(expect.objectContaining({ jobId: "job-1", mode: "render-final", editedEdl: edit }))
  })

  it("a from-failed continuation never sends an edit", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "started", jobId: "job-3" })
    await executeNodeFor(tightenNode({ editedEdl: { v: 1 } }), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-1" } })
    expect(api.continueUseCase.mock.calls[0]![0]).not.toHaveProperty("editedEdl")
  })
})

describe("the continue route's answers", () => {
  it("already running: waits on the continuation it names", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "running", jobId: "job-live" })
    const followed: string[] = []
    poll.outcome = (jobId) => (followed.push(jobId), Promise.resolve("https://r2/out.mp4"))
    await executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
    expect(followed).toEqual(["job-live"])
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", { useCaseJobId: "job-live" })
  })

  it("superseded: continues the newer generation from where it failed", async () => {
    api.continueUseCase
      .mockResolvedValueOnce({ kind: "superseded", jobId: "job-newer", message: "continue that one" })
      .mockResolvedValueOnce({ kind: "started", jobId: "job-4" })
    await executeNodeFor(tightenNode({ editedEdl: { v: 1 } }), {}, ctx(), { usecaseContinue: { mode: "render-final", jobId: "job-1" } })
    expect(api.continueUseCase.mock.calls[1]![0]).toEqual(expect.objectContaining({ jobId: "job-newer", mode: "from-failed", nodeId: "t1" }))
    expect(api.continueUseCase.mock.calls[1]![0]).not.toHaveProperty("editedEdl")
  })

  it("superseded too many times: gives up in the reader's language", async () => {
    api.continueUseCase.mockResolvedValue({ kind: "superseded", jobId: "job-x", message: "server words" })
    const err = await executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } }).catch((e: Error) => e)
    expect((err as Error).message).toBe(executionErrorText("continuation_superseded"))
    expect(api.continueUseCase).toHaveBeenCalledTimes(USE_CASE_MAX_GENERATION_HOPS + 1)
  })

  it("still settling past the last retry: gives up in the reader's language", async () => {
    vi.useFakeTimers()
    api.continueUseCase.mockResolvedValue({ kind: "settling", message: "server words" })
    const settled = executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } }).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(USE_CASE_SETTLING_RETRY_MS * (USE_CASE_SETTLING_RETRIES + 1))
    const err = await settled
    expect((err as Error).message).toBe(executionErrorText("continuation_settling"))
    expect((err as Error).message).not.toBe("continuation_settling")
    expect(api.continueUseCase).toHaveBeenCalledTimes(USE_CASE_SETTLING_RETRIES + 1)
  })

  it("still settling: asks again after a short wait", async () => {
    vi.useFakeTimers()
    api.continueUseCase
      .mockResolvedValueOnce({ kind: "settling", message: "still settling" })
      .mockResolvedValueOnce({ kind: "started", jobId: "job-5" })
    const run = executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
    await vi.advanceTimersByTimeAsync(USE_CASE_SETTLING_RETRY_MS)
    await run
    expect(api.continueUseCase).toHaveBeenCalledTimes(2)
  })

  it("still settling, then the run is stopped: no second ask", async () => {
    vi.useFakeTimers()
    const stop = new AbortController()
    api.continueUseCase.mockResolvedValue({ kind: "settling", message: "still settling" })
    const run = executeNodeFor(tightenNode({}), {}, ctx({ signal: stop.signal }), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })
    const settled = run.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(1)
    stop.abort()
    expect(await settled).toBeInstanceOf(Error)
    expect(api.continueUseCase).toHaveBeenCalledTimes(1)
  })
})

describe("Idempotency-Key", () => {
  it("a run sends the call's key", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    await executeNodeFor(tightenNode({}), REC, ctx(), { idempotencyKey: "click-1" })
    expect(api.runUseCase.mock.calls[0]![2]).toBe("click-1")
  })

  it("each fan-out iteration sends its own key", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    await executeNodeFor(tightenNode({}), REC, ctx(), { idempotencyKey: iterationIdempotencyKey("click-1", 0) })
    await executeNodeFor(tightenNode({}), REC, ctx(), { idempotencyKey: iterationIdempotencyKey("click-1", 1) })
    const [a, b] = api.runUseCase.mock.calls.map((c) => c[2])
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it("a continue sends the key; a hop to a newer generation sends a new one; a settling retry keeps it", async () => {
    vi.useFakeTimers()
    api.continueUseCase
      .mockResolvedValueOnce({ kind: "settling", message: "wait" })
      .mockResolvedValueOnce({ kind: "superseded", jobId: "job-newer", message: "newer" })
      .mockResolvedValueOnce({ kind: "started", jobId: "job-4" })
    const run = executeNodeFor(tightenNode({}), {}, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" }, idempotencyKey: "click-2" })
    await vi.advanceTimersByTimeAsync(USE_CASE_SETTLING_RETRY_MS)
    await run
    const keys = api.continueUseCase.mock.calls.map((c) => c[1])
    expect(keys[0]).toBe("click-2")
    expect(keys[1]).toBe("click-2")
    expect(keys[2]).toBe(continueAskKey("click-2", 1))
    expect(keys[2]).not.toBe("click-2")
  })
})

describe("a list-driven node (one run per item)", () => {
  it("refuses a Continue: no request, the message shown, nothing left on the node", async () => {
    liveStore()
    const node = tightenNode({})
    await expect(executeNodeFor(node, REC, ctx(), { listDriven: true, usecaseContinue: { mode: "from-failed", jobId: "job-0" } })).rejects.toThrow()
    expect(api.continueUseCase).not.toHaveBeenCalled()
    expect(api.runUseCase).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(String(toastError.mock.calls[0]![0])).toContain(tx("nodeRun.tightenContinueListDriven"))
    expect(store.nodes[0].data).not.toHaveProperty("useCaseContinue")
  })

  it("refuses a Render final the same way", async () => {
    await expect(executeNodeFor(tightenNode({}), REC, ctx(), { usecaseContinue: { mode: "render-final", jobId: "job-1" }, listDriven: true })).rejects.toThrow()
    expect(api.continueUseCase).not.toHaveBeenCalled()
  })

  it("still runs a plain Run", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    await executeNodeFor(tightenNode({}), REC, ctx(), { listDriven: true })
    expect(api.runUseCase).toHaveBeenCalledTimes(1)
  })
})

describe("a failed run keeps what it finished", () => {
  it("the episode its render made stays on the node (one medium, the other cleared)", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    pollFails()
    api.getJobStatus.mockResolvedValue({ status: "failed", output_data: { audioUrl: "https://r2/ep.m4a", json: { v: 1 }, quality: "final", _executionId: "exec-1" } })
    await expect(executeNodeFor(tightenNode({}), REC)).rejects.toThrow()
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", expect.objectContaining({ generatedAudioUrl: "https://r2/ep.m4a", generatedVideoUrl: undefined, useCaseJobId: "job-1" }))
  })

  it("the finished plan and transcript stay on the node", async () => {
    api.runUseCase.mockResolvedValue({ jobId: "job-1" })
    pollFails()
    api.getJobStatus.mockResolvedValue({ status: "failed", output_data: { plan: { v: 1 }, json: { v: 1 }, transcript: { words: [] }, _executionId: "exec-1", failedNodeId: "uc-render" } })
    await expect(executeNodeFor(tightenNode({}), REC)).rejects.toThrow()
    expect(api.getJobStatus).toHaveBeenCalledWith("job-1")
    expect(store.updateNodeData).toHaveBeenCalledWith("t1", expect.objectContaining({ generatedJson: { v: 1 }, generatedTranscript: { words: [] }, useCaseExecutionId: "exec-1" }))
  })

  it("a run that never started reads no job (an earlier run's outputs are not re-written)", async () => {
    api.runUseCase.mockRejectedValue(new Error("refused"))
    await expect(executeNodeFor(tightenNode({ useCaseJobId: "job-old" }), REC)).rejects.toThrow("refused")
    expect(api.getJobStatus).not.toHaveBeenCalled()
  })

  it("a fresh run refused before its wrapper exists leaves no earlier run to Continue", async () => {
    liveStore()
    api.runUseCase.mockRejectedValue(Object.assign(new Error("The recording could not be read."), { code: "media_unreadable" }))
    await expect(executeNodeFor(tightenNode({ useCaseJobId: "job-old", useCaseExecutionId: "exec-old" }), REC)).rejects.toThrow()
    expect(store.nodes[0].data.useCaseJobId).toBeUndefined()
    expect(store.nodes[0].data.useCaseExecutionId).toBeUndefined()
  })

  it("a Continue refused before its wrapper exists keeps the run it names (it can be asked again)", async () => {
    liveStore()
    api.continueUseCase.mockRejectedValue(Object.assign(new Error("Insufficient credits"), { code: "insufficient_credits" }))
    await expect(executeNodeFor(tightenNode({ useCaseJobId: "job-0" }), REC, ctx(), { usecaseContinue: { mode: "from-failed", jobId: "job-0" } })).rejects.toThrow()
    expect(store.nodes[0].data.useCaseJobId).toBe("job-0")
  })
})
