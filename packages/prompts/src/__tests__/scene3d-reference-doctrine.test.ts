/**
 * Scene3D layout-reference doctrine — the wording the 2026-09-10 greybox
 * experiment's Seedance A/B rerun quotes verbatim, pinned byte-for-byte, plus
 * the still/clip/cuts variants, the re-run idempotence key and the rule-2
 * warning builder.
 */
import { describe, it, expect } from "vitest"
import {
  buildScene3DLayoutScopingLine,
  buildScene3DUnreferencedFiguresWarning,
  hasScene3DLayoutScopingLine,
  renderScene3DLayoutScopingLine,
  SCENE3D_FIGURE_REFERENCE_RULE,
  SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE,
  SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE,
  SCENE3D_LAYOUT_SCOPING_MARKER,
  SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE,
} from "../scene3d-reference-doctrine.js"
import { renderReferenceCaptionLines } from "../described-references.js"

const CLIP =
  "LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing, its camera angle, its camera motion and its timing. " +
  "Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. " +
  "Take the look from the prompt and from the other references"

const STILL =
  "LAYOUT reference only — match its subject positions and blocking, its foreground occlusion, its framing and its camera angle. " +
  "Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look. " +
  "Take the look from the prompt and from the other references"

describe("SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE — the fixture the A/B rerun quotes", () => {
  it("is the clip caption: what the reference is for, then what to ignore, plainly", () => {
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE).toBe(CLIP)
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clip).toBe(CLIP)
  })

  it("is a caption, not a line: no leading binding, no trailing full stop (the renderer adds both)", () => {
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE.startsWith(SCENE3D_LAYOUT_SCOPING_MARKER)).toBe(true)
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE.endsWith(".")).toBe(false)
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE).not.toContain("@video")
  })

  it("renders on its seat exactly as the platform's rail-caption renderer renders it", () => {
    const platform = renderReferenceCaptionLines([SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE], undefined, { video: 1, audio: 0 })
    expect(platform).toEqual([SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered])
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered).toBe(`@video_1: ${CLIP}.`)
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.stillRendered).toBe(`@image_1: ${STILL}.`)
  })

  it("still: drops the motion, timing and cut clauses a single frame cannot carry", () => {
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.still).toBe(STILL)
    // A still with clip-only facts still reads as a still.
    expect(buildScene3DLayoutScopingLine({ carries: "still", shots: 4, includesCameraMotion: true })).toBe(STILL)
  })

  it("clip with several shots names the cut points; one shot is not a cut", () => {
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipWithCuts).toContain(
      "its camera angle, its camera motion, its 4 shots and where they cut and its timing.",
    )
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clip).not.toContain("where they cut")
  })

  it("clip without a camera move keeps timing but claims no motion", () => {
    const line = buildScene3DLayoutScopingLine({ carries: "clip", includesCameraMotion: false })
    expect(line).not.toContain("camera motion")
    expect(line).toContain("its camera angle and its timing.")
  })

  it("names what to ignore explicitly — every property of the clay look — and never the target look", () => {
    for (const word of ["grey clay placeholder look", "placeholder colours", "materials", "lighting", "empty background"]) {
      expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE).toContain(word)
    }
    expect(SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE.toLowerCase()).not.toContain("photoreal")
  })

  it("renderScene3DLayoutScopingLine trims the binding", () => {
    expect(renderScene3DLayoutScopingLine(" @image_3 ", { carries: "still" }).startsWith("@image_3: LAYOUT")).toBe(true)
  })
})

describe("hasScene3DLayoutScopingLine — the re-run idempotence key", () => {
  it("recognises the platform's rendered line, per binding", () => {
    const prompt = `A brief.\n${SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE.clipRendered}`
    expect(hasScene3DLayoutScopingLine(prompt, "@video_1")).toBe(true)
    expect(hasScene3DLayoutScopingLine(prompt, "@video_2")).toBe(false)
    expect(hasScene3DLayoutScopingLine(prompt, "@video_10")).toBe(false)
  })

  it("recognises a hand-typed sentence and an older wording, so a pasted line is not doubled", () => {
    expect(hasScene3DLayoutScopingLine("@video_1 is a LAYOUT reference only: match its seating.", "@video_1")).toBe(true)
    expect(hasScene3DLayoutScopingLine("@image_2 is an LAYOUT reference only", "@image_2")).toBe(true)
    expect(hasScene3DLayoutScopingLine("Two people at a table. @video_1 is a great clip.", "@video_1")).toBe(false)
  })

  it("is false on nothing", () => {
    expect(hasScene3DLayoutScopingLine(undefined, "@video_1")).toBe(false)
    expect(hasScene3DLayoutScopingLine("", "@video_1")).toBe(false)
  })
})

describe("buildScene3DUnreferencedFiguresWarning — rule 2 as a warning, never a block", () => {
  it("warns when figures outnumber character references", () => {
    const w = buildScene3DUnreferencedFiguresWarning({ figureCount: 6, characterReferenceCount: 1 })
    expect(w).toBeDefined()
    expect(w?.code).toBe(SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE)
    expect(w?.missing).toBe(5)
    expect(w?.message).toBe(
      "The layout reference shows 6 figures but 1 character reference is attached. " +
        "A figure without its own character reference takes the clay look of the layout reference. " +
        "Attach one character reference per figure (5 more).",
    )
  })

  it("states the budget when the image-reference cap is known — a clip rides the video rail", () => {
    const fits = buildScene3DUnreferencedFiguresWarning({ figureCount: 6, characterReferenceCount: 0, imageReferenceCap: 9 })
    expect(fits?.message).toContain("this model takes 9 image references, which leaves 3 for a location or style plate.")
    const tight = buildScene3DUnreferencedFiguresWarning({ figureCount: 8, characterReferenceCount: 0, imageReferenceCap: 9 })
    expect(tight?.message).toContain("does not fit — reference the figures that matter most first.")
  })

  it("counts the seat a still layout reference occupies against the same budget", () => {
    const still = buildScene3DUnreferencedFiguresWarning({
      figureCount: 6,
      characterReferenceCount: 0,
      imageReferenceCap: 9,
      layoutReferenceImageSeats: 1,
    })
    expect(still?.message).toContain("leaves 2 for a location or style plate.")
  })

  it("stays silent when every figure has a reference, when there are no figures, or when the count is unknown", () => {
    expect(buildScene3DUnreferencedFiguresWarning({ figureCount: 2, characterReferenceCount: 2 })).toBeUndefined()
    expect(buildScene3DUnreferencedFiguresWarning({ figureCount: 2, characterReferenceCount: 5 })).toBeUndefined()
    expect(buildScene3DUnreferencedFiguresWarning({ figureCount: 0, characterReferenceCount: 0 })).toBeUndefined()
    expect(buildScene3DUnreferencedFiguresWarning({ figureCount: undefined, characterReferenceCount: 0 })).toBeUndefined()
  })

  it("states the rule in user terms", () => {
    expect(SCENE3D_FIGURE_REFERENCE_RULE).toContain("its own character reference")
    expect(SCENE3D_FIGURE_REFERENCE_RULE).toContain("two reference slots free")
  })
})
