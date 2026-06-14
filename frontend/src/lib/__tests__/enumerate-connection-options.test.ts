import { describe, it, expect } from "vitest"
import {
  enumerateConnectionOptionsCore,
  staticInputHandles,
  staticOutputHandles,
  handleIdsFromBounds,
} from "../enumerate-connection-options"

const GI_INPUTS = ["prompt", "negative", "references", "assets", "elements", "look"]
const GI_OUTPUTS = ["image"]

describe("enumerateConnectionOptionsCore", () => {
  it("Text(new) → focused Generate Image: offers Prompt + Negative (N→F)", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "text-prompt",
      focusedSourceHandles: GI_OUTPUTS,
      focusedTargetHandles: GI_INPUTS,
      missingRefNames: [],
    })
    const tgt = handles.filter((h) => h.direction === "target").map((h) => h.fHandle)
    expect(tgt).toContain("prompt")
    expect(tgt).toContain("negative")
  })

  it("focused Text → new Generate Image: offers GI prompt/negative on the new node (F→N)", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "text-prompt",
      newType: "generate-image",
      focusedSourceHandles: ["prompt"],
      focusedTargetHandles: ["in"],
      missingRefNames: [],
    })
    expect(handles.some((h) => h.direction === "source" && (h.nHandle === "prompt" || h.nHandle === "negative"))).toBe(true)
  })

  it("variable rows: a text producer feeding the focused node, named after each ref", () => {
    const { variables } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "text-prompt",
      focusedSourceHandles: GI_OUTPUTS,
      focusedTargetHandles: GI_INPUTS,
      missingRefNames: ["Hero", "Mood"],
    })
    expect(variables.map((v) => v.variableName)).toEqual(["Hero", "Mood"])
    expect(variables.every((v) => v.direction === "target")).toBe(true)
  })

  it("no variable rows when the new node is not a text producer", () => {
    const { variables } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "upload-image",
      focusedSourceHandles: GI_OUTPUTS,
      focusedTargetHandles: GI_INPUTS,
      missingRefNames: ["Hero"],
    })
    expect(variables).toEqual([])
  })

  it("dedups identical (direction, fHandle, nHandle)", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "text-prompt",
      focusedSourceHandles: [],
      focusedTargetHandles: ["prompt", "prompt"],
      missingRefNames: [],
    })
    expect(handles.filter((h) => h.fHandle === "prompt" && h.direction === "target").length).toBe(1)
  })

  it("person(focused) + generate-image(new): offers GI elements + prompt, never image→person.in", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "person",
      newType: "generate-image",
      focusedSourceHandles: ["out"],
      focusedTargetHandles: ["in"],
      missingRefNames: [],
    })
    const nHandles = handles.filter((h) => h.direction === "source").map((h) => h.nHandle)
    expect(nHandles).toContain("elements")
    expect(nHandles).toContain("prompt")
    // person's untyped "in" is permissive → must NOT be offered as a target.
    expect(handles.some((h) => h.direction === "target")).toBe(false)
  })

  it("every option carries a concrete nHandle", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "text-prompt",
      focusedSourceHandles: GI_OUTPUTS,
      focusedTargetHandles: GI_INPUTS,
      missingRefNames: [],
    })
    expect(handles.length).toBeGreaterThan(0)
    expect(handles.every((h) => typeof h.nHandle === "string" && h.nHandle.length > 0)).toBe(true)
  })
})

describe("static handle fallbacks", () => {
  it("union covers typed inputs missing from def (object → in + type)", () => {
    const inputs = staticInputHandles("object")
    expect(inputs).toContain("in")
    expect(inputs).toContain("type")
  })

  it("union covers multi-output nodes (generate-mask → image + mask)", () => {
    const outputs = staticOutputHandles("generate-mask")
    expect(outputs).toContain("image")
    expect(outputs).toContain("mask")
  })
})

describe("handleIdsFromBounds", () => {
  it("uses live handle ids when bounds are present", () => {
    const r = handleIdsFromBounds({ source: [{ id: "image" }], target: [{ id: "prompt" }, { id: "negative" }] }, "generate-image")
    expect(r.sourceHandles).toEqual(["image"])
    expect(r.targetHandles).toEqual(["prompt", "negative"])
  })

  it("falls back to the static union when bounds are undefined", () => {
    const r = handleIdsFromBounds(undefined, "object")
    expect(r.targetHandles).toContain("type") // typed handle missing from def, present via union
  })

  it("filters null handle ids and falls back per-side when a side is null", () => {
    const r = handleIdsFromBounds({ source: [{ id: null }, { id: "image" }], target: null }, "generate-image")
    expect(r.sourceHandles).toEqual(["image"])
    expect(r.targetHandles).toContain("prompt") // target null → static fallback
  })
})
