// Where a review can be opened (A3-5, R17 a, R18 a): a render with an Edit Plan
// cut behind it, whatever its take; the plan opens at the renders it feeds; a
// clip set's review is the Clip Pack inspector's (A4), not this one.
import { describe, expect, it } from "vitest"
import { reviewEntryOf, reviewRendersOf, reviewTargetOf } from "../review-entry"

const TIGHTEN = { version: 1, clock: "master", sources: [], segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }], dropped: [] }
const CLIPS = [TIGHTEN, TIGHTEN]
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string, targetHandle = "edl") => ({ id: `${source}-${target}`, source, target, sourceHandle: "edl", targetHandle })

describe("reviewEntryOf", () => {
  it("is the plan behind a render whose plan holds a Tighten EDL, with or without a take", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("r", "apply-edl", { quality: "final" })]
    expect(reviewEntryOf("r", nodes, [edge("p", "r")])).toEqual({ planId: "p" })
  })

  it("follows the wire through Camera Switch", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("s", "camera-switch"), node("r", "apply-edl")]
    expect(reviewEntryOf("r", nodes, [edge("p", "s"), edge("s", "r")])).toEqual({ planId: "p" })
  })

  it("is null with no plan behind the render", () => {
    expect(reviewEntryOf("r", [node("r", "apply-edl")], [])).toBeNull()
  })

  it("is null before the plan has run", () => {
    const nodes = [node("p", "edit-plan"), node("r", "apply-edl")]
    expect(reviewEntryOf("r", nodes, [edge("p", "r")])).toBeNull()
  })

  it("is null for a clip set (its review is A4's) and for a chapter list", () => {
    const clips = [node("p", "edit-plan", { generatedJson: CLIPS }), node("r", "apply-edl")]
    expect(reviewEntryOf("r", clips, [edge("p", "r")])).toBeNull()
    const chapters = [node("p", "edit-plan", { generatedJson: { version: 1, chapters: [] } }), node("r", "apply-edl")]
    expect(reviewEntryOf("r", chapters, [edge("p", "r")])).toBeNull()
  })

  it("is null for a node that is not a render", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("t", "transcribe")]
    expect(reviewEntryOf("t", nodes, [edge("p", "t")])).toBeNull()
    expect(reviewEntryOf("missing", nodes, [])).toBeNull()
  })
})

describe("reviewRendersOf", () => {
  it("lists the renders of a plan that can be reviewed, in canvas order", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("a", "apply-edl"), node("b", "apply-edl"), node("c", "apply-edl")]
    expect(reviewRendersOf("p", nodes, [edge("p", "a"), edge("p", "b")]).map((n) => n.id)).toEqual(["a", "b"])
  })

  it("is empty for a clip set, whose renders have no cut review", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: CLIPS }), node("a", "apply-edl")]
    expect(reviewRendersOf("p", nodes, [edge("p", "a")])).toEqual([])
  })
})

describe("reviewTargetOf (what ?review= names)", () => {
  const nodes = [
    node("p", "edit-plan", { generatedJson: TIGHTEN }),
    node("a", "apply-edl"),
    node("b", "apply-edl"),
    node("lone", "edit-plan", { generatedJson: TIGHTEN }),
    node("t", "transcribe"),
  ]
  const edges = [edge("p", "a"), edge("p", "b")]

  it("a render names itself", () => {
    expect(reviewTargetOf("b", nodes, edges)).toBe("b")
  })

  it("a plan names the first render it feeds (the header's picker chooses among the rest)", () => {
    expect(reviewTargetOf("p", nodes, edges)).toBe("a")
  })

  it("a plan that feeds no render, a node of another kind and an unknown id name nothing", () => {
    expect(reviewTargetOf("lone", nodes, edges)).toBeNull()
    expect(reviewTargetOf("t", nodes, edges)).toBeNull()
    expect(reviewTargetOf("nope", nodes, edges)).toBeNull()
  })

  it("a render with no plan behind it names nothing: there is nothing to review", () => {
    expect(reviewTargetOf("a", [node("a", "apply-edl")], [])).toBeNull()
  })
})
