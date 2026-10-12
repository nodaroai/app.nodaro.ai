/**
 * The add-node popup opened from a UGC pip (drag a wire onto empty canvas):
 * it offers what a drop would accept and wires the node on the pip that drop
 * would use. A UGC wire reads one output of one node, which the source node
 * type alone cannot tell, so both the offer and the wiring ask the drop
 * validator itself.
 */
import { describe, expect, it } from "vitest"
import { NODE_OPTIONS } from "../node-options"
import { addNodeConnection, getCompatibleNodes, resolveTargetHandle, type CompatibleNodes } from "../node-compatibility"

const direct = (r: CompatibleNodes) => r.direct.map((o) => o.type)
const compatible = (r: CompatibleNodes) => r.compatible.map((o) => o.type)

describe("from a UGC input pip, the popup offers the node that feeds it", () => {
  it("UGC Cards' Script input offers UGC Clips, wired from its sized script (plan-out) — never its clips, never UGC Script", () => {
    const r = getCompatibleNodes("plan", "target", NODE_OPTIONS, "ugc-cards")
    expect(direct(r)).toEqual(["ugc-clips"])
    expect(compatible(r)).toEqual([])
    expect(resolveTargetHandle("ugc-clips", "plan", "target", "ugc-cards")).toBe("plan-out")
  })

  it("UGC Cards' Transcript input offers UGC Clips, wired from its transcript", () => {
    const r = getCompatibleNodes("transcript", "target", NODE_OPTIONS, "ugc-cards")
    expect(direct(r)).toEqual(["ugc-clips"])
    expect(resolveTargetHandle("ugc-clips", "transcript", "target", "ugc-cards")).toBe("transcript")
  })

  it("UGC Clips' Script input offers UGC Script, wired from its plan — never its category", () => {
    const r = getCompatibleNodes("plan", "target", NODE_OPTIONS, "ugc-clips")
    expect(direct(r)).toEqual(["ugc-script"])
    expect(resolveTargetHandle("ugc-script", "plan", "target", "ugc-clips")).toBe("plan")
  })

  it("UGC Creator's look input offers exactly the four creator pickers", () => {
    const r = getCompatibleNodes("pickers", "target", NODE_OPTIONS, "ugc-creator")
    expect([...r.directTypes].sort()).toEqual(["lighting", "person", "setting", "styling"])
    expect(resolveTargetHandle("person", "pickers", "target", "ugc-creator")).toBe("out")
  })

  it("UGC Creator's category input offers UGC Script, wired from its category", () => {
    expect(direct(getCompatibleNodes("category", "target", NODE_OPTIONS, "ugc-creator"))).toEqual(["ugc-script"])
    expect(resolveTargetHandle("ugc-script", "category", "target", "ugc-creator")).toBe("category")
  })
})

describe("from a UGC output pip, the popup offers the node made to read it", () => {
  it("UGC Clips' clips offers UGC Clip, wired on its clip input (no phantom `in`), and never UGC Cards", () => {
    const r = getCompatibleNodes("clips", "source", NODE_OPTIONS, "ugc-clips")
    expect(direct(r)).toEqual(["ugc-clip"])
    expect([...direct(r), ...compatible(r)]).not.toContain("ugc-cards")
    expect(resolveTargetHandle("ugc-clip", "clips", "source", "ugc-clips")).toBe("clip")
  })

  it("UGC Clips' sized script offers UGC Cards, wired on its Script input", () => {
    const r = getCompatibleNodes("plan-out", "source", NODE_OPTIONS, "ugc-clips")
    expect(direct(r)).toEqual(["ugc-cards"])
    expect(resolveTargetHandle("ugc-cards", "plan-out", "source", "ugc-clips")).toBe("plan")
  })

  it("UGC Clips' transcript offers UGC Cards, wired on its Transcript input", () => {
    expect(direct(getCompatibleNodes("transcript", "source", NODE_OPTIONS, "ugc-clips"))).toEqual(["ugc-cards"])
    expect(resolveTargetHandle("ugc-cards", "transcript", "source", "ugc-clips")).toBe("transcript")
  })

  it("UGC Clip's video offers UGC Cards on its clip notes directly, and the video nodes (Combine Videos) beside it", () => {
    const r = getCompatibleNodes("video-out", "source", NODE_OPTIONS, "ugc-clip")
    expect(direct(r)).toEqual(["ugc-cards"])
    expect(compatible(r)).toContain("combine-videos")
    expect(resolveTargetHandle("ugc-cards", "video-out", "source", "ugc-clip")).toBe("notes")
    expect(resolveTargetHandle("combine-videos", "video-out", "source", "ugc-clip")).toBe("in")
  })

  it("UGC Cards' plans offer the inputs made for them: Video Overlay's layer plan, Add Captions' caption plan", () => {
    expect(direct(getCompatibleNodes("layerPlan", "source", NODE_OPTIONS, "ugc-cards"))).toEqual(["video-overlay"])
    expect(resolveTargetHandle("video-overlay", "layerPlan", "source", "ugc-cards")).toBe("layerPlan")
    expect(direct(getCompatibleNodes("captionPlan", "source", NODE_OPTIONS, "ugc-cards"))).toEqual(["add-captions"])
    expect(resolveTargetHandle("add-captions", "captionPlan", "source", "ugc-cards")).toBe("captionPlan")
  })

  it("UGC Creator's creator record offers UGC Clips, wired on its Creator input", () => {
    expect(direct(getCompatibleNodes("creator", "source", NODE_OPTIONS, "ugc-creator"))).toEqual(["ugc-clips"])
    expect(resolveTargetHandle("ugc-clips", "creator", "source", "ugc-creator")).toBe("creator")
  })

  it("UGC Creator's image is any image producer's pip: image nodes, wired on an image input", () => {
    const r = getCompatibleNodes("image", "source", NODE_OPTIONS, "ugc-creator")
    expect(direct(r)).toContain("modify-image")
    expect(resolveTargetHandle("modify-image", "image", "source", "ugc-creator")).toBe("image")
  })
})

describe("from a UGC text pip, the popup offers the UGC input made for it and the text inputs a drop accepts", () => {
  const JSON_CONSUMERS = ["apply-edl", "camera-switch", "speaker-view", "extract-field", "add-captions"]
  const offered = (r: CompatibleNodes) => [...direct(r), ...compatible(r)]

  it("UGC Script's category offers UGC Creator directly and the text consumers beside it, never a JSON input", () => {
    const r = getCompatibleNodes("category", "source", NODE_OPTIONS, "ugc-script")
    expect(direct(r)).toEqual(["ugc-creator"])
    expect(compatible(r)).toEqual(expect.arrayContaining(["llm-chat", "text-to-speech", "combine-text", "generate-image"]))
    for (const type of [...JSON_CONSUMERS, "ugc-cards", "ugc-clips"]) expect(offered(r), type).not.toContain(type)
    expect(resolveTargetHandle("ugc-creator", "category", "source", "ugc-script")).toBe("category")
    expect(resolveTargetHandle("llm-chat", "category", "source", "ugc-script")).toBe("prompt")
  })

  it("UGC Clips' transcript offers UGC Cards directly and the text consumers beside it, never a JSON input", () => {
    const r = getCompatibleNodes("transcript", "source", NODE_OPTIONS, "ugc-clips")
    expect(direct(r)).toEqual(["ugc-cards"])
    expect(compatible(r)).toEqual(expect.arrayContaining(["llm-chat", "text-to-speech"]))
    for (const type of [...JSON_CONSUMERS, "ugc-creator"]) expect(offered(r), type).not.toContain(type)
  })

  it("UGC Cards' Notes offers the text consumers a drop accepts, and is never wired into Apply EDL's edit list", () => {
    const r = getCompatibleNodes("report", "source", NODE_OPTIONS, "ugc-cards")
    expect(direct(r)).toEqual(expect.arrayContaining(["llm-chat", "text-to-speech"]))
    for (const type of [...JSON_CONSUMERS, "ugc-creator"]) expect(offered(r), type).not.toContain(type)
    expect(addNodeConnection({ nodeId: "cards", handleId: "report", direction: "source" }, { id: "new", type: "llm-chat" }, "ugc-cards"))
      .toEqual({ source: "cards", sourceHandle: "report", target: "new", targetHandle: "prompt" })
    expect(addNodeConnection({ nodeId: "cards", handleId: "report", direction: "source" }, { id: "new", type: "apply-edl" }, "ugc-cards")).toBeNull()
  })
})

describe("the edge the popup draws (addNodeConnection)", () => {
  it("from UGC Clips' clips, a new UGC Clip is wired on its clip input", () => {
    expect(addNodeConnection({ nodeId: "clips", handleId: "clips", direction: "source" }, { id: "new", type: "ugc-clip" }, "ugc-clips"))
      .toEqual({ source: "clips", sourceHandle: "clips", target: "new", targetHandle: "clip" })
  })

  it("from UGC Cards' Script input, a new UGC Clips is wired from its sized script", () => {
    expect(addNodeConnection({ nodeId: "cards", handleId: "plan", direction: "target" }, { id: "new", type: "ugc-clips" }, "ugc-cards"))
      .toEqual({ source: "new", sourceHandle: "plan-out", target: "cards", targetHandle: "plan" })
  })

  it("draws nothing a drop would refuse: a new node no pip of which takes the wire is added unconnected", () => {
    expect(addNodeConnection({ nodeId: "clips", handleId: "clips", direction: "source" }, { id: "new", type: "ugc-script" }, "ugc-clips")).toBeNull()
  })

  it("keeps the List's quick-add, and draws as before when the other node's type is unknown", () => {
    expect(addNodeConnection({ nodeId: "img", handleId: "image", direction: "source" }, { id: "new", type: "list" }, "upload-image"))
      .toEqual({ source: "img", sourceHandle: "image", target: "new", targetHandle: "col_add" })
    expect(addNodeConnection({ nodeId: "x", handleId: "video", direction: "source" }, { id: "new", type: "generate-video" }, undefined))
      .toEqual({ source: "x", sourceHandle: "video", target: "new", targetHandle: "videoReferences" })
  })
})

describe("the popup's wiring elsewhere is as it was", () => {
  it("a List still quick-adds on its column handle, a video still lands on Generate Video's video references", () => {
    expect(resolveTargetHandle("list", "image", "source", "upload-image")).toBe("col_add")
    expect(resolveTargetHandle("generate-video", "video", "source", "upload-video")).toBe("videoReferences")
    expect(resolveTargetHandle("generate-video", "video", "source")).toBe("videoReferences")
  })

  it("from a public plan input, UGC Cards is wired from the plan made for it", () => {
    expect(resolveTargetHandle("ugc-cards", "captionPlan", "target", "add-captions")).toBe("captionPlan")
    expect(resolveTargetHandle("ugc-cards", "layerPlan", "target", "video-overlay")).toBe("layerPlan")
  })
})
