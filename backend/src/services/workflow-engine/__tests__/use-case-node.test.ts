/**
 * A Tighten Episode node on the backend engine: it calls its route on the
 * internal lane and waits on the wrapper job (use-case-node.ts). The route,
 * the job table and the cancel are the unit boundaries; every refusal and
 * failure below is the copy the real route / finaliser sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NODARO_CONNECTION_REQUIRED_CODE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "../../../lib/nodaro-connection-messages.js"

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({
  fetch: vi.fn(),
  /** The wrapper rows by id, read by the poll (`select … .eq(id).eq(user_id).maybeSingle()`). */
  rows: new Map<string, Row>(),
  /** Every id the poll asked for, in order. */
  reads: [] as string[],
  cancel: vi.fn(async () => ({ kind: "cancelled", analysisJobId: null })),
  excess: vi.fn(async () => 0),
  draining: false,
  /** The outer execution's status, read by the wait's cancel check. */
  execStatus: "running",
  /** How many wrapper reads fail before one answers (a transient database error). */
  readErrors: 0,
  /** Rows a wrapper read answers in turn, before `rows` (a wrapper whose status moves). */
  sequence: new Map<string, Row[]>(),
  /** The graphs inner runs stored, by execution id (`loadExecutionForWrapper`). */
  graphs: new Map<string, unknown>(),
  /** How many inner-run reads fail before one answers. */
  runReadErrors: 0,
}))

vi.mock("../loopback-fetch.js", () => ({ loopbackFetch: m.fetch }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {}
        const q = {
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return q
          },
          single: async () => (table === "workflow_executions" ? { data: { status: m.execStatus }, error: null } : { data: null, error: null }),
          maybeSingle: async () => {
            const id = String(filters.id)
            m.reads.push(id)
            if (m.readErrors > 0) {
              m.readErrors--
              return { data: null, error: { message: "connection reset" } }
            }
            const queued = m.sequence.get(id)
            const row = queued && queued.length > 0 ? queued.shift() : m.rows.get(id)
            if (!row || (filters.user_id !== undefined && row.user_id !== filters.user_id)) return { data: null, error: null }
            return { data: row, error: null }
          },
        }
        return q
      },
    }),
  },
}))
vi.mock("../../../lib/execution-budget.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/execution-budget.js")>()),
  executionBudgetExcessMs: m.excess,
}))
vi.mock("../../../lib/cancel-job.js", () => ({ cancelOwnedJob: m.cancel }))
vi.mock("../../../lib/execution-inline-graph.js", () => ({
  loadExecutionForWrapper: async (id: string) => {
    if (m.runReadErrors > 0) {
      m.runReadErrors--
      throw new Error("[execution-inline-graph] wrapper read failed: connection reset")
    }
    return m.graphs.has(id) ? { id, userId: "11111111-1111-4111-8111-111111111111", inlineGraph: m.graphs.get(id) } : null
  },
}))
vi.mock("../../../lib/worker-drain.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/worker-drain.js")>()),
  isWorkerDraining: () => m.draining,
}))
vi.mock("../../../lib/config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) },
  hasCredits: () => true,
}))
// The poll and the settling retry would wait seconds between turns.
vi.mock("../types.js", async (orig) => ({ ...(await orig<typeof import("../types.js")>()), JOB_POLL_INTERVAL_MS: 0 }))

import { CANNOT_CONTINUE_MESSAGE, executeUseCaseNode, MAX_GENERATION_HOPS, USE_CASE_SETTLING_RETRY_MS } from "../use-case-node.js"
import { DrainAbortError } from "../../../lib/worker-drain.js"
import type { ResolvedInputs } from "../types.js"
import { usecaseDescriptor } from "@nodaro/render-rules"

/** The rejection a run ends with, typed as the orchestrator reads it. */
const rejection = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection") }, (e: unknown) => e as Error & { errorCode?: string; output?: unknown })

const USER = "11111111-1111-4111-8111-111111111111"
const WF = "22222222-2222-4222-8222-222222222222"

function ctx(over: Record<string, unknown> = {}) {
  return {
    executionId: "exec-out",
    userId: USER,
    workflowId: WF,
    triggerType: "manual",
    billingContext: { userId: USER, payer: "user" },
    componentDepth: 0,
    executingComponentIds: [],
    reviewerPresent: true,
    previewStopRule: true,
    cancelled: false,
    onJobCreated: vi.fn(),
    ...over,
  } as never
}
const tighten = (data: Record<string, unknown> = {}) =>
  ({ id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", captions: false, reviewBeforeRender: true, planTier: "premium", ...data } }) as never
const wired = (url = "https://r2/ep.mp4"): ResolvedInputs => ({ useCaseMedia: [{ nodeId: "rec", url }] })

const answer = (status: number, body: Row) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const wrapper = (over: Row = {}): Row => ({
  user_id: USER,
  status: "completed",
  output_data: { videoUrl: "https://r2/ep-tight.mp4", json: { v: 1 }, plan: { v: 1 }, quality: "final", _executionId: "exec-in" },
  error_message: null,
  credits_actual: 942,
  input_data: { _executionId: "exec-in" },
  ...over,
})

beforeEach(() => {
  m.fetch.mockReset().mockResolvedValue(answer(202, { jobId: "job-w", executionId: "exec-in" }))
  m.rows.clear()
  m.rows.set("job-w", wrapper())
  m.reads.length = 0
  m.cancel.mockClear()
  m.excess.mockReset().mockResolvedValue(0)
  m.draining = false
  m.execStatus = "running"
  m.readErrors = 0
  m.sequence.clear()
  m.graphs.clear()
  m.runReadErrors = 0
})

describe("executeUseCaseNode — the run", () => {
  it("calls the route on the internal lane with the settings, a stable key, depth+1 and the parent's lane, and waits for the wrapper", async () => {
    const c = ctx()
    const out = await executeUseCaseNode(tighten(), { ...wired(), useCaseMusic: "https://r2/bed.mp3" }, c, 0)
    const [url, init] = m.fetch.mock.calls[0]!
    expect(url).toMatch(/\/v1\/tighten-episode$/)
    expect(init.headers["X-Internal-Orchestrator-Secret"]).toBe("s".repeat(40))
    expect(init.headers["X-Internal-User-Id"]).toBe(USER)
    expect(init.headers["Idempotency-Key"]).toBe("wf-exec-out-t1-0")
    expect(JSON.parse(init.body)).toEqual({
      mediaUrls: ["https://r2/ep.mp4"], musicUrl: "https://r2/bed.mp3", captions: false, reviewBeforeRender: true, planTier: "premium",
      componentDepth: 1, executingComponentIds: [], previewStopRule: true, reviewerPresent: true,
      billingContext: { userId: USER, payer: "user" }, userId: USER, workflowId: WF, nodeId: "t1",
    })
    expect(out).toEqual({ output: { videoUrl: "https://r2/ep-tight.mp4", json: { v: 1 }, quality: "final" }, jobId: "job-w", creditsUsed: 942 })
    // The node state's job pointer is how the run (expunge, budget) reaches the wrapper.
    expect((c as unknown as { onJobCreated: ReturnType<typeof vi.fn> }).onJobCreated).toHaveBeenCalledWith("t1", "job-w")
  })

  it("a None the body takes is sent as null; a null it does not take, or an unset setting, is left out (the route's default)", async () => {
    await executeUseCaseNode(tighten({ framing: null, captionStyle: null, styleGuide: undefined }), wired(), ctx(), undefined)
    const body = JSON.parse(m.fetch.mock.calls[0]![1].body)
    expect(body).toHaveProperty("framing", null)
    expect(body).not.toHaveProperty("captionStyle")
    expect(body).not.toHaveProperty("styleGuide")
  })

  it("carries the take's quality and transcript, and an audio episode as audio", async () => {
    m.rows.set("job-w", wrapper({ output_data: { audioUrl: "https://r2/ep.m4a", json: { v: 1 }, transcript: { words: [] }, quality: "proxy", _executionId: "exec-in" } }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(), undefined)
    expect(out.output).toEqual({ audioUrl: "https://r2/ep.m4a", json: { v: 1 }, transcript: { words: [] }, quality: "proxy" })
  })

  it("the same node and iteration always sends the same key; another iteration or scope its own (one wrapper, one fee, each)", async () => {
    await executeUseCaseNode(tighten(), wired(), ctx(), 2)
    await executeUseCaseNode(tighten(), wired(), ctx(), 2)
    await executeUseCaseNode(tighten(), wired(), ctx(), 3)
    await executeUseCaseNode(tighten(), wired(), ctx(), 2, ["sub-1-0"])
    const keys = m.fetch.mock.calls.map((c) => c[1].headers["Idempotency-Key"])
    expect(keys[0]).toBe(keys[1])
    expect(new Set([keys[0], keys[2], keys[3]]).size).toBe(3)
  })

  it.each([
    ["the keyed retry's earlier run (202)", 202],
    ["the credit guard's dedup (200)", 200],
  ])("a dedup answer — %s — is the existing wrapper: waited on, never a second run", async (_label, status) => {
    m.fetch.mockResolvedValue(answer(status, { jobId: "job-w", deduped: true }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(), undefined)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    expect(out.jobId).toBe("job-w")
  })

  it("no recording wired: a clear error, no call", async () => {
    await expect(executeUseCaseNode(tighten(), {} as never, ctx(), undefined)).rejects.toThrow(/recording/i)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it("depth 5: refused before calling", async () => {
    await expect(executeUseCaseNode(tighten(), wired(), ctx({ componentDepth: 5 }), undefined)).rejects.toThrow(/depth/i)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it("the route refuses: its message is the node's error, its code the errorCode", async () => {
    m.fetch.mockResolvedValue(answer(503, { error: { code: NODARO_CONNECTION_REQUIRED_CODE, message: NODARO_CONNECTION_REQUIRED_MESSAGE } }))
    const err = await rejection(executeUseCaseNode(tighten(), wired(), ctx(), undefined))
    expect(err.message).toBe(NODARO_CONNECTION_REQUIRED_MESSAGE)
    expect(err.errorCode).toBe(NODARO_CONNECTION_REQUIRED_CODE)
  })

  it("a failed wrapper fails the node with its message and keeps what the run made (the plan, the transcript)", async () => {
    m.rows.set("job-w", wrapper({
      status: "failed",
      error_message: "Apply Cut: The render could not read the recording",
      output_data: { json: { v: 1 }, plan: { v: 1 }, transcript: { words: [] }, quality: "final", _executionId: "exec-in", failedNodeId: "uc-render", failedStep: "Apply Cut" },
    }))
    const err = await rejection(executeUseCaseNode(tighten(), wired(), ctx(), undefined))
    expect(err.message).toBe("Apply Cut: The render could not read the recording")
    expect(err.output).toEqual({ json: { v: 1 }, transcript: { words: [] } })
  })

  it("the outer run is cancelled: the wrapper (and through it the inner run) is cancelled", async () => {
    m.rows.set("job-w", wrapper({ status: "processing", output_data: null }))
    const c = ctx() as unknown as { cancelled: boolean }
    m.fetch.mockImplementation(async () => {
      c.cancelled = true
      return answer(202, { jobId: "job-w", executionId: "exec-in" })
    })
    await expect(executeUseCaseNode(tighten(), wired(), c as never, undefined)).rejects.toThrow(/cancel/i)
    expect(m.cancel).toHaveBeenCalledWith("job-w", USER)
  })

  it("cancelled before anything started: no call, nothing to cancel", async () => {
    await expect(executeUseCaseNode(tighten(), wired(), ctx({ cancelled: true }), undefined)).rejects.toThrow(/cancel/i)
    expect(m.fetch).not.toHaveBeenCalled()
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it("a draining worker stops waiting without cancelling: the re-picked run finds the same wrapper by its key", async () => {
    m.rows.set("job-w", wrapper({ status: "processing", output_data: null }))
    m.draining = true
    await expect(executeUseCaseNode(tighten(), wired(), ctx(), undefined)).rejects.toBeInstanceOf(DrainAbortError)
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it("the run's execution is cancelled mid-wait (read by the wait itself): its own wrapper is cancelled, the node ends cancelled", async () => {
    m.rows.set("job-w", wrapper({ status: "processing", output_data: null, idempotency_key: "wf-exec-out-t1" }))
    const c = ctx() as unknown as { cancelled: boolean }
    let reads = 0
    m.fetch.mockImplementation(async () => answer(202, { jobId: "job-w", executionId: "exec-in" }))
    const original = m.reads.push.bind(m.reads)
    m.reads.push = (...ids: string[]) => {
      if (++reads === 3) m.execStatus = "cancelled"
      return original(...ids)
    }
    try {
      await expect(executeUseCaseNode(tighten(), wired(), c as never, undefined)).rejects.toThrow(/cancel/i)
    } finally {
      delete (m.reads as { push?: unknown }).push
    }
    expect(c.cancelled).toBe(true)
    expect(m.cancel).toHaveBeenCalledWith("job-w", USER)
  })

  for (const [code, message] of [
    ["render_final_already_rendered", "Already rendered with this edit."],
    ["already_running", "A Render final of this run is already in progress."],
  ] as const) {
    it(`inside a Render final, ${code} fails the node with that refusal, naming the final — nothing followed, nothing charged`, async () => {
      m.fetch.mockResolvedValue(answer(409, { error: { code, message }, jobId: "job-f" }))
      m.rows.set("job-f", wrapper({ output_data: { videoUrl: "https://r2/final.mp4", quality: "final", _executionId: "exec-f" } }))
      const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "render-final", jobId: "job-0" } } } as never
      const err = await executeUseCaseNode(node, {} as never, ctx(), undefined).then(() => null, (e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).toMatchObject({ message, errorCode: code, output: { useCaseFinalJobId: "job-f" } })
      // The named final was never read as this run's result.
      expect(m.reads).not.toContain("job-f")
    })
  }

  it("a continue-from-failed that another request already continues still waits on it", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper())
    const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "from-failed", jobId: "job-0" } } } as never
    const result = await executeUseCaseNode(node, {} as never, ctx(), undefined)
    expect(result.jobId).toBe("job-c")
  })

  it("another request's continuation is never cancelled when the run stops waiting", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper({ status: "processing", output_data: null, idempotency_key: "wf-exec-other-t1" }))
    m.execStatus = "cancelled"
    const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "from-failed", jobId: "job-0" } } } as never
    await expect(executeUseCaseNode(node, {} as never, ctx(), undefined)).rejects.toThrow(/cancel/i)
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it("a wrapper this node's own key started (a crash re-pick) is cancelled when the run is", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper({ status: "processing", output_data: null, idempotency_key: "wf-exec-out-t1" }))
    m.execStatus = "cancelled"
    const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "from-failed", jobId: "job-0" } } } as never
    await expect(executeUseCaseNode(node, {} as never, ctx(), undefined)).rejects.toThrow(/cancel/i)
    expect(m.cancel).toHaveBeenCalledWith("job-c", USER)
  })

  it("a run cancelled while the route keeps answering \"still settling\": the wait sees it, nothing to cancel", async () => {
    vi.useFakeTimers()
    try {
      m.fetch.mockResolvedValue(answer(409, { error: { code: "continuation_settling", message: "That run is still being settled. Try again in a moment." } }))
      m.execStatus = "cancelled"
      const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "from-failed", jobId: "job-0" } } } as never
      const c = ctx() as unknown as { cancelled: boolean }
      const run = rejection(executeUseCaseNode(node, {} as never, c as never, undefined))
      await vi.advanceTimersByTimeAsync(6 * USE_CASE_SETTLING_RETRY_MS)
      expect((await run).message).toMatch(/cancel/i)
      expect(c.cancelled).toBe(true)
      expect(m.cancel).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["this node's own key (a crash re-pick): cancelled", "wf-exec-out-t1", true],
    ["another request's key: left to run", "wf-exec-other-t1", false],
  ])("a run cancelled before an adopted wrapper was ever read: it is read once to tell — %s", async (_label, idempotencyKey, cancelled) => {
    const c = ctx() as unknown as { cancelled: boolean }
    m.fetch.mockImplementation(async () => {
      c.cancelled = true
      return answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" })
    })
    m.rows.set("job-c", wrapper({ status: "processing", output_data: null, idempotency_key: idempotencyKey }))
    const node = { id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode: "from-failed", jobId: "job-0" } } } as never
    await expect(executeUseCaseNode(node, {} as never, c as never, undefined)).rejects.toThrow(/cancel/i)
    if (cancelled) expect(m.cancel).toHaveBeenCalledWith("job-c", USER)
    else expect(m.cancel).not.toHaveBeenCalled()
  })

  it("a wrapper read that fails is read again, never \"job not found\"", async () => {
    m.readErrors = 2
    await expect(executeUseCaseNode(tighten(), wired(), ctx(), undefined)).resolves.toMatchObject({ jobId: "job-w", creditsUsed: 942 })
  })

  it("a long run: the inner run's budget excess grows the outer run's cap", async () => {
    m.excess.mockResolvedValue(30 * 60_000)
    const c = ctx() as unknown as { budgetExcessMs?: number }
    await executeUseCaseNode(tighten(), wired(), c as never, undefined)
    expect(m.excess).toHaveBeenCalledWith("exec-in", USER)
    expect(c.budgetExcessMs).toBe(30 * 60_000)
  })
})

describe("executeUseCaseNode — a continuation (an app's Render final, a continue-from-failed)", () => {
  const cont = (mode: string, extra: Record<string, unknown> = {}) =>
    ({ id: "t1", type: "tighten-episode", data: { label: "T", useCaseContinue: { mode, jobId: "job-0" }, ...extra } }) as never

  it("Render final continues the node's own job at final, with the reviewer's edit and the parent's lane", async () => {
    await executeUseCaseNode(cont("render-final", { editedEdl: { v: 2 } }), {} as never, ctx(), undefined)
    const [url, init] = m.fetch.mock.calls[0]!
    expect(url).toMatch(/\/v1\/tighten-episode\/continue$/)
    expect(init.headers["Idempotency-Key"]).toBe("wf-exec-out-t1")
    expect(JSON.parse(init.body)).toEqual({
      jobId: "job-0", mode: "render-final", editedEdl: { v: 2 },
      componentDepth: 1, executingComponentIds: [], previewStopRule: true, reviewerPresent: true,
      billingContext: { userId: USER, payer: "user" }, userId: USER, workflowId: WF, nodeId: "t1",
    })
  })

  it("from-failed sends no edit and forwards the reviewer (a review-on node is not refused for want of one)", async () => {
    await executeUseCaseNode(cont("from-failed", { editedEdl: { v: 2 } }), {} as never, ctx(), undefined)
    const body = JSON.parse(m.fetch.mock.calls[0]![1].body)
    expect(body).toMatchObject({ jobId: "job-0", mode: "from-failed", reviewerPresent: true })
    expect(body).not.toHaveProperty("editedEdl")
  })

  it("already running: waits on the continuation the route names instead of failing", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper({ credits_actual: 120 }))
    const c = ctx()
    const out = await executeUseCaseNode(cont("from-failed"), {} as never, c, undefined)
    expect(out.jobId).toBe("job-c")
    // Another request started (and paid for) it: this run counts none of its credits.
    expect(out.creditsUsed).toBe(0)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    expect((c as unknown as { onJobCreated: ReturnType<typeof vi.fn> }).onJobCreated).toHaveBeenCalledWith("t1", "job-c")
  })

  it("already running, started by this run's own key (a crash re-pick): its credits are this run's", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper({ credits_actual: 120, idempotency_key: "wf-exec-out-t1" }))
    const out = await executeUseCaseNode(cont("from-failed"), {} as never, ctx(), undefined)
    expect(out).toMatchObject({ jobId: "job-c", creditsUsed: 120 })
  })

  it("already running, started under another key (another iteration of this run, another run): none of its credits", async () => {
    m.fetch.mockResolvedValue(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
    m.rows.set("job-c", wrapper({ credits_actual: 120, idempotency_key: "wf-exec-out-t1-1" }))
    const out = await executeUseCaseNode(cont("from-failed"), {} as never, ctx(), 0)
    expect(out).toMatchObject({ jobId: "job-c", creditsUsed: 0 })
  })

  it("already running, the named wrapper not written yet: the route is asked again", async () => {
    vi.useFakeTimers()
    try {
      m.fetch
        .mockResolvedValueOnce(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-c" }))
        .mockResolvedValueOnce(answer(202, { jobId: "job-c", deduped: true }))
      // A continue-from-failed (inside a Render final it fails the node instead).
      const run = executeUseCaseNode(cont("from-failed"), {} as never, ctx(), undefined)
      await vi.advanceTimersByTimeAsync(0)
      m.rows.set("job-c", wrapper())
      await vi.advanceTimersByTimeAsync(USE_CASE_SETTLING_RETRY_MS)
      await expect(run).resolves.toMatchObject({ jobId: "job-c" })
      expect(m.fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("still settling: asked again after a short wait, then waited on", async () => {
    vi.useFakeTimers()
    try {
      m.fetch
        .mockResolvedValueOnce(answer(409, { error: { code: "continuation_settling", message: "That run is still being settled. Try again in a moment." } }))
        .mockResolvedValueOnce(answer(202, { jobId: "job-w", executionId: "exec-in" }))
      const run = executeUseCaseNode(cont("from-failed"), {} as never, ctx(), undefined)
      await vi.advanceTimersByTimeAsync(USE_CASE_SETTLING_RETRY_MS)
      await expect(run).resolves.toMatchObject({ jobId: "job-w" })
      expect(m.fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["continuation_not_failed", "Only a run that failed can be continued from where it stopped."],
    ["render_final_not_preview", "Render final follows a run that stopped at its preview; this run's render is not a preview."],
  ])("%s is final: the node fails with the route's copy", async (code, message) => {
    m.fetch.mockResolvedValue(answer(409, { error: { code, message } }))
    const err = await rejection(executeUseCaseNode(cont("render-final"), {} as never, ctx(), undefined))
    expect(err.message).toBe(message)
    expect(err.errorCode).toBe(code)
    expect(m.fetch).toHaveBeenCalledTimes(1)
  })
})

describe("executeUseCaseNode — an outer run continued from its failure", () => {
  const failedBefore = (state: Record<string, unknown> = { status: "failed", jobId: "job-0", error: "Apply Cut: The render could not read the recording" }) =>
    ({ continuedFromStates: { t1: state } })
  /** What the route stored on the attempt that failed: the recording it ran on and the settings it resolved for it. */
  const ranWith = (over: Row = {}, opts: { data?: Row; kind?: "video" | "audio" } = {}): Row => ({
    type: "tighten-episode",
    mode: "run",
    settings: usecaseDescriptor("tighten-episode").resolveSettings((tighten(opts.data) as { data: Row }).data, opts.kind ?? "video"),
    mediaUrl: "https://r2/ep.mp4",
    durationSec: 1800,
    _feeCredits: 300,
    _executionId: "exec-in",
    ...over,
  })
  /** The graph the attempt's run stored: its recording, as a video (or audio) upload. */
  const graphOf = (kind: "video" | "audio" = "video") => ({
    nodeType: "tighten-episode",
    nodes: [{ id: "uc-source", type: kind === "audio" ? "upload-audio" : "upload-video", data: {} }],
  })
  /** The wrapper of the attempt that failed, as the gate and the recorded-wrapper read see it. */
  const attempt = (over: Row = {}): Row => wrapper({ status: "failed", output_data: { json: { v: 1 }, _executionId: "exec-in" }, input_data: ranWith(), ...over })

  beforeEach(() => {
    m.rows.set("job-0", attempt())
    m.rows.set("job-1", attempt())
    m.graphs.set("exec-in", graphOf())
  })

  it("a Tighten node that failed there continues its own inner run from where it failed — no fresh run, no second fee", async () => {
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = m.fetch.mock.calls[0]!
    expect(url).toMatch(/\/v1\/tighten-episode\/continue$/)
    expect(JSON.parse(init.body)).toEqual({
      jobId: "job-0", mode: "from-failed",
      componentDepth: 1, executingComponentIds: [], previewStopRule: true, reviewerPresent: true,
      billingContext: { userId: USER, payer: "user" }, userId: USER, workflowId: WF, nodeId: "t1",
    })
    expect(out.jobId).toBe("job-w")
  })

  // The outer run was built on a later generation that left the node out (a
  // narrow continuation): its state there is a seed that carries the attempt
  // that failed before (run-continuation.ts `continuationSeeds`).
  it.each([
    ["a skipped seed of a later generation", { status: "skipped", seededFromExecution: "exec-b", completedAt: "t", failedAttemptJobId: "job-0" }],
    ["a later generation's own state that never got a job (pending)", { status: "pending", failedAttemptJobId: "job-0" }],
    ["a later generation's own failure before any job of its own", { status: "failed", error: "aborted", failedAttemptJobId: "job-0" }],
  ])("%s that carries the failed attempt: the node continues it — no fresh run, no second fee", async (_name, state) => {
    await executeUseCaseNode(tighten(), wired(), ctx(failedBefore(state)), undefined)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = m.fetch.mock.calls[0]!
    expect(url).toMatch(/\/v1\/tighten-episode\/continue$/)
    expect(JSON.parse(init.body)).toMatchObject({ jobId: "job-0", mode: "from-failed" })
  })

  it("a later failure with a job of its own continues THAT attempt, not the older carried one", async () => {
    await executeUseCaseNode(tighten(), wired(), ctx(failedBefore({ status: "failed", jobId: "job-1", failedAttemptJobId: "job-0" })), undefined)
    expect(JSON.parse(m.fetch.mock.calls[0]![1].body)).toMatchObject({ jobId: "job-1", mode: "from-failed" })
  })

  it("a seed with no failed attempt (it never ran anywhere) runs the node afresh", async () => {
    await executeUseCaseNode(tighten(), wired(), ctx(failedBefore({ status: "skipped", seededFromExecution: "exec-b", completedAt: "t" })), undefined)
    expect(String(m.fetch.mock.calls[0]![0])).toMatch(/\/v1\/tighten-episode$/)
  })

  // Decided 2026-10-18: an attempt is resumed only on the inputs and settings
  // it ran with; anything else runs the node fresh, charged once for that run.
  describe("the attempt is held to the node's current inputs first", () => {
    const carried = { status: "skipped", seededFromExecution: "exec-b", completedAt: "t", failedAttemptJobId: "job-0" }
    const freshOnly = () => {
      expect(paths()).toEqual(["/v1/tighten-episode"])
      expect(m.fetch).toHaveBeenCalledTimes(1)
    }

    it("unchanged inputs and settings: the attempt is resumed — one continue, no fresh run, no second fee", async () => {
      await executeUseCaseNode(tighten(), wired(), ctx(failedBefore(carried)), undefined)
      expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    })

    it("an audio recording, unchanged: its settings were resolved for audio, and still match — resumed", async () => {
      m.rows.set("job-0", attempt({ input_data: ranWith({ mediaUrl: "https://r2/ep.mp3" }, { kind: "audio" }) }))
      m.graphs.set("exec-in", graphOf("audio"))
      await executeUseCaseNode(tighten(), wired("https://r2/ep.mp3"), ctx(failedBefore()), undefined)
      expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    })

    it("a corrected recording (an upstream node re-ran, or the generation built on did): the node runs fresh on it", async () => {
      await executeUseCaseNode(tighten(), wired("https://r2/ep-fixed.mp4"), ctx(failedBefore(carried)), undefined)
      freshOnly()
      expect(JSON.parse(m.fetch.mock.calls[0]![1].body)).toMatchObject({ mediaUrls: ["https://r2/ep-fixed.mp4"] })
    })

    it("its own failed attempt is held to the same rule: a corrected recording runs fresh", async () => {
      await executeUseCaseNode(tighten(), wired("https://r2/ep-fixed.mp4"), ctx(failedBefore()), undefined)
      freshOnly()
    })

    it("a setting the run's overrides changed (the plan tier): the node runs fresh with it", async () => {
      await executeUseCaseNode(tighten({ planTier: "standard" }), wired(), ctx(failedBefore()), undefined)
      freshOnly()
      expect(JSON.parse(m.fetch.mock.calls[0]![1].body)).toMatchObject({ planTier: "standard" })
    })

    it("music wired now that the attempt ran without: fresh", async () => {
      await executeUseCaseNode(tighten(), { ...wired(), useCaseMusic: "https://r2/bed.mp3" }, ctx(failedBefore()), undefined)
      freshOnly()
    })

    it("an unset setting equal to its default still matches (the route resolved the same default)", async () => {
      m.rows.set("job-0", attempt({ input_data: ranWith({}, { data: { captionStyle: undefined } }) }))
      await executeUseCaseNode(tighten({ captionStyle: undefined }), wired(), ctx(failedBefore()), undefined)
      expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    })

    it("a video recording the attempt rendered as audio, now asked for video: fresh (the kind is the recording's, not a guess)", async () => {
      m.rows.set("job-0", attempt({ input_data: ranWith({}, { data: { output: "audio" } }) }))
      await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
      freshOnly()
    })

    it("the attempt's stored graph cannot be read: its inputs cannot be told, so fresh", async () => {
      m.graphs.clear()
      await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
      freshOnly()
    })

    it("the attempt's run unreadable for a moment: read again, then resumed — never a fresh run on a read error", async () => {
      vi.useFakeTimers()
      try {
        m.runReadErrors = 2
        const run = executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
        await vi.advanceTimersByTimeAsync(3 * USE_CASE_SETTLING_RETRY_MS)
        await run
        expect(paths()).toEqual(["/v1/tighten-episode/continue"])
      } finally {
        vi.useRealTimers()
      }
    })

    it("Chapters is held to the same rule (the descriptor drives it): unchanged resumes, a changed instruction runs fresh", async () => {
      const chapters = (data: Row = {}) => ({ id: "t1", type: "episode-chapters", data: { label: "Chapters", planTier: "premium", ...data } }) as never
      const stored = { type: "episode-chapters", mode: "run", mediaUrl: "https://r2/ep.mp4", _executionId: "exec-ch",
        settings: usecaseDescriptor("episode-chapters" as never).resolveSettings({ planTier: "premium" }, "video") }
      m.rows.set("job-0", attempt({ input_data: stored }))
      m.graphs.set("exec-ch", { nodeType: "episode-chapters", nodes: [{ id: "uc-source", type: "upload-video", data: {} }] })
      await executeUseCaseNode(chapters(), wired(), ctx(failedBefore()), undefined)
      expect(paths()).toEqual(["/v1/episode-chapters/continue"])
      m.fetch.mockClear()
      await executeUseCaseNode(chapters({ instructions: "Shorter chapters" }), wired(), ctx(failedBefore()), undefined)
      expect(paths()).toEqual(["/v1/episode-chapters"])
    })

    it("the attempt's wrapper is gone: fresh, without asking the continue route", async () => {
      m.rows.delete("job-0")
      await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
      freshOnly()
    })

    it("a newer failed generation the route names is continued on the same check (it copied the attempt's inputs)", async () => {
      m.fetch
        .mockResolvedValueOnce(answer(409, { error: { code: "continuation_superseded", message: "A later continuation of this run failed: continue that one." }, jobId: "job-g2" }))
        .mockResolvedValueOnce(answer(202, { jobId: "job-w", executionId: "exec-in" }))
      await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
      expect(paths()).toEqual(["/v1/tighten-episode/continue", "/v1/tighten-episode/continue"])
    })
  })

  const NOTHING = [
    ["not_found", "That run was not found."],
    ["continuation_not_found", "The execution to continue from was not found."],
    ["continuation_not_failed", "Only a run that failed can be continued from where it stopped."],
    ["continuation_subset_required", "Every step of that run completed: there is nothing left to continue."],
  ] as const
  /** The route's real statuses: its own not-found, and CONTINUATION_REFUSAL_STATUS for the rest. */
  const STATUS: Record<string, number> = { not_found: 404, continuation_not_found: 404, continuation_not_failed: 409, continuation_subset_required: 400 }
  const nothing = (code: string, message: string) => answer(STATUS[code]!, { error: { code, message } })
  const paths = () => m.fetch.mock.calls.map((c) => String(c[0]).replace(/^.*\/v1/, "/v1"))

  it.each(NOTHING)("nothing to continue (%s), the recorded wrapper gone: the node runs afresh", async (code, message) => {
    // There when its inputs were checked; gone by the time the route was asked.
    m.rows.delete("job-0")
    m.sequence.set("job-0", [attempt()])
    m.fetch.mockResolvedValueOnce(nothing(code, message)).mockResolvedValueOnce(answer(202, { jobId: "job-w", executionId: "exec-in" }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(paths()).toEqual(["/v1/tighten-episode/continue", "/v1/tighten-episode"])
    expect(JSON.parse(m.fetch.mock.calls[1]![1].body)).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"] })
    expect(out.jobId).toBe("job-w")
  })

  it.each(NOTHING)("nothing to continue (%s), the recorded wrapper completed: its result, none of its credits, no second run", async (code, message) => {
    m.fetch.mockResolvedValueOnce(nothing(code, message))
    m.rows.set("job-0", wrapper({ credits_actual: 942, idempotency_key: "wf-exec-0-t1", input_data: ranWith() }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    expect(out).toEqual({ output: { videoUrl: "https://r2/ep-tight.mp4", json: { v: 1 }, quality: "final" }, jobId: "job-0", creditsUsed: 0 })
  })

  it("nothing to continue, the recorded wrapper still running: waited on (not this run's: never cancelled, none of its credits)", async () => {
    m.fetch.mockResolvedValueOnce(nothing("continuation_not_failed", "Only a run that failed can be continued from where it stopped."))
    m.sequence.set("job-0", [
      attempt(),
      wrapper({ status: "processing", output_data: null, idempotency_key: "wf-exec-0-t1", input_data: ranWith() }),
      wrapper({ status: "processing", output_data: null, idempotency_key: "wf-exec-0-t1", input_data: ranWith() }),
    ])
    m.rows.set("job-0", wrapper({ credits_actual: 942, idempotency_key: "wf-exec-0-t1", input_data: ranWith() }))
    const c = ctx(failedBefore())
    const out = await executeUseCaseNode(tighten(), wired(), c, undefined)
    expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    expect(out).toMatchObject({ jobId: "job-0", creditsUsed: 0 })
    expect((c as unknown as { onJobCreated: ReturnType<typeof vi.fn> }).onJobCreated).toHaveBeenCalledWith("t1", "job-0")
  })

  it.each([
    ["continuation_not_failed", "Only a run that failed can be continued from where it stopped.", "failed"],
    ["continuation_subset_required", "Every step of that run completed: there is nothing left to continue.", "failed"],
    ["continuation_not_failed", "Only a run that failed can be continued from where it stopped.", "cancelled"],
  ])("nothing to continue (%s), the recorded run started and %s: the node fails, nothing charged, no fresh run", async (code, message, status) => {
    m.fetch.mockResolvedValueOnce(nothing(code, message))
    m.rows.set("job-0", wrapper({
      status,
      error_message: "Apply Cut: The render could not read the recording",
      output_data: { json: { v: 1 }, quality: "final", _executionId: "exec-in" },
      input_data: ranWith(),
    }))
    const err = await rejection(executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined))
    expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    expect(err.message).toBe("Apply Cut: The render could not read the recording")
    expect(err.errorCode).toBe(code)
    expect(err.output).toEqual({ json: { v: 1 } })
  })

  it("a started run stamped only on its output (its input stamp failed) counts as started", async () => {
    m.fetch.mockResolvedValueOnce(nothing("continuation_not_failed", "Only a run that failed can be continued from where it stopped."))
    m.rows.set("job-0", wrapper({ status: "cancelled", error_message: null, output_data: { _executionId: "exec-in", quality: "final" }, input_data: ranWith({ _executionId: undefined }) }))
    const err = await rejection(executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined))
    expect(err.message).toBe(CANNOT_CONTINUE_MESSAGE)
    expect(paths()).toEqual(["/v1/tighten-episode/continue"])
  })

  it.each(["failed", "cancelled"])("the attempt's run never started (%s before its run began): nothing to resume, the node runs afresh", async (status) => {
    m.rows.set("job-0", wrapper({ status, error_message: "The run could not start", output_data: null, input_data: ranWith({ _executionId: undefined }) }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(paths()).toEqual(["/v1/tighten-episode"])
    expect(out.jobId).toBe("job-w")
  })

  it("a plain re-run (no run being continued) runs fresh whatever the node did before", async () => {
    await executeUseCaseNode(tighten(), wired(), ctx(), undefined)
    expect(paths()).toEqual(["/v1/tighten-episode"])
  })

  it("nothing to continue, the recorded wrapper unreadable for a moment: read again, never a fresh run on a read error", async () => {
    vi.useFakeTimers()
    try {
      m.fetch.mockResolvedValueOnce(nothing("continuation_not_failed", "Only a run that failed can be continued from where it stopped."))
      m.rows.set("job-0", wrapper({ idempotency_key: "wf-exec-0-t1", input_data: ranWith() }))
      // The inputs check reads it first (and reads it again), then the recorded-wrapper read.
      m.readErrors = 2
      const run = executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
      await vi.advanceTimersByTimeAsync(4 * USE_CASE_SETTLING_RETRY_MS)
      await expect(run).resolves.toMatchObject({ jobId: "job-0", creditsUsed: 0 })
      expect(paths()).toEqual(["/v1/tighten-episode/continue"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("any other refusal of the continue fails the node (it never quietly starts a second run)", async () => {
    m.fetch.mockResolvedValue(answer(402, { error: { code: "insufficient_credits", message: "Continuing this episode is estimated at about 900 credits; your balance is 40." } }))
    await expect(executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)).rejects.toThrow(/balance/)
    expect(m.fetch).toHaveBeenCalledTimes(1)
  })

  it("a newer generation that failed too (continuation_superseded) is the one continued", async () => {
    m.fetch
      .mockResolvedValueOnce(answer(409, { error: { code: "continuation_superseded", message: "A later continuation of this run failed: continue that one." }, jobId: "job-g2" }))
      .mockResolvedValueOnce(answer(202, { jobId: "job-w", executionId: "exec-in" }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(JSON.parse(m.fetch.mock.calls[1]![1].body)).toMatchObject({ jobId: "job-g2", mode: "from-failed" })
    expect(m.fetch).toHaveBeenCalledTimes(2)
    expect(out.jobId).toBe("job-w")
  })

  it("a continuation under way that then fails is continued in turn", async () => {
    m.fetch
      .mockResolvedValueOnce(answer(409, { error: { code: "already_running", message: "This run is already being continued." }, jobId: "job-g2" }))
      .mockResolvedValueOnce(answer(202, { jobId: "job-w", executionId: "exec-in" }))
    m.rows.set("job-g2", wrapper({ status: "failed", error_message: "Transcribe: The transcript could not be made", output_data: null }))
    const out = await executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined)
    expect(JSON.parse(m.fetch.mock.calls[1]![1].body)).toMatchObject({ jobId: "job-g2", mode: "from-failed" })
    expect(out.jobId).toBe("job-w")
  })

  it(`follows at most ${MAX_GENERATION_HOPS} newer generations, then fails with the route's copy`, async () => {
    let n = 0
    m.fetch.mockImplementation(async () =>
      answer(409, { error: { code: "continuation_superseded", message: "A later continuation of this run failed: continue that one." }, jobId: `job-g${++n}` }),
    )
    const err = await rejection(executeUseCaseNode(tighten(), wired(), ctx(failedBefore()), undefined))
    expect(err.errorCode).toBe("continuation_superseded")
    expect(err.message).toBe("A later continuation of this run failed: continue that one.")
    expect(m.fetch).toHaveBeenCalledTimes(MAX_GENERATION_HOPS + 1)
  })

  it.each([
    ["it completed there", { status: "completed", jobId: "job-0" }, undefined, []],
    ["it failed with no wrapper recorded", { status: "failed" }, undefined, []],
    ["a fan-out item (per-item wrappers are not told apart)", { status: "failed", jobId: "job-0" }, 1, []],
    ["inside a sub-workflow (not the continued run's node)", { status: "failed", jobId: "job-0" }, undefined, ["sub-1"]],
  ])("a fresh run when %s", async (_label, state, iteration, scope) => {
    await executeUseCaseNode(tighten(), wired(), ctx(failedBefore(state)), iteration, scope)
    expect(m.fetch.mock.calls[0]![0]).toMatch(/\/v1\/tighten-episode$/)
  })
})

