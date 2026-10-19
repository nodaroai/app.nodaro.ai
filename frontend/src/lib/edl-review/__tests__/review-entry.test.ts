// Where a review can be opened (A3-5, R17 a, R18 a): a render with an Edit Plan
// cut or a clip set behind it, whatever its take; the plan opens at the renders
// it feeds. The entry names which inspector it opens: the cut review for a
// Tighten EDL, the Clip Pack inspector for a clip set (A4-2).
import { describe, expect, it } from "vitest"
import { reviewEntryOf, reviewKindOf, reviewRendersOf, reviewTargetOf } from "../review-entry"

const TIGHTEN = { version: 1, clock: "master", sources: [], segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }], dropped: [] }
const CLIPS = [TIGHTEN, TIGHTEN]
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string, targetHandle = "edl") => ({ id: `${source}-${target}`, source, target, sourceHandle: "edl", targetHandle })

describe("reviewEntryOf", () => {
  it("is the plan behind a render whose plan holds a Tighten EDL, with or without a take", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("r", "apply-edl", { quality: "final" })]
    expect(reviewEntryOf("r", nodes, [edge("p", "r")])).toEqual({ planId: "p", kind: "edl" })
  })

  it("follows the wire through Camera Switch", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("s", "camera-switch"), node("r", "apply-edl")]
    expect(reviewEntryOf("r", nodes, [edge("p", "s"), edge("s", "r")])).toEqual({ planId: "p", kind: "edl" })
  })

  it("is null with no plan behind the render", () => {
    expect(reviewEntryOf("r", [node("r", "apply-edl")], [])).toBeNull()
  })

  it("is null before the plan has run", () => {
    const nodes = [node("p", "edit-plan"), node("r", "apply-edl")]
    expect(reviewEntryOf("r", nodes, [edge("p", "r")])).toBeNull()
  })

  it("is the Clip Pack's review for a clip set (A4-2), through a Camera Switch too", () => {
    const clips = [node("p", "edit-plan", { generatedJson: CLIPS }), node("r", "apply-edl")]
    expect(reviewEntryOf("r", clips, [edge("p", "r")])).toEqual({ planId: "p", kind: "clips" })
    const switched = [node("p", "edit-plan", { generatedJson: CLIPS }), node("s", "camera-switch"), node("r", "apply-edl")]
    expect(reviewEntryOf("r", switched, [edge("p", "s"), edge("s", "r")])).toEqual({ planId: "p", kind: "clips" })
  })

  it("is null for a chapter list", () => {
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

  it("lists a clip set's renders too: their review is the Clip Pack's (A4-2)", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: CLIPS }), node("a", "apply-edl")]
    expect(reviewRendersOf("p", nodes, [edge("p", "a")]).map((n) => n.id)).toEqual(["a"])
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

  it("a clip set's plan and its render name themselves too", () => {
    const clips = [node("cp", "edit-plan", { generatedJson: CLIPS }), node("cr", "apply-edl")]
    expect(reviewTargetOf("cp", clips, [edge("cp", "cr")])).toBe("cr")
    expect(reviewTargetOf("cr", clips, [edge("cp", "cr")])).toBe("cr")
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

describe("reviewKindOf (which inspector a render opens)", () => {
  it("names the kind, or null where nothing opens", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: TIGHTEN }), node("r", "apply-edl"), node("cp", "edit-plan", { generatedJson: CLIPS }), node("cr", "apply-edl")]
    const edges = [edge("p", "r"), edge("cp", "cr")]
    expect(reviewKindOf("r", nodes, edges)).toBe("edl")
    expect(reviewKindOf("cr", nodes, edges)).toBe("clips")
    expect(reviewKindOf("p", nodes, edges)).toBeNull()
  })
})

describe("a Clip Pack node (its plan and its renders are its own run's)", () => {
  const rec = node("rec", "upload-video", { url: "https://r2/ep.mp4" })
  const wire = { id: "w", source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" }
  const pack = (data: Record<string, unknown>) => node("cp", "clip-pack", { reviewBeforeRender: true, ...data })

  it("opens the Clip Pack inspector on itself once its run holds a clip set", () => {
    const nodes = [rec, pack({ generatedJson: CLIPS })]
    expect(reviewEntryOf("cp", nodes, [wire])).toEqual({ planId: "cp", kind: "clips" })
    expect(reviewKindOf("cp", nodes, [wire])).toBe("clips")
    expect(reviewTargetOf("cp", nodes, [wire])).toBe("cp")
    expect(reviewRendersOf("cp", nodes, [wire]).map((n) => n.id)).toEqual(["cp"])
  })

  it("opens nothing before its run has planned, or on a plan that is not a clip set", () => {
    expect(reviewKindOf("cp", [rec, pack({})], [wire])).toBeNull()
    expect(reviewKindOf("cp", [rec, pack({ generatedJson: TIGHTEN })], [wire])).toBeNull()
  })

  it("opens nothing when a list drives it (one run per item: no single run to review)", () => {
    const list = node("ls", "list", {
      columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }],
      rows: [["https://r2/a.mp4"], ["https://r2/b.mp4"]],
    })
    const fed = { id: "lw", source: "ls", target: "cp", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } }
    expect(reviewKindOf("cp", [list, pack({ generatedJson: CLIPS })], [fed])).toBeNull()
  })
})
