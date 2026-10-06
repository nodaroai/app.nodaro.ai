import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { EDITED_EDL_VERSION, editPlanBasis, normalizeEdl, resolveEditPlanOutput, validateEditedEdl } from "@nodaro/shared"
import { cutRange, keptSetOf } from "../kept-set"
import { createReviewWriter, flushPendingReviews, reviewOf, withPendingReview, REVIEW_WRITE_IDLE_MS, REVIEW_WRITE_MAX_WAIT_MS } from "../write-review"

const raw = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }, { id: "s1", inMs: 2000, outMs: 3000, video: "cam" }],
  dropped: [{ inMs: 1000, outMs: 2000, reason: "filler" }],
  meta: { title: "Episode 12" },
}
const base = normalizeEdl(raw)
const K0 = keptSetOf(base)
const words = [{ text: "So", startMs: 100, endMs: 400 }]

describe("the review a K writes (TA13)", () => {
  it("is the edited cut, against the plan's basis", () => {
    const kept = cutRange(K0, { inMs: 100, outMs: 400 }, words)
    const review = reviewOf(raw, base, kept)!
    expect(review).toMatchObject({ v: EDITED_EDL_VERSION, kind: "edl", basis: editPlanBasis(raw) })
    expect(review.edl.dropped).toContainEqual({ inMs: 100, outMs: 400, reason: "manual" })
    expect(validateEditedEdl(review, raw).ok).toBe(true)
    expect(resolveEditPlanOutput(raw, review).status).toBe("applied")
  })

  it("is nothing when K is back at the plan's: an un-edited plan never shows EDITED (R7 a)", () => {
    expect(reviewOf(raw, base, K0)).toBeUndefined()
    const cut = cutRange(K0, { inMs: 100, outMs: 400 }, words)
    expect(reviewOf(raw, base, [...K0])).toBeUndefined()
    expect(reviewOf(raw, base, cut)).toBeDefined()
  })
})

describe("the pending edit overlay (§2.1: the footer gate never lags the debounced write)", () => {
  const nodes = [
    { id: "plan", type: "edit-plan", data: { generatedJson: raw } },
    { id: "render", type: "apply-edl", data: {} },
  ]

  it("replaces only the plan's editedEdl, without touching the nodes it was given", () => {
    const review = reviewOf(raw, base, cutRange(K0, { inMs: 100, outMs: 400 }, words))
    const overlaid = withPendingReview(nodes, "plan", review)
    expect((overlaid[0]!.data as Record<string, unknown>).editedEdl).toBe(review)
    expect(overlaid[1]).toBe(nodes[1])
    expect("editedEdl" in nodes[0]!.data).toBe(false)
  })

  it("an edit back at the plan overlays no edit", () => {
    const edited = [{ ...nodes[0]!, data: { generatedJson: raw, editedEdl: { stale: true } } }, nodes[1]!]
    const overlaid = withPendingReview(edited, "plan", undefined)
    expect((overlaid[0]!.data as Record<string, unknown>).editedEdl).toBeUndefined()
  })
})

describe("the debounced writer (§2.2)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("writes after 400 ms without an edit, the latest value only", () => {
    const write = vi.fn()
    const writer = createReviewWriter(write)
    writer.schedule(1)
    vi.advanceTimersByTime(200)
    writer.schedule(2)
    vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS - 1)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write.mock.calls).toEqual([[2]])
    expect(writer.pending).toBe(false)
  })

  it("writes at most every 2 s during a burst", () => {
    const write = vi.fn()
    const writer = createReviewWriter(write)
    for (let t = 0; t < REVIEW_WRITE_MAX_WAIT_MS + 300; t += 100) {
      writer.schedule(t)
      vi.advanceTimersByTime(100)
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0]).toBeGreaterThanOrEqual(REVIEW_WRITE_MAX_WAIT_MS - 100)
  })

  it("flush writes the pending value now, once; cancel drops it", () => {
    const write = vi.fn()
    const writer = createReviewWriter(write)
    writer.schedule("a")
    expect(writer.pending).toBe(true)
    writer.flush()
    writer.flush()
    vi.advanceTimersByTime(5000)
    expect(write.mock.calls).toEqual([["a"]])
    writer.schedule("b")
    writer.cancel()
    vi.advanceTimersByTime(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it("flushPendingReviews writes every writer holding a value, and only those", () => {
    const writeA = vi.fn()
    const writeB = vi.fn()
    const writeC = vi.fn()
    const a = createReviewWriter(writeA)
    const b = createReviewWriter(writeB)
    createReviewWriter(writeC) // never scheduled
    a.schedule("a")
    b.schedule("b")
    b.cancel()
    flushPendingReviews()
    expect(writeA.mock.calls).toEqual([["a"]])
    expect(writeB).not.toHaveBeenCalled()
    expect(writeC).not.toHaveBeenCalled()
    // A writer that flushed (its own timer, or a flush) is no longer held.
    flushPendingReviews()
    a.schedule("a2")
    vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS)
    flushPendingReviews()
    expect(writeA.mock.calls).toEqual([["a"], ["a2"]])
  })
})
