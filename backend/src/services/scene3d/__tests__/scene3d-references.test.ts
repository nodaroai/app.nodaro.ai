/**
 * Reference semantics — the rules that decide what a reference DOES, kept in
 * one helper so the route and the orchestrator cannot enforce them differently.
 *
 * The two failures these exist for are both silent ones: a reference the
 * caller paid to attach that never lands on the produced revision, and a
 * reference the server accepts, stores and then ignores.
 */
import { describe, it, expect } from "vitest"
import { LLM_MODEL_IDS, SCENE3D_LIMITS, type Scene3DReference } from "@nodaro/shared"
import {
  SCENE3D_MAX_IMAGE_REFERENCES,
  mergeScene3DReferences,
  scene3DImageModalityError,
  scene3DPresentedReferences,
  scene3DReferenceListError,
  withScene3DReferences,
  withoutScene3DReferences,
} from "../scene3d-references.js"

const image = (id: string, over: Partial<Scene3DReference> = {}): Scene3DReference => ({
  id,
  url: `https://r2.test/${id}.png`,
  kind: "image",
  role: "appearance",
  ...over,
})
const video = (id: string, over: Partial<Scene3DReference> = {}): Scene3DReference => ({
  id,
  url: `https://r2.test/${id}.mp4`,
  kind: "video",
  role: "motion",
  ...over,
})

describe("scene3DReferenceListError", () => {
  it("accepts a full list of images — the contract's ceiling, not a smaller one", () => {
    const references = Array.from({ length: SCENE3D_LIMITS.maxReferences }, (_, i) => image(`r${i}`))
    expect(scene3DReferenceListError(references)).toBeUndefined()
  })

  it("rejects duplicate ids", () => {
    expect(scene3DReferenceListError([image("r1"), image("r1")])).toContain("duplicate reference id")
  })

  it("rejects a second video — the cancel path reads a SINGULAR child id", () => {
    expect(scene3DReferenceListError([video("a"), video("b")])).toContain("At most 1 video reference")
  })

  it("rejects a time window on an image", () => {
    expect(scene3DReferenceListError([image("r1", { startSeconds: 1 })])).toContain("applies to video only")
  })

  it("rejects a backwards window", () => {
    expect(scene3DReferenceListError([video("v", { startSeconds: 5, endSeconds: 2 })])).toContain(
      "ends at or before it starts",
    )
  })

  it("rejects a nontrivial video window rather than accepting and ignoring it", () => {
    // v1 analyses the whole clip. A field that is accepted, stored on the plan
    // and then ignored is worse than one that is refused, because nothing
    // downstream can tell the two apart.
    const message = scene3DReferenceListError([video("v", { startSeconds: 2, endSeconds: 5 })])
    expect(message).toContain("whole clip")
    expect(message).toContain("trim")
  })

  it("accepts the two spellings of the WHOLE clip", () => {
    expect(scene3DReferenceListError([video("v")])).toBeUndefined()
    expect(scene3DReferenceListError([video("v", { startSeconds: 0 })])).toBeUndefined()
  })
})

describe("mergeScene3DReferences", () => {
  it("keeps prior references available on a later edit", () => {
    const merged = mergeScene3DReferences([image("keep")], [image("added")])
    expect(merged.map((r) => r.id)).toEqual(["keep", "added"])
  })

  it("replaces by id — the same id repoints the existing reference in place", () => {
    const merged = mergeScene3DReferences(
      [image("hero", { objectId: "hero" }), image("set")],
      [image("hero", { role: "layout", objectId: "car" })],
    )
    expect(merged.map((r) => r.id)).toEqual(["hero", "set"])
    expect(merged[0]).toMatchObject({ role: "layout", objectId: "car" })
  })

  it("is a no-op on both sides when there is nothing to merge", () => {
    expect(mergeScene3DReferences(undefined, undefined)).toEqual([])
    expect(mergeScene3DReferences([image("a")], undefined).map((r) => r.id)).toEqual(["a"])
    expect(mergeScene3DReferences(undefined, [image("a")]).map((r) => r.id)).toEqual(["a"])
  })
})

describe("with/withoutScene3DReferences", () => {
  const plan = { references: [image("a")] } as never

  it("omits the key rather than storing an empty list", () => {
    expect("references" in withScene3DReferences(plan, [])).toBe(false)
  })

  it("strips references without mutating the input", () => {
    const stripped = withoutScene3DReferences(plan)
    expect("references" in stripped).toBe(false)
    expect((plan as unknown as { references: unknown[] }).references).toHaveLength(1)
  })
})

describe("scene3DPresentedReferences", () => {
  it("presents every image the contract allows — nothing is dropped in silence", () => {
    const references = Array.from({ length: SCENE3D_LIMITS.maxReferences }, (_, i) => image(`r${i}`))
    expect(scene3DPresentedReferences({ references }).images).toHaveLength(SCENE3D_LIMITS.maxReferences)
    expect(SCENE3D_MAX_IMAGE_REFERENCES).toBe(SCENE3D_LIMITS.maxReferences)
  })

  it("presents a video only when its analysis is in hand", () => {
    const references = [image("i"), video("v")]
    expect(scene3DPresentedReferences({ references }).video).toBeUndefined()
    expect(scene3DPresentedReferences({ references, analysis: {} as never }).video?.id).toBe("v")
  })

  it("presents the video the analysis actually describes, not merely the first", () => {
    // An inherited video from an earlier revision is not re-analysed, so
    // `analyzedReferenceId` is what ties the JSON to the clip it came from.
    const references = [video("inherited"), video("fresh")]
    const presented = scene3DPresentedReferences({
      references,
      analysis: {} as never,
      analyzedReferenceId: "fresh",
    })
    expect(presented.video?.id).toBe("fresh")
  })
})

describe("scene3DImageModalityError", () => {
  it("is silent when there is nothing to read", () => {
    expect(scene3DImageModalityError("claude-sonnet-4.6", [])).toBeUndefined()
    expect(scene3DImageModalityError("claude-sonnet-4.6", [video("v")])).toBeUndefined()
  })

  it("passes every model the routes accept — the gate is dormant BY INVARIANT", () => {
    // Nothing in the catalog is text-only today, so this guard never fires.
    // That is the point: the day a text-only model is added, this test fails
    // and names the gate that keeps it from authoring a scene its image
    // references had no part in (the provider would drop those blocks and the
    // job would bill an LLM tier for a brief-only answer).
    for (const id of LLM_MODEL_IDS) {
      expect(scene3DImageModalityError(id, [image("r1")])).toBeUndefined()
    }
  })
})
