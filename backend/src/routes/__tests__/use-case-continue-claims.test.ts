/**
 * POST /v1/tighten-episode/continue — one continuation per run: one Render
 * final per preview run, a first-run lineage continued only at its newest
 * generation, and the claim that settles requests arriving at once (every
 * failure before the run starts gives it back).
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  ID, USER, completedPreviewWrapper, failedFinalSource, failedSource, failedWrapper, graph, m, nothingWritten, post, previewSource, src,
} from "./helpers/use-case-continue-harness.js"
import { renderFinalEditKey } from "../../lib/use-case/continuation.js"

describe("from-failed: the balance covers what the run still executes plus its fee (before any row)", () => {
  it("priced on the remaining steps of the graph it executes, the fee on top", async () => {
    src.source = { ...failedSource, inputOverrides: { "uc-plan": { planTier: "premium" } } }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    const [nodes, edges, runSet] = src.estimateArgs as [Array<{ id: string; data: Record<string, unknown> }>, unknown[], Set<string>]
    expect([...runSet]).toEqual(["uc-render"])
    expect(edges).toEqual(graph.edges)
    // The earlier run's pin is applied to the graph it is priced on.
    expect(nodes.find((n) => n.id === "uc-plan")!.data.planTier).toBe("premium")
    expect(src.coverArgs.slice(0, 2)).toEqual([USER, 910])
  })

  it("a Render final's chain: every step it had left, no fee", async () => {
    src.wrapper = { ...failedWrapper, input_data: { ...failedWrapper.input_data, mode: "render-final", _feeCredits: 0, _finalOf: "00000000-0000-4000-8000-0000000000bb" } }
    src.source = { ...failedSource, inputOverrides: { "uc-render": { quality: "final" } } }
    await post({ jobId: ID, mode: "from-failed" })
    const [nodes, , runSet] = src.estimateArgs as [Array<{ id: string; data: Record<string, unknown> }>, unknown, Set<string>]
    expect([...runSet]).toEqual(["uc-render", "uc-captions"])
    expect(nodes.find((n) => n.id === "uc-render")!.data.quality).toBe("final")
    expect(src.coverArgs[1]).toBe(900)
  })

  it("a personal payer below it: 402 with the estimate and their balance, no row, no hold", async () => {
    src.cover = { ok: false, balance: 100 }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toEqual({ code: "insufficient_credits", message: "Continuing this episode is estimated at about 910 credits; your balance is 100." })
    nothingWritten()
  })

  it("a deployment payer below it: the operator's words, never the pool's balance", async () => {
    m.payer = { userId: USER, payer: "deployment", payerId: "00000000-0000-4000-8000-0000000000dd" }
    src.cover = { ok: false, balance: 123456 }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toEqual({ code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." })
    expect(res.body).not.toContain("123456")
    expect(src.coverArgs[2]).toEqual(m.payer)
    nothingWritten()
  })

  it("community: no estimate, no balance check", async () => {
    m.credits = false
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    expect(src.estimateArgs).toEqual([])
    expect(src.coverArgs).toEqual([])
  })

  it("render-final does not take this check (it has its own funnel)", async () => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
    await post({ jobId: ID, mode: "render-final" })
    expect(src.coverArgs).toEqual([])
    expect(src.finalCreditsArgs).not.toEqual([])
  })
})

describe("render-final: one per run", () => {
  beforeEach(() => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
  })

  it("the final's wrapper names the run it renders; a from-failed of that final carries it on", async () => {
    await post({ jobId: ID, mode: "render-final" })
    expect(m.insertJob.mock.calls[0]![1].input_data._finalOf).toBe(ID)
    const FINAL = "00000000-0000-4000-8000-0000000000bb"
    // That final failed (its claim on the preview run is free again); the preview run stays.
    src.rows["job-1"] = { ...src.rows["job-1"]!, status: "failed" }
    src.rows[ID] = completedPreviewWrapper
    src.wrapper = { ...failedWrapper, id: FINAL, input_data: { ...failedWrapper.input_data, mode: "render-final", _finalChain: true, _finalOf: ID, _feeCredits: 0 } }
    src.source = failedFinalSource
    await post({ jobId: FINAL, mode: "from-failed" })
    expect(m.insertJob.mock.calls[1]![1].input_data).toMatchObject({ _finalOf: ID, _finalChain: true })
  })

  it("a final wrapper without the mark: its source run is the one it renders", async () => {
    src.rows[ID] = completedPreviewWrapper
    src.wrapper = { ...failedWrapper, id: "00000000-0000-4000-8000-0000000000bb", input_data: { ...failedWrapper.input_data, mode: "render-final", sourceJobId: ID, _feeCredits: 0 } }
    src.source = failedFinalSource
    await post({ jobId: "00000000-0000-4000-8000-0000000000bb", mode: "from-failed" })
    expect(m.insertJob.mock.calls[0]![1].input_data._finalOf).toBe(ID)
  })

  it("a first-run from-failed names no final", async () => {
    src.wrapper = failedWrapper
    src.source = failedSource
    await post({ jobId: ID, mode: "from-failed" })
    expect(m.insertJob.mock.calls[0]![1].input_data).not.toHaveProperty("_finalOf")
    expect(src.finalQueries).toEqual([])
  })

  for (const status of ["processing", "pending", "queued"] as const) {
    it(`another final of this run ${status}: 409 already_running with its job, no row, no hold`, async () => {
      src.existingFinal = { id: "job-final", status }
      const res = await post({ jobId: ID, mode: "render-final" })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({ error: { code: "already_running", message: "A Render final of this run is already in progress." }, jobId: "job-final" })
      nothingWritten()
    })
  }

  it("a final of this run that completed does not block another (decided 2026-10-13): it renders again, no fee", async () => {
    src.existingFinal = { id: "job-final", status: "completed" }
    expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(202)
    // Only a final still under way is asked about.
    expect(src.finalQueries[0]!.statuses).not.toContain("completed")
  })

  describe("the very edit a completed final already rendered (decided 2026-10-13)", () => {
    const EDIT = { v: 1, kind: "edl", basis: "b", edl: { segments: [], dropped: [] } }
    it("the same edit again: 409 render_final_already_rendered naming that final, nothing written", async () => {
      src.existingFinal = { id: "job-final", status: "completed", finalEdit: renderFinalEditKey(EDIT) }
      const res = await post({ jobId: ID, mode: "render-final", editedEdl: EDIT })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({ error: { code: "render_final_already_rendered", message: "Already rendered with this edit." }, jobId: "job-final" })
      nothingWritten()
    })
    it("a changed edit renders again (202), and its wrapper records its edit", async () => {
      src.existingFinal = { id: "job-final", status: "completed", finalEdit: renderFinalEditKey(EDIT) }
      const changed = { ...EDIT, edl: { segments: [{ id: "s0", inMs: 0, outMs: 1000 }], dropped: [] } }
      expect((await post({ jobId: ID, mode: "render-final", editedEdl: changed })).statusCode).toBe(202)
      expect(m.insertJob.mock.calls[0]![1].input_data._finalEdit).toBe(renderFinalEditKey(changed))
    })
    it("no edit twice: the second is refused", async () => {
      expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(202)
      expect(m.insertJob.mock.calls[0]![1].input_data._finalEdit).toBe("none")
      src.existingFinal = { id: "job-1", status: "completed", finalEdit: "none" }
      const res = await post({ jobId: ID, mode: "render-final" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("render_final_already_rendered")
    })
    it("a key is the edit's own fingerprint, whatever the order of its keys", () => {
      expect(renderFinalEditKey({ kind: "edl", v: 1 })).toBe(renderFinalEditKey({ v: 1, kind: "edl" }))
      expect(renderFinalEditKey(undefined)).toBe("none")
    })
  })

  it("a final claim whose final completed is free; one still running blocks", async () => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
    src.rows["job-done"] = { id: "job-done", user_id: USER, status: "completed" }
    src.writes[ID] = { ...completedPreviewWrapper.input_data, _finalClaim: `job-done@${Date.now()}` }
    expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(202)
    src.rows["job-live"] = { id: "job-live", user_id: USER, status: "processing" }
    src.writes[ID] = { ...completedPreviewWrapper.input_data, _finalClaim: `job-live@${Date.now()}` }
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "already_running" }, jobId: "job-live" })
  })

  it("with an idempotency key that is not this request's: still refused", async () => {
    src.existingFinal = { id: "job-final", status: "processing" }
    const res = await post({ jobId: ID, mode: "render-final" }, { "idempotency-key": "another-key-456" })
    expect(res.statusCode).toBe(409)
    nothingWritten()
  })

  it("a keyed retry of the SAME request still gets its run back (202 deduped)", async () => {
    src.existingFinal = { id: "job-final", status: "processing" }
    m.existingByKey = { id: "job-final", provider: "use-case", jobType: "tighten-episode" }
    const res = await post({ jobId: ID, mode: "render-final" }, { "idempotency-key": "client-key-123" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-final", deduped: true })
    nothingWritten()
  })

  for (const status of ["failed", "cancelled"] as const) {
    it(`a final that ${status}: the run may be rendered again`, async () => {
      src.existingFinal = { id: "job-final", status }
      expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(202)
    })
  }

  it("asks only this user's use-case finals of this run", async () => {
    await post({ jobId: ID, mode: "render-final" })
    expect(src.finalQueries[0]!.eqs).toEqual([["user_id", USER], ["provider", "use-case"], ["input_data->>_finalOf", ID]])
    expect(src.finalQueries[0]!.statuses).toEqual(expect.arrayContaining(["pending", "queued", "processing", "pending_review"]))
  })
})

describe("one continuation per run (fix round 1)", () => {
  const FINAL = "00000000-0000-4000-8000-0000000000bb"
  /** Final F1 of the preview run ID failed; the preview run is still there. */
  const failedFinal = () => {
    src.rows[ID] = completedPreviewWrapper
    src.wrapper = { ...failedWrapper, id: FINAL, input_data: { ...failedWrapper.input_data, mode: "render-final", sourceJobId: ID, _finalChain: true, _finalOf: ID, _feeCredits: 0 } }
    src.source = failedFinalSource
  }

  for (const status of ["processing", "completed"] as const) {
    it(`a from-failed of a failed final while another final of the same preview run is ${status}: 409 already_running, nothing written`, async () => {
      failedFinal()
      src.existingFinal = { id: "job-f2", status }
      const res = await post({ jobId: FINAL, mode: "from-failed" })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: "already_running" }, jobId: "job-f2" })
      expect(src.finalQueries[0]!.eqs).toContainEqual(["input_data->>_finalOf", ID])
      nothingWritten()
    })
  }

  for (const status of ["processing", "completed"] as const) {
    it(`a repeated from-failed of the same run while its first is ${status}: 409 already_running, no second fee`, async () => {
      src.existingContinue = { id: "job-c1", status }
      const res = await post({ jobId: ID, mode: "from-failed" })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: "already_running" }, jobId: "job-c1" })
      expect(src.continueQueries[0]!.eqs).toEqual([["user_id", USER], ["provider", "use-case"], ["input_data->>_chainOf", ID]])
      expect(src.orFilters).toContain("input_data->>_executionId.not.is.null,output_data->>_executionId.not.is.null")
      nothingWritten()
    })
  }

  it("a from-failed whose earlier continuation was cancelled may run again", async () => {
    src.existingContinue = { id: "job-c1", status: "cancelled" }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })

  it("the claims: a first run's from-failed on its own wrapper; a Render final, and a from-failed of a final, on the preview run", async () => {
    await post({ jobId: ID, mode: "from-failed" })
    expect(src.writes[ID]!._continuedBy).toMatch(/^job-1@\d+$/)
    // The claim keeps the rest of the wrapper's input.
    expect(src.writes[ID]).toMatchObject({ _executionId: "exec-0", _feeCredits: 10 })
    failedFinal()
    await post({ jobId: FINAL, mode: "from-failed" })
    expect(src.writes[ID]!._finalClaim).toMatch(/^job-2@\d+$/)
    expect(src.writes[FINAL]).toBeUndefined()
  })

  it("two Render finals at once, no key: exactly one wrapper, one run; the other 409 already_running", async () => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
    const [a, b] = await Promise.all([post({ jobId: ID, mode: "render-final" }), post({ jobId: ID, mode: "render-final" })])
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409])
    expect((a.statusCode === 409 ? a : b).json().error.code).toBe("already_running")
    expect(m.insertJob).toHaveBeenCalledTimes(1)
    expect(m.execute).toHaveBeenCalledTimes(1)
  })

  it("two from-faileds at once, no key: exactly one wrapper, one fee, one run", async () => {
    const [a, b] = await Promise.all([post({ jobId: ID, mode: "from-failed" }), post({ jobId: ID, mode: "from-failed" })])
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409])
    expect(m.insertJob).toHaveBeenCalledTimes(1)
    expect(m.reserve).toHaveBeenCalledTimes(1)
    expect(m.execute).toHaveBeenCalledTimes(1)
  })

  it("a refused hold gives the claim back: a later Continue runs", async () => {
    m.reserve.mockImplementationOnce(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
      return undefined
    })
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(402)
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })

  it("a run that cannot start, or an insert that fails, gives the claim back", async () => {
    m.execute.mockRejectedValueOnce(new Error("queue down"))
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(500)
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
    m.insertJob.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(500)
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })

  it("a keyed duplicate racing the insert gives its claim back and gets the run (202 deduped)", async () => {
    m.insertIdem.mockResolvedValueOnce({ created: false, row: { id: "job-0", provider: "use-case", job_type: "tighten-episode" } })
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "client-key-123" })
    expect(res.json()).toEqual({ jobId: "job-0", deduped: true })
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
  })

  it("a claim whose wrapper failed or was cancelled is free; a live one blocks", async () => {
    src.rows["job-x"] = { id: "job-x", user_id: USER, status: "cancelled" }
    src.writes[ID] = { ...failedWrapper.input_data, _continuedBy: `job-x@${Date.now()}` }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    src.rows["job-y"] = { id: "job-y", user_id: USER, status: "processing" }
    src.writes[ID] = { ...failedWrapper.input_data, _continuedBy: `job-y@${Date.now()}` }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "already_running" }, jobId: "job-y" })
  })

  it("a claim with no wrapper behind it blocks while fresh, and is free once stale", async () => {
    src.writes[ID] = { ...failedWrapper.input_data, _continuedBy: `job-ghost@${Date.now()}` }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(409)
    src.writes[ID] = { ...failedWrapper.input_data, _continuedBy: `job-ghost@${Date.now() - 10 * 60_000}` }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })

  it("the continuations cannot be read: 500, nothing written", async () => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
    src.continuationsReadError = { message: "connection reset" }
    expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(500)
    nothingWritten()
  })

  it("editedEdl with from-failed: 400 (it applies to a Render final only)", async () => {
    const res = await post({ jobId: ID, mode: "from-failed", editedEdl: { v: 1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    nothingWritten()
  })
})

describe("first-run lineage: only the newest generation continues (fix round 2)", () => {
  // O (ID) failed → C1 continued O and failed → C2 continued C1.
  const C1 = "00000000-0000-4000-8000-0000000000c1"
  const c1Wrapper = { ...failedWrapper, id: C1, input_data: { ...failedWrapper.input_data, mode: "from-failed", sourceJobId: ID, _chainOf: ID } }

  it("a first continue names its run as the lineage root, and claims it there", async () => {
    await post({ jobId: ID, mode: "from-failed" })
    expect(m.insertJob.mock.calls[0]![1].input_data._chainOf).toBe(ID)
    expect(src.writes[ID]!._continuedBy).toMatch(/^job-1@/)
  })

  it("O → C1 → C2: continuing C1 (the newest, failed) runs; C2 carries the root and the claim sits on O", async () => {
    src.rows[ID] = failedWrapper
    src.wrapper = c1Wrapper
    src.existingContinue = { id: C1, status: "failed" }
    const res = await post({ jobId: C1, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(m.insertJob.mock.calls[0]![1].input_data).toMatchObject({ sourceJobId: C1, _chainOf: ID })
    expect(src.writes[ID]!._continuedBy).toMatch(/^job-1@/)
    expect(src.writes[C1]).toBeUndefined()
  })

  for (const status of ["processing", "completed", "failed"] as const) {
    it(`a stale Continue of O while the newest generation (C2) is ${status}: 409 naming C2, nothing written`, async () => {
      src.existingContinue = { id: "job-c2", status }
      const res = await post({ jobId: ID, mode: "from-failed" })
      expect(res.statusCode).toBe(409)
      // A failed newer generation runs nothing: this one is superseded by it.
      expect(res.json()).toMatchObject({ error: { code: status === "failed" ? "continuation_superseded" : "already_running" }, jobId: "job-c2" })
      nothingWritten()
      expect(src.writes[ID]).toBeUndefined()
    })
  }

  it("a stale Continue of C1 while C2 is live is refused by the claim on O too (the read check aside)", async () => {
    src.rows[ID] = failedWrapper
    src.rows["job-c2"] = { id: "job-c2", user_id: USER, status: "processing" }
    src.writes[ID] = { ...failedWrapper.input_data, _continuedBy: `job-c2@${Date.now()}` }
    src.wrapper = c1Wrapper
    const res = await post({ jobId: C1, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "already_running" }, jobId: "job-c2" })
    nothingWritten()
  })

  it("final chains keep their own key: no lineage read, no root", async () => {
    src.rows[ID] = completedPreviewWrapper
    src.wrapper = { ...failedWrapper, id: C1, input_data: { ...failedWrapper.input_data, mode: "render-final", sourceJobId: ID, _finalChain: true, _finalOf: ID, _feeCredits: 0 } }
    src.source = failedFinalSource
    expect((await post({ jobId: C1, mode: "from-failed" })).statusCode).toBe(202)
    expect(src.continueQueries).toEqual([])
    expect(m.insertJob.mock.calls[0]![1].input_data).not.toHaveProperty("_chainOf")
    expect(src.writes[ID]!._finalClaim).toMatch(/^job-1@/)
  })

  it("a fee hold that throws: the wrapper fails, any hold is refunded, the claim goes back, a clean 500", async () => {
    m.reserve.mockRejectedValueOnce(new Error("pricing table unreadable"))
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(500)
    expect(m.failed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["processing"] }))
    expect(m.refund).toHaveBeenCalledWith("job-1")
    expect(m.execute).not.toHaveBeenCalled()
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })
})

describe("a final's lineage: only its newest generation continues", () => {
  // Preview run ID → final F1 failed → F1′ (from-failed of F1) failed.
  const F1 = "00000000-0000-4000-8000-0000000000f1"
  const F1b = "00000000-0000-4000-8000-0000000000f2"
  const finalWrapper = (id: string, extra: Record<string, unknown>) => ({
    ...failedWrapper, id, input_data: { ...failedWrapper.input_data, _finalChain: true, _finalOf: ID, _feeCredits: 0, ...extra },
  })
  beforeEach(() => {
    src.rows[ID] = completedPreviewWrapper
    src.source = failedFinalSource
  })

  it("a stale Continue of F1 while F1′ (newer, failed) exists: 409 naming F1′, nothing written", async () => {
    src.wrapper = finalWrapper(F1, { mode: "render-final", sourceJobId: ID })
    src.existingFinal = { id: F1b, status: "failed" }
    const res = await post({ jobId: F1, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: "continuation_superseded", message: "A later Render final of this run failed: continue that one." }, jobId: F1b })
    expect(src.finalQueries[0]!.statuses).toContain("failed")
    expect(src.orFilters).toContain("input_data->>_executionId.not.is.null,output_data->>_executionId.not.is.null")
    nothingWritten()
    expect(src.writes[ID]).toBeUndefined()
  })

  it("a Continue of F1′ (the newest) runs, no fee, still that preview run's final", async () => {
    src.wrapper = finalWrapper(F1b, { mode: "from-failed", sourceJobId: F1 })
    src.existingFinal = { id: F1b, status: "failed" }
    expect((await post({ jobId: F1b, mode: "from-failed" })).statusCode).toBe(202)
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.insertJob.mock.calls[0]![1].input_data).toMatchObject({ sourceJobId: F1b, _finalOf: ID, _finalChain: true, _feeCredits: 0 })
    expect(src.writes[ID]!._finalClaim).toMatch(/^job-1@/)
  })

  it("a fresh Render final of the preview run after F1 and F1′ failed: runs", async () => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
    src.existingFinal = { id: F1b, status: "failed" }
    src.rows[F1b] = { id: F1b, user_id: USER, status: "failed" }
    src.writes[ID] = { ...completedPreviewWrapper.input_data, _finalClaim: `${F1b}@${Date.now()}` }
    expect((await post({ jobId: ID, mode: "render-final" })).statusCode).toBe(202)
    expect(m.execute).toHaveBeenCalledTimes(1)
  })
})

describe("a generation whose start stamp never landed still counts (fix round 3)", () => {
  // O → C1 (stamped) failed → C2 started, its stamp failed, it ran and failed:
  // the finaliser named its run on its output (and back-fills its input).
  const C1 = "00000000-0000-4000-8000-0000000000c1"
  const C2 = "00000000-0000-4000-8000-0000000000c2"
  const STARTED = "input_data->>_executionId.not.is.null,output_data->>_executionId.not.is.null"

  it("a generation counts when its run is named on its input OR its output", async () => {
    await post({ jobId: ID, mode: "from-failed" })
    expect(src.orFilters).toEqual([STARTED])
  })

  it("Continue C2 (the true newest, unstamped) runs; Continue C1 is superseded by C2", async () => {
    src.rows[ID] = failedWrapper
    src.existingContinue = { id: C2, status: "failed" }
    src.wrapper = { ...failedWrapper, id: C2, input_data: { ...failedWrapper.input_data, mode: "from-failed", sourceJobId: C1, _chainOf: ID, _executionId: "exec-c2" } }
    expect((await post({ jobId: C2, mode: "from-failed" })).statusCode).toBe(202)
    src.wrapper = { ...failedWrapper, id: C1, input_data: { ...failedWrapper.input_data, mode: "from-failed", sourceJobId: ID, _chainOf: ID } }
    const res = await post({ jobId: C1, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "continuation_superseded" }, jobId: C2 })
  })

  it("the same for a final's lineage: an unstamped failed F1′ supersedes F1", async () => {
    src.rows[ID] = completedPreviewWrapper
    src.source = failedFinalSource
    src.existingFinal = { id: C2, status: "failed" }
    src.wrapper = { ...failedWrapper, id: C1, input_data: { ...failedWrapper.input_data, mode: "render-final", sourceJobId: ID, _finalChain: true, _finalOf: ID, _feeCredits: 0 } }
    const res = await post({ jobId: C1, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "continuation_superseded" }, jobId: C2 })
    expect(src.orFilters).toEqual([STARTED])
    nothingWritten()
  })

  it("the start stamp is tried again before it gives up", async () => {
    let calls = 0
    m.stamp.mockImplementation(() => {
      calls++
      if (calls < 2) throw new Error("socket hang up")
    })
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    expect(calls).toBe(2)
  })
})
