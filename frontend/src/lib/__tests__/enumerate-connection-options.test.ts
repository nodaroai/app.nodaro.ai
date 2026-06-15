import { describe, it, expect } from "vitest"
import {
  enumerateConnectionOptionsCore,
  chooseSmartConnection,
  staticInputHandles,
  staticOutputHandles,
  handleIdsFromBounds,
  type ConnectionOption,
  type ConnectionOptions,
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

  // Point 1: media/reference inputs rank above prompt above negative.
  it("orders source inputs: element/reference before prompt", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "person", // its output is accepted by GI elements AND prompt
      newType: "generate-image",
      focusedSourceHandles: ["out"],
      focusedTargetHandles: ["in"],
      missingRefNames: [],
    })
    const src = handles.filter((h) => h.direction === "source").map((h) => h.nHandle)
    expect(src).toContain("elements")
    expect(src).toContain("prompt")
    expect(src.indexOf("elements")).toBeLessThan(src.indexOf("prompt"))
  })

  it("orders prompt before negative within a direction (pure-text node leads with prompt)", () => {
    const { handles } = enumerateConnectionOptionsCore({
      focusedType: "generate-image",
      newType: "text-prompt",
      focusedSourceHandles: GI_OUTPUTS,
      focusedTargetHandles: GI_INPUTS,
      missingRefNames: [],
    })
    const tgt = handles.filter((h) => h.direction === "target").map((h) => h.fHandle)
    expect(tgt.indexOf("prompt")).toBeLessThan(tgt.indexOf("negative"))
  })
})

describe("chooseSmartConnection", () => {
  const opt = (
    o: Pick<ConnectionOption, "direction" | "fHandle" | "nHandle"> & Partial<ConnectionOption>,
  ): ConnectionOption => ({ kind: "handle", tier: "direct", label: o.nHandle, color: undefined, ...o })

  const base = { focusedType: "x", defaultName: "New" }
  const none = new Set<string>()

  it("downstream picks the new node's best input (source[0]), keeps default name", () => {
    const options: ConnectionOptions = {
      handles: [
        opt({ direction: "source", fHandle: "image", nHandle: "elements" }),
        opt({ direction: "source", fHandle: "image", nHandle: "prompt" }),
      ],
      variables: [],
    }
    expect(chooseSmartConnection({ ...base, direction: "downstream", options, connectedTargetHandles: none }))
      .toEqual({ option: options.handles[0], name: "New" })
  })

  it("downstream with no consume option → add unconnected", () => {
    const options: ConnectionOptions = { handles: [opt({ direction: "target", fHandle: "prompt", nHandle: "out" })], variables: [] }
    expect(chooseSmartConnection({ ...base, direction: "downstream", options, connectedTargetHandles: none }))
      .toEqual({ option: null, name: "New" })
  })

  it("upstream prefers a missing variable, named after the ref", () => {
    const v = opt({ direction: "target", fHandle: "prompt", nHandle: "out", kind: "variable", variableName: "Hero", label: "Hero" })
    const options: ConnectionOptions = { handles: [opt({ direction: "target", fHandle: "prompt", nHandle: "out" })], variables: [v] }
    expect(chooseSmartConnection({ ...base, direction: "upstream", options, connectedTargetHandles: none }))
      .toEqual({ option: v, name: "Hero" })
  })

  it("upstream fills the first FREE input and names it (prompt → negative → unconnected)", () => {
    const options: ConnectionOptions = {
      handles: [
        opt({ direction: "target", fHandle: "prompt", nHandle: "out" }),
        opt({ direction: "target", fHandle: "negative", nHandle: "out" }),
      ],
      variables: [],
    }
    expect(chooseSmartConnection({ ...base, direction: "upstream", options, connectedTargetHandles: none }))
      .toEqual({ option: options.handles[0], name: "Prompt" })
    expect(chooseSmartConnection({ ...base, direction: "upstream", options, connectedTargetHandles: new Set(["prompt"]) }))
      .toEqual({ option: options.handles[1], name: "Negative" })
    expect(chooseSmartConnection({ ...base, direction: "upstream", options, connectedTargetHandles: new Set(["prompt", "negative"]) }))
      .toEqual({ option: null, name: "New" })
  })

  it("null direction falls back to downstream, then upstream", () => {
    const consume: ConnectionOptions = { handles: [opt({ direction: "source", fHandle: "image", nHandle: "in" })], variables: [] }
    expect(chooseSmartConnection({ ...base, direction: null, options: consume, connectedTargetHandles: none }).option)
      .toBe(consume.handles[0])
    const feed: ConnectionOptions = { handles: [opt({ direction: "target", fHandle: "prompt", nHandle: "out" })], variables: [] }
    expect(chooseSmartConnection({ ...base, direction: null, options: feed, connectedTargetHandles: none }))
      .toEqual({ option: feed.handles[0], name: "Prompt" })
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
