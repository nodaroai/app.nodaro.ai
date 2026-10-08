import { describe, it, expect } from "vitest"
// Through the package index: the registry is the surface both engines and the
// editor read "is this a render, and how does it behave?" from (SV18).
import {
  RENDER_NODE_TYPES,
  RENDER_NODE_TYPE_IDS,
  OWNER_ONLY_LISTING_RENDER_TYPES,
  PREVIEW_RENDER_NODE_TYPES,
  applyEdlCreditId,
  speakerViewCreditId,
  isRenderNodeType,
  renderNodeOf,
  rendersLatestBatch,
  rendersTranscriptJson,
} from "../index.js"

describe("RENDER_NODE_TYPES — one render-node registry (SV18)", () => {
  it("holds Apply EDL and Speaker View", () => {
    expect(Object.keys(RENDER_NODE_TYPES)).toEqual(["apply-edl", "speaker-view"])
    expect(RENDER_NODE_TYPE_IDS).toEqual(["apply-edl", "speaker-view"])
  })

  it("describes Speaker View: video only, mapped through the EDL it emits, a json that is an EDL (C3.2)", () => {
    const d = renderNodeOf("speaker-view")!
    expect(d.clockMapFrom).toBe("output-json")
    expect(d.ownerOnlyListing).toBe(true)
    expect(d.latestBatch).toBe(true)
    expect(d.jsonKind).toBe("edl")
    expect(d.mediumOf({ output: "audio" })).toBe("video")
    expect(d.mediumOf({})).toBe("video")
    expect(rendersTranscriptJson("speaker-view")).toBe(false)
  })

  it("prices a Preview on its own row and everything else on the final's", () => {
    const d = renderNodeOf("speaker-view")!
    expect(d.creditId("proxy")).toBe("speaker-view:proxy")
    for (const q of ["final", undefined, null, "", "high", 3]) expect(d.creditId(q)).toBe("speaker-view")
    expect(speakerViewCreditId("proxy")).toBe("speaker-view:proxy")
  })

  it("describes Apply EDL exactly as its hard-coded sites behaved", () => {
    const d = renderNodeOf("apply-edl")!
    expect(d).toBeDefined()
    expect(d.clockMapFrom).toBe("input")
    expect(d.ownerOnlyListing).toBe(true)
    expect(d.latestBatch).toBe(true)
    expect(d.jsonKind).toBe("transcript")
  })

  it("prices through the existing credit-id function, for any quality and output", () => {
    const d = renderNodeOf("apply-edl")!
    for (const quality of ["proxy", "final", undefined, null, "", "high", 3]) {
      for (const output of ["video", "audio", undefined]) {
        expect(d.creditId(quality, output)).toBe(applyEdlCreditId(quality))
      }
    }
  })

  it("reads the medium the order asks for: its `output`, video when absent", () => {
    const d = renderNodeOf("apply-edl")!
    expect(d.mediumOf({ output: "audio" })).toBe("audio")
    expect(d.mediumOf({ output: "video" })).toBe("video")
    expect(d.mediumOf({})).toBe("video")
    expect(d.mediumOf({ output: "AUDIO" })).toBe("video")
  })

  it("answers membership by own key only (no prototype keys, no non-strings)", () => {
    expect(isRenderNodeType("apply-edl")).toBe(true)
    for (const t of ["camera-switch", "edit-plan", "apply-edl:proxy", "", "constructor", "__proto__", "toString"]) {
      expect(isRenderNodeType(t)).toBe(false)
      expect(renderNodeOf(t)).toBeUndefined()
    }
    for (const t of [undefined, null, 1, {}]) expect(isRenderNodeType(t)).toBe(false)
  })

  it("derives every per-behaviour set from the descriptors", () => {
    const ids = Object.keys(RENDER_NODE_TYPES)
    expect([...PREVIEW_RENDER_NODE_TYPES].sort()).toEqual([...ids].sort())
    expect([...OWNER_ONLY_LISTING_RENDER_TYPES].sort()).toEqual(ids.filter((t) => RENDER_NODE_TYPES[t]!.ownerOnlyListing).sort())
    for (const t of ids) {
      expect(rendersLatestBatch(t)).toBe(RENDER_NODE_TYPES[t]!.latestBatch)
      expect(rendersTranscriptJson(t)).toBe(RENDER_NODE_TYPES[t]!.jsonKind === "transcript")
    }
    expect(rendersLatestBatch("camera-switch")).toBe(false)
    expect(rendersTranscriptJson("transcribe")).toBe(false)
  })

  it("is frozen: no consumer can register a render at run time", () => {
    expect(Object.isFrozen(RENDER_NODE_TYPES)).toBe(true)
    for (const d of Object.values(RENDER_NODE_TYPES)) expect(Object.isFrozen(d)).toBe(true)
  })
})
