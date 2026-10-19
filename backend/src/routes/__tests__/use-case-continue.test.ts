/**
 * POST /v1/tighten-episode/continue. Pins: from-failed holds the run's fee
 * again and runs only what the failed run did not complete (a review-on first
 * part up to its render; a Render final's chain in full, no fee); render-final
 * runs the render at Final and what follows, no fee; one continuation per run,
 * also for requests at once (the claim); every refusal writes nothing; the
 * earlier run's snapshot is executed verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  ID, USER, completedPreviewWrapper, failedFinalSource, failedSource, failedWrapper, graph, m, makeApp, nothingWritten, p1StoredRun, post, previewSource, src,
} from "./helpers/use-case-continue-harness.js"
import {
  EPISODE_CHAPTERS_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildEpisodeChaptersGraph,
  buildTightenEpisodeGraph,
  isStoredInlineGraph,
  toStoredInlineGraph,
  usecaseGraphHash,
} from "@nodaro/render-rules"
import { InlineGraphUnavailableError } from "@/services/use-case-execution.js"

describe("from-failed", () => {
  it("a new wrapper, fee reserved again, the inner run continues from the failed one over what did not finish", async () => {
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-1", executionId: "exec-1" })
    expect(m.reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:tighten-episode")
    // The hold is the fee the run's first wrapper recorded.
    expect(m.reserveSeen[0]!.creditOverride).toBe(10)
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({
      graph, continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"], wrapperJobId: "job-1",
      reviewerPresent: true, idempotencyKey: "uc-exec-job-1",
    }))
    // The earlier run's snapshot, verbatim — never rebuilt.
    expect(m.execute.mock.calls[0]![0].graph).toBe(graph)
    expect(m.execute.mock.calls[0]![0]).not.toHaveProperty("inputOverrides")
    const row = m.insertJob.mock.calls[0]![1] as Record<string, unknown>
    expect(row).toMatchObject({
      user_id: USER, provider: "use-case", job_type: "tighten-episode", status: "processing",
      input_data: { type: "tighten-episode", mode: "from-failed", sourceJobId: ID, settings: {}, mediaUrl: "https://r2/ep.mp4", durationSec: 3600, _feeCredits: 10 },
    })
    expect(row).not.toHaveProperty("workflow_execution_id")
    expect(row.input_data).not.toHaveProperty("_finalChain")
    expect(m.stamp).toHaveBeenCalledWith({ input_data: expect.objectContaining({ _executionId: "exec-1", _feeCredits: 10 }) })
  })

  it("a run with review off resumes everything it did not complete", async () => {
    const off = toStoredInlineGraph(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } }), TIGHTEN_EPISODE_DEFAULTS)
    src.graph = off
    src.source = { ...failedSource, inlineGraphHash: off.hash }
    await post({ jobId: ID, mode: "from-failed" })
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ nodeIds: ["uc-render", "uc-captions"], reviewerPresent: false })
  })

  it("of a failed Render final: no fee (one fee per run), everything it had left, no preview held", async () => {
    src.wrapper = { ...failedWrapper, input_data: { ...failedWrapper.input_data, mode: "render-final", _feeCredits: 0 } }
    src.source = failedFinalSource
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(m.reserve).not.toHaveBeenCalled()
    const input = m.insertJob.mock.calls[0]![1].input_data
    expect(input).toMatchObject({ _feeCredits: 0, _finalChain: true })
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ nodeIds: ["uc-captions"], reviewerPresent: false, continueMode: "from-failed" })
  })

  it("of a from-failed of a Render final: still that chain — no fee, the steps after the render included", async () => {
    src.wrapper = { ...failedWrapper, input_data: { ...failedWrapper.input_data, mode: "from-failed", _finalChain: true, _feeCredits: 0 } }
    src.source = { ...failedSource, nodeStates: { ...failedSource.nodeStates, "uc-render": { status: "failed" }, "uc-captions": { status: "skipped" } } }
    await post({ jobId: ID, mode: "from-failed" })
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ nodeIds: ["uc-render", "uc-captions"], reviewerPresent: false })
    expect(m.insertJob.mock.calls[0]![1].input_data).toMatchObject({ _feeCredits: 0, _finalChain: true })
  })

  it("a run that did not fail: 409 continuation_not_failed, no row", async () => {
    src.wrapper = { ...failedWrapper, status: "completed" }
    src.source = { ...failedSource, status: "completed" }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_not_failed")
    nothingWritten()
  })

  it("an inner run that failed under a wrapper not yet settled (its fee not yet refunded): 409 continuation_settling, try again", async () => {
    src.wrapper = { ...failedWrapper, status: "processing" }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toEqual({ code: "continuation_settling", message: "That run is still being settled. Try again in a moment." })
    nothingWritten()
  })

  it("nothing left to run: refused, no row", async () => {
    src.source = { ...failedSource, nodeStates: { ...failedSource.nodeStates, "uc-render": { status: "completed", output: { quality: "proxy" } } } }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("continuation_subset_required")
    nothingWritten()
  })

  it("the fee hold is refused: no run starts", async () => {
    m.reserve.mockImplementation(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
      return undefined
    })
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(402)
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.failed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["processing"] }))
  })

  it("community (no credits): no fee held, still continues", async () => {
    m.credits = false
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.insertJob.mock.calls[0]![1].input_data._feeCredits).toBe(0)
  })

  it("internal lane: a resumed preview with no reviewer in the parent run is refused (409) before any row", async () => {
    m.authKind = "internal"
    const res = await post({ jobId: ID, mode: "from-failed", userId: USER })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("preview_review_required")
    nothingWritten()
  })

  it("internal lane: the parent's reviewer, payer and depth ride the run", async () => {
    m.authKind = "internal"
    const payer = { userId: USER, payer: "user" }
    await post({ jobId: ID, mode: "from-failed", userId: USER, reviewerPresent: true, billingContext: payer, componentDepth: 2, executingComponentIds: ["c1"] })
    expect(m.reserveSeen[0]!.billingContext).toEqual(payer)
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true, billingContext: payer, componentDepth: 2, executingComponentIds: ["c1"] })
  })

  it("internal lane: depth 5 is refused", async () => {
    m.authKind = "internal"
    const res = await post({ jobId: ID, mode: "from-failed", userId: USER, componentDepth: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("nesting_too_deep")
    nothingWritten()
  })
})

describe("render-final", () => {
  beforeEach(() => {
    src.wrapper = completedPreviewWrapper
    src.source = previewSource
  })

  it("re-runs the render and what follows at final, the reviewer's edit on the plan, NO fee", async () => {
    const edit = { v: 1, kind: "edl", edl: { segments: [] } }
    const res = await post({ jobId: ID, mode: "render-final", editedEdl: edit })
    expect(res.statusCode).toBe(202)
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.insertJob.mock.calls[0]![1].input_data).toMatchObject({ mode: "render-final", _feeCredits: 0, _finalChain: true, sourceJobId: ID })
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({
      continueFromExecutionId: "exec-0", nodeIds: ["uc-render", "uc-captions"], reviewerPresent: false,
      inputOverrides: { "uc-render": { quality: "final" }, "uc-plan": { editedEdl: edit } },
    }))
    expect(m.execute.mock.calls[0]![0]).not.toHaveProperty("continueMode")
    expect(m.execute.mock.calls[0]![0].graph).toBe(graph)
  })

  it("is priced on the run it executes: its nodes, the render at Final", async () => {
    await post({ jobId: ID, mode: "render-final" })
    const arg = src.finalCreditsArgs[0] as { runNodeIds: string[]; overrides: unknown; userId: string }
    expect(arg).toMatchObject({ userId: USER, runNodeIds: ["uc-render", "uc-captions"], overrides: { "uc-render": { quality: "final" } } })
  })

  it("the quote's plan node holds the run's plan (that quote only), so the reviewer's edit is priced on its own length", async () => {
    const plan = { version: 1, clock: "master", sources: [], segments: [{ id: "s0", inMs: 0, outMs: 30_000 }] }
    src.source = { ...previewSource, nodeStates: { ...previewSource.nodeStates, "uc-plan": { status: "completed", output: { json: plan } } } }
    const edit = { v: 1, kind: "edl", edl: { segments: [], dropped: [] } }
    await post({ jobId: ID, mode: "render-final", editedEdl: edit })
    const arg = src.finalCreditsArgs[0] as { nodes: Array<{ id: string; data: Record<string, unknown> }>; overrides: Record<string, Record<string, unknown>> }
    expect(arg.nodes.find((n) => n.id === "uc-plan")!.data.generatedJson).toEqual(plan)
    expect(arg.overrides["uc-plan"]).toEqual({ editedEdl: edit })
    // The run itself is sent no plan: only the reviewer's edit.
    expect(m.execute.mock.calls[0]![0].inputOverrides["uc-plan"]).toEqual({ editedEdl: edit })
  })

  it("a seed whose review was applied: the quote reads the plan as planned (plannedJson)", async () => {
    const planned = { version: 1, clock: "master", sources: [], segments: [{ id: "s0", inMs: 0, outMs: 30_000 }] }
    src.source = { ...previewSource, nodeStates: { ...previewSource.nodeStates, "uc-plan": { status: "completed", output: { json: { applied: true }, plannedJson: planned } } } }
    await post({ jobId: ID, mode: "render-final" })
    const arg = src.finalCreditsArgs[0] as { nodes: Array<{ id: string; data: Record<string, unknown> }> }
    expect(arg.nodes.find((n) => n.id === "uc-plan")!.data.generatedJson).toEqual(planned)
  })

  it("a run whose plan state holds no plan: the quote's plan node is as stored", async () => {
    await post({ jobId: ID, mode: "render-final" })
    const arg = src.finalCreditsArgs[0] as { nodes: Array<{ id: string; data: Record<string, unknown> }> }
    expect(arg.nodes.find((n) => n.id === "uc-plan")!.data).not.toHaveProperty("generatedJson")
  })

  it("without an edit: only the render's Final", async () => {
    await post({ jobId: ID, mode: "render-final" })
    expect(m.execute.mock.calls[0]![0].inputOverrides).toEqual({ "uc-render": { quality: "final" } })
  })

  it("a run that is not a held preview: 409 render_final_not_preview, no row", async () => {
    src.source = { ...previewSource, nodeStates: { ...previewSource.nodeStates, "uc-render": { status: "completed", output: { videoUrl: "x", quality: "final" } } } }
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("render_final_not_preview")
    nothingWritten()
  })

  it("a run that has not completed: 409 continuation_not_completed, no row", async () => {
    src.wrapper = failedWrapper
    src.source = failedSource
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_not_completed")
    nothingWritten()
  })

  it("the balance cannot cover it: 402 with the payer's own words, no row", async () => {
    src.finalCredits = { estimatedCredits: 600, sufficient: false, available: null, message: "This deployment is out of credits. Contact your administrator." }
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toEqual({ code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." })
    nothingWritten()
  })
})

describe("refused before any row, hold or run", () => {
  for (const [name, setup, status, code] of [
    ["another user's wrapper", () => { src.wrapper = { ...failedWrapper, user_id: "someone-else" } }, 404, "not_found"],
    ["not a use-case wrapper", () => { src.wrapper = { ...failedWrapper, provider: "component" } }, 404, "not_found"],
    ["another use-case's wrapper", () => { src.wrapper = { ...failedWrapper, input_data: { ...failedWrapper.input_data, type: "clip-pack" } } }, 404, "not_found"],
    ["no such wrapper", () => { src.wrapper = null }, 404, "not_found"],
    ["the snapshot is gone (expunged)", () => { src.graph = null }, 404, "not_found"],
    ["the inner run is another user's", () => { src.source = { ...failedSource, userId: "someone-else" } }, 404, "continuation_not_found"],
    ["the inner run is gone", () => { src.source = null }, 404, "continuation_not_found"],
    ["a snapshot whose hash differs from the run's", () => { src.source = { ...failedSource, inlineGraphHash: "0000000000000000" } }, 400, "continuation_workflow_mismatch"],
    ["a run of a saved workflow", () => { src.source = { ...failedSource, workflowId: "00000000-0000-4000-8000-0000000000ff" } }, 400, "continuation_workflow_mismatch"],
    ["denied in this deployment", () => { m.denied = true }, 403, "node_not_available"],
    ["the snapshot columns are not on this database", () => { m.absent = true }, 503, "use_case_unavailable"],
  ] as const) {
    it(`${name}: ${status} ${code}`, async () => {
      setup()
      const res = await post({ jobId: ID, mode: "from-failed" })
      expect(res.statusCode).toBe(status)
      expect(res.json().error.code).toBe(code)
      nothingWritten()
    })
  }

  it("a bad body: 400 validation_error", async () => {
    const res = await post({ jobId: "nope", mode: "from-failed" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect((await post({ jobId: ID, mode: "again" })).statusCode).toBe(400)
  })

  it("a wrapper that cannot be read: 500, never read as not found", async () => {
    src.wrapperError = { message: "connection reset" }
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(500)
    nothingWritten()
  })
})

describe("one continuation per request", () => {
  it("an unstamped wrapper is found by its run's pointer", async () => {
    const { _executionId: _gone, ...unstamped } = failedWrapper.input_data
    src.wrapper = { ...failedWrapper, input_data: unstamped }
    src.foundExec = "exec-0"
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
    expect(src.graphReads).toEqual(["exec-0"])
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ continueFromExecutionId: "exec-0" })
  })

  it("a keyed retry is answered with its run before the credit guard: nothing new", async () => {
    m.existingByKey = { id: "job-live", provider: "use-case", jobType: "tighten-episode" }
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "client-key-123" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-live", deduped: true })
    expect(m.guardCalls).toBe(0)
    nothingWritten()
  })

  it("a double submit racing the insert: the same wrapper, one fee, one run", async () => {
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-0", provider: "use-case", job_type: "tighten-episode" } })
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "client-key-123" })
    expect(res.json()).toEqual({ jobId: "job-0", deduped: true })
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("the run cannot start: wrapper failed, fee refunded, honest status", async () => {
    m.execute.mockRejectedValue(new InlineGraphUnavailableError())
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("use_case_unavailable")
    expect(m.failed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["processing"] }))
    expect(m.refund).toHaveBeenCalledWith("job-1")
  })

  it("a stamp that throws after the run started never fails the wrapper or refunds the fee", async () => {
    m.stampThrows = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(m.failed).not.toHaveBeenCalled()
    expect(m.refund).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not stamped"))
    warn.mockRestore()
  })
})

// A Tighten Episode run P1 code started — its wrapper and its stored snapshot
// written before the use-case registry — must still be continued and
// Render-finalled after it, on that snapshot verbatim: same hash, same settings.
describe("a run P1 code stored (its output map names no kind)", () => {
  it("is still a valid snapshot of its own hash", () => {
    const { stored, recordedHash } = p1StoredRun("failed")
    expect(isStoredInlineGraph(stored)).toBe(true)
    expect((stored as unknown as { outputMap: Record<string, unknown> }).outputMap).not.toHaveProperty("kind")
    expect(usecaseGraphHash(stored as never)).toBe(stored.hash)
    expect(stored.hash).toBe(recordedHash)
  })

  it("continues from where it failed, on its snapshot and settings as stored", async () => {
    const { stored, wrapper } = p1StoredRun("failed")
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    const run = m.execute.mock.calls[0]![0]
    expect(run.graph).toEqual(stored)
    expect(run.graph.settings).toEqual(stored.settings)
    expect(run).toMatchObject({ continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"], reviewerPresent: true })
    // The new wrapper carries the run's settings on, as the first wrapper recorded them.
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({
      job_type: "tighten-episode",
      input_data: { type: "tighten-episode", mode: "from-failed", settings: wrapper.input_data.settings, _feeCredits: 10 },
    })
    expect(m.reserveSeen[0]!.creditOverride).toBe(10)
  })

  it("renders its final, on its snapshot and settings as stored, no fee", async () => {
    const { stored } = p1StoredRun("completed")
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(202)
    const run = m.execute.mock.calls[0]![0]
    expect(run.graph).toEqual(stored)
    expect(run.graph.settings).toEqual(stored.settings)
    expect(run).toMatchObject({ nodeIds: ["uc-render", "uc-captions"], inputOverrides: { "uc-render": { quality: "final" } } })
    expect(m.reserve).not.toHaveBeenCalled()
  })

  it("a wrapper whose input names no type is read by its job_type", async () => {
    p1StoredRun("failed", { typeOn: "job_type" })
    expect((await post({ jobId: ID, mode: "from-failed" })).statusCode).toBe(202)
  })

  it("a wrapper of another use-case type, named only by its job_type, is not found", async () => {
    const { wrapper } = p1StoredRun("failed", { typeOn: "job_type" })
    src.wrapper = { ...wrapper, job_type: "episode-chapters" }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    nothingWritten()
  })
})

describe("a key already used for another use-case type", () => {
  it("is refused 409, and nothing is created or claimed", async () => {
    m.existingByKey = { id: "job-other", provider: "use-case", jobType: "episode-chapters" }
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "k-reused-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(m.guardCalls).toBe(0)
    nothingWritten()
    expect(src.writes).toEqual({})
  })

  it("racing the insert: refused 409, the claim given back, nothing held or run", async () => {
    // Another type's first request won the key between the lookup and this insert.
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-other", provider: "use-case", job_type: "episode-chapters", run_type: "episode-chapters" } })
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "k-reused-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    // The claim taken on the run was released.
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
  })

  it("a key another kind of job holds (an image generation): refused 409 before anything is claimed or created", async () => {
    m.existingByKey = { id: "job-img", provider: "kie", jobType: "generate-image" }
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "k-image-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(res.body).not.toContain("job-img")
    expect(m.guardCalls).toBe(0)
    nothingWritten()
    expect(src.writes).toEqual({})
  })

  it("a key another kind of job holds, found only by the insert: refused 409, the claim given back", async () => {
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-img", provider: "kie", job_type: "generate-image", run_type: null } })
    const res = await post({ jobId: ID, mode: "from-failed" }, { "idempotency-key": "k-image-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(res.body).not.toContain("job-img")
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    expect(src.writes[ID]).not.toHaveProperty("_continuedBy")
  })
})

describe("Chapters on its own continue route", () => {
  const chaptersStored = toStoredInlineGraph(
    buildEpisodeChaptersGraph(EPISODE_CHAPTERS_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } }),
    EPISODE_CHAPTERS_DEFAULTS,
  )
  const chaptersWrapper = { ...failedWrapper, job_type: "episode-chapters", input_data: { ...failedWrapper.input_data, type: "episode-chapters" } }
  const chaptersFailed = {
    ...failedSource,
    inlineGraphHash: chaptersStored.hash,
    nodeStates: { "uc-source": { status: "completed" }, "uc-transcribe": { status: "completed" }, "uc-plan": { status: "failed" } },
  }
  const postTo = async (type: string, payload: Record<string, unknown>) =>
    (await makeApp()).inject({ method: "POST", url: `/v1/${type}/continue`, payload })
  const asChapters = (status: "failed" | "completed") => {
    src.wrapper = { ...chaptersWrapper, status }
    src.graph = chaptersStored
    src.source = { ...chaptersFailed, status, ...(status === "completed" ? { nodeStates: { ...chaptersFailed.nodeStates, "uc-plan": { status: "completed" } } } : {}) }
  }

  it("from-failed: a new Chapters wrapper, its own fee held again, what did not finish runs", async () => {
    asChapters("failed")
    const res = await postTo("episode-chapters", { jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(m.reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:episode-chapters")
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ job_type: "episode-chapters", input_data: expect.objectContaining({ type: "episode-chapters", mode: "from-failed" }) })
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ nodeIds: ["uc-plan"], reviewerPresent: false, continueMode: "from-failed" })
  })

  it("a Tighten run on Chapters' door is not found, and nothing is written", async () => {
    const res = await postTo("episode-chapters", { jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    nothingWritten()
  })

  it("a Chapters run on Tighten's door is not found, and nothing is written", async () => {
    asChapters("failed")
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    nothingWritten()
  })

  it("Render final of a run that renders nothing: 409 render_final_not_preview, no row, no hold", async () => {
    asChapters("completed")
    const res = await postTo("episode-chapters", { jobId: ID, mode: "render-final" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("render_final_not_preview")
    nothingWritten()
    expect(src.writes).toEqual({})
  })
})
