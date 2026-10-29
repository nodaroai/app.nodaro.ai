/**
 * Nodaro Motion's depth-mode vocabularies, shared by the backend, the admin
 * editor and the Cast Swap engine's contract (which keeps its own copies).
 * Pinned, so a change is a decision taken with the engine.
 */
import { describe, expect, it } from "vitest"
import { CAST_SWAP_FACE_MASK_TARGETS, CAST_SWAP_STYLES } from "@nodaro/shared/models"
import {
  CAST_SWAP_FACE_MASK_MARK_LABELS,
  CAST_SWAP_FULL_DEPTH_ORIGINAL_MAX_SEC,
  CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC,
  CAST_SWAP_FULL_DEPTH_SCENES,
  CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT,
  CAST_SWAP_PROMPT_PART_IDS,
  CAST_SWAP_PROMPT_STYLES,
  defaultPromptStyleFor,
  CAST_SWAP_PROMPT_PART_PLACEHOLDERS,
  CAST_SWAP_SOURCE_MODES,
  isMainFaceMaskMark,
  isErasedFaceMaskMark,
  faceMaskMarkSlot,
} from "@nodaro/render-rules"

describe("Nodaro Motion enums", () => {
  it("styles, targets, source modes and mark labels", () => {
    expect(CAST_SWAP_STYLES).toEqual(["precise", "motion"])
    expect(CAST_SWAP_FACE_MASK_TARGETS).toEqual(["face", "head", "body"])
    expect(CAST_SWAP_SOURCE_MODES).toEqual(["faces", "full-depth", "keep-people"])
    expect(CAST_SWAP_FACE_MASK_MARK_LABELS).toEqual(["erased", "main"])
  })

  it("prompt styles and full depth's scene sources, with their defaults", () => {
    expect(CAST_SWAP_PROMPT_STYLES).toEqual(["precise", "flexible"])
    expect(CAST_SWAP_FULL_DEPTH_SCENES).toEqual(["description", "original", "none"])
    expect(CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT).toBe("description")
    // The engine's limit (30 s of reference video, less the original's 2 s and its 0.1 s margin),
    // and what a trend publishes with: 0.4 s below it.
    expect(CAST_SWAP_FULL_DEPTH_ORIGINAL_MAX_SEC).toBe(27.9)
    expect(CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC).toBe(27.5)
    expect(defaultPromptStyleFor("faces")).toBe("precise")
    expect(defaultPromptStyleFor("keep-people")).toBe("precise")
    expect(defaultPromptStyleFor("full-depth")).toBe("flexible")
  })

  it("a main mark is neither an erased mark nor a slot mark", () => {
    expect(isMainFaceMaskMark({ label: "main" })).toBe(true)
    expect(isErasedFaceMaskMark({ label: "main" })).toBe(false)
    expect(faceMaskMarkSlot({ label: "main" })).toBeNull()
    expect(isMainFaceMaskMark({ label: "erased" })).toBe(false)
    expect(isMainFaceMaskMark({ label: { slot: "guest" } })).toBe(false)
  })

  it("the 15 prompt parts, in the engine's assembly order (Flex's art style right after the opener)", () => {
    expect(CAST_SWAP_PROMPT_PART_IDS).toEqual([
      "opener", "artStyle", "original", "scene", "quality", "keep", "audio", "face", "depthGuard",
      "person", "pet", "product", "location", "avoid", "postHeader",
    ])
  })

  it("each part's placeholders, every part named and `{image}` in every role part", () => {
    expect(CAST_SWAP_PROMPT_PART_PLACEHOLDERS).toEqual({
      opener: ["{video}"],
      artStyle: ["{style}"],
      original: ["{original}"],
      scene: ["{scene}"],
      quality: [],
      keep: ["{video}"],
      audio: [],
      face: [],
      depthGuard: ["{video}"],
      person: ["{name}", "{image}", "{face}", "{outfit}", "{body}", "{hair}"],
      pet: ["{name}", "{image}", "{body}", "{coat}"],
      product: ["{name}", "{image}", "{shape}", "{finish}"],
      location: ["{name}", "{image}"],
      avoid: [],
      postHeader: [],
    })
    expect(Object.keys(CAST_SWAP_PROMPT_PART_PLACEHOLDERS)).toEqual([...CAST_SWAP_PROMPT_PART_IDS])
    for (const role of ["person", "pet", "product", "location"] as const) {
      expect(CAST_SWAP_PROMPT_PART_PLACEHOLDERS[role]).toContain("{image}")
    }
  })
})
