// @test-units-by-name continues runs of the use-case type it names (tighten-episode)
/**
 * A failed tool of a podcast pack re-runs free until it succeeds (decided
 * 2026-11-18), and its Render final is free too: a continuation whose SOURCE
 * wrapper names a pack that covers it (lib/use-case/pack-cover.ts) owes no
 * fee and no balance check, and its new wrapper names the pack, so its steps
 * hold 0 as well. The request's own word is never read: a source no pack
 * covers continues as an ordinary, charged run.
 */
import { describe, it, expect } from "vitest"
import { ID, USER, completedPreviewWrapper, failedWrapper, m, post, previewSource, src } from "./helpers/use-case-continue-harness.js"

const PACK = "55555555-5555-4555-8555-555555555555"
const inputOf = () => (m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
const packRow = (over: Record<string, unknown> = {}) => ({
  id: PACK, user_id: USER, provider: "podcast-pack", status: "completed", input_data: { tools: ["tighten-episode"] }, ...over,
})
const covered = <T extends { input_data: Record<string, unknown> }>(w: T): T => ({ ...w, input_data: { ...w.input_data, _coveredBy: PACK } })

describe("continuing a run its podcast pack paid for", () => {
  it("from-failed: no fee, no balance check, and the new wrapper names the pack", async () => {
    src.wrapper = covered(failedWrapper)
    src.rows[PACK] = packRow()
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode, res.body).toBe(202)
    expect(src.coverArgs).toEqual([])
    expect(m.reserve).not.toHaveBeenCalled()
    expect(inputOf()).toMatchObject({ _coveredBy: PACK, _feeCredits: 0 })
  })

  it("render-final: free, and named the same way", async () => {
    src.wrapper = covered(completedPreviewWrapper)
    src.source = previewSource
    src.rows[PACK] = packRow()
    const res = await post({ jobId: ID, mode: "render-final" })
    expect(res.statusCode, res.body).toBe(202)
    expect(src.finalCreditsArgs).toEqual([])
    expect(inputOf()).toMatchObject({ _coveredBy: PACK, _feeCredits: 0 })
  })

  it.each([
    ["another tool", { input_data: { tools: ["clip-pack"] } }],
    ["another owner", { user_id: "00000000-0000-4000-8000-0000000000ff" }],
    ["a failed pack", { status: "failed" }],
  ])("a pack that no longer covers it (%s): an ordinary, charged continuation", async (_name, over) => {
    src.wrapper = covered(failedWrapper)
    src.rows[PACK] = packRow(over)
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(src.coverArgs.length).toBeGreaterThan(0)
    expect(inputOf()).not.toHaveProperty("_coveredBy")
    expect(inputOf()._feeCredits).toBe(10)
  })

  it("a pack held for review: the continuation is refused, never charged in its place", async () => {
    src.wrapper = covered(failedWrapper)
    src.rows[PACK] = packRow({ status: "pending_review" })
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("pack_under_review")
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
  })

  it("the request's own word is never read", async () => {
    src.wrapper = failedWrapper
    src.rows[PACK] = packRow()
    const res = await post({ jobId: ID, mode: "from-failed", __coveredBy: PACK })
    expect(res.statusCode).toBe(202)
    expect(inputOf()).not.toHaveProperty("_coveredBy")
    expect(inputOf()._feeCredits).toBe(10)
  })
})
