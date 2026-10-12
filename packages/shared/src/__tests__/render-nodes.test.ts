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
  SPEAKER_VIEW_CREDIT_IDS,
  SPEAKER_VIEW_PRICE_TIERS,
  isRenderNodeType,
  renderNodeOf,
  rendersLatestBatch,
  rendersTranscriptJson,
  RENDER_JSON_HANDLE,
  renderTranscriptOutputOf,
  isRenderDataHandle,
  renderSavedJsonOutputs,
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

  it("prices a Preview on its own row and everything else on the final's, per price tier (C4)", () => {
    const d = renderNodeOf("speaker-view")!
    expect(d.creditId("proxy", undefined, "standard")).toBe("speaker-view:proxy")
    expect(d.creditId("proxy", undefined, "complex")).toBe("speaker-view:complex:proxy")
    for (const q of ["final", undefined, null, "", "high", 3]) {
      expect(d.creditId(q, undefined, "standard")).toBe("speaker-view")
      expect(d.creditId(q, undefined, "complex")).toBe("speaker-view:complex")
    }
    expect(speakerViewCreditId("proxy", "standard")).toBe("speaker-view:proxy")
  })

  it("an unknown price tier names the dearer row: an order that cannot say leans high (C4)", () => {
    const d = renderNodeOf("speaker-view")!
    for (const tier of [undefined, null, "", "STANDARD", "wide", 2]) {
      expect(d.creditId("proxy", undefined, tier)).toBe("speaker-view:complex:proxy")
      expect(d.creditId("final", undefined, tier)).toBe("speaker-view:complex")
      expect(speakerViewCreditId("final", tier)).toBe("speaker-view:complex")
    }
    expect(speakerViewCreditId("proxy")).toBe("speaker-view:complex:proxy")
  })

  it("lists every id each render can name, and names only listed ids", () => {
    expect([...SPEAKER_VIEW_CREDIT_IDS].sort()).toEqual(["speaker-view", "speaker-view:complex", "speaker-view:complex:proxy", "speaker-view:proxy"])
    expect([...SPEAKER_VIEW_PRICE_TIERS]).toEqual(["standard", "complex"])
    for (const type of RENDER_NODE_TYPE_IDS) {
      const d = renderNodeOf(type)!
      const named = new Set<string>()
      for (const quality of ["proxy", "final", undefined]) {
        for (const output of ["video", "audio", undefined]) {
          for (const priceTier of [...SPEAKER_VIEW_PRICE_TIERS, undefined]) named.add(d.creditId(quality, output, priceTier))
        }
      }
      expect([...named].sort(), type).toEqual([...d.creditIds].sort())
    }
    expect(renderNodeOf("apply-edl")!.creditIds).toEqual(["apply-edl", "apply-edl:proxy"])
    expect(renderNodeOf("speaker-view")!.creditIds).toEqual(SPEAKER_VIEW_CREDIT_IDS)
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
        expect(d.creditId(quality, output, "complex")).toBe(applyEdlCreditId(quality))
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

  describe("the transcript output: where a render's wired transcript, remapped through its cut, comes out (decided 2026-10-08)", () => {
    it("Apply EDL's rides its `json` pip and `generatedJson`; Speaker View's its own `transcript` pip and `generatedTranscript`", () => {
      expect(RENDER_JSON_HANDLE).toBe("json")
      expect(renderTranscriptOutputOf("apply-edl")).toEqual({ handle: "json", dataField: "generatedJson" })
      expect(renderTranscriptOutputOf("speaker-view")).toEqual({ handle: "transcript", dataField: "generatedTranscript" })
      for (const t of ["camera-switch", "transcribe", "constructor", undefined, null]) expect(renderTranscriptOutputOf(t)).toBeUndefined()
    })

    it("a render's json is its transcript exactly when its transcript output IS the json pip — the two descriptions never disagree", () => {
      for (const [t, d] of Object.entries(RENDER_NODE_TYPES)) {
        const onJson = d.transcriptOutput.handle === RENDER_JSON_HANDLE
        expect(d.jsonKind === "transcript", t).toBe(onJson)
        expect(d.transcriptOutput.dataField === "generatedJson", t).toBe(onJson)
      }
    })

    it("tells a render's data pips (json, transcript) from its media pip", () => {
      expect(isRenderDataHandle("apply-edl", "json")).toBe(true)
      expect(isRenderDataHandle("apply-edl", "media")).toBe(false)
      expect(isRenderDataHandle("apply-edl", "transcript")).toBe(false)
      expect(isRenderDataHandle("apply-edl", undefined)).toBe(false)
      expect(isRenderDataHandle("speaker-view", "json")).toBe(true)
      expect(isRenderDataHandle("speaker-view", "transcript")).toBe(true)
      expect(isRenderDataHandle("speaker-view", "video")).toBe(false)
      expect(isRenderDataHandle("speaker-view", null)).toBe(false)
      expect(isRenderDataHandle("camera-switch", "transcript")).toBe(false)
    })

    it("lists the json outputs a render lands on its node, json first, each once", () => {
      expect(renderSavedJsonOutputs("apply-edl")).toEqual([{ outputKey: "json", dataField: "generatedJson" }])
      expect(renderSavedJsonOutputs("speaker-view")).toEqual([
        { outputKey: "json", dataField: "generatedJson" },
        { outputKey: "transcript", dataField: "generatedTranscript" },
      ])
      expect(renderSavedJsonOutputs("camera-switch")).toEqual([])
    })
  })

  it("is frozen: no consumer can register a render at run time", () => {
    expect(Object.isFrozen(RENDER_NODE_TYPES)).toBe(true)
    for (const d of Object.values(RENDER_NODE_TYPES)) {
      expect(Object.isFrozen(d)).toBe(true)
      expect(Object.isFrozen(d.transcriptOutput)).toBe(true)
    }
  })
})
