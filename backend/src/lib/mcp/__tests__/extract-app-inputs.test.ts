import { describe, it, expect } from "vitest"
import {
  extractAppInputSchema,
  extractComponentInputSchema,
  flatInputsToOverrides,
} from "../extract-app-inputs.js"

describe("extractAppInputSchema", () => {
  it("returns empty schema when no presentation settings", () => {
    expect(extractAppInputSchema({ snapshotSettings: null, snapshotNodes: null })).toEqual({
      fields: [],
      keyMap: {},
    })
  })

  it("infers type + write field from node type", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "node", nodeId: "n1" },
            { type: "node", nodeId: "n2" },
            { type: "node", nodeId: "n3" },
          ],
        },
      },
      snapshotNodes: [
        { id: "n1", type: "upload-image", data: { label: "Photo" } },
        { id: "n2", type: "upload-video", data: { label: "Clip" } },
        { id: "n3", type: "text-prompt", data: { label: "Story" } },
      ],
    })
    expect(schema.fields.map((f) => f.type)).toEqual(["image", "video", "text"])
    expect(schema.keyMap[schema.fields[0]!.key]).toEqual({
      nodeId: "n1",
      fieldKey: "url",
    })
    expect(schema.keyMap[schema.fields[2]!.key]).toEqual({
      nodeId: "n3",
      fieldKey: "text",
    })
  })

  it("flattens group items so the LLM sees a flat field list", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            {
              type: "group",
              id: "g1",
              title: "Section",
              items: [
                { type: "node", nodeId: "n1" },
                { type: "node", nodeId: "n2" },
              ],
            },
          ],
        },
      },
      snapshotNodes: [
        { id: "n1", type: "upload-image", data: { label: "A" } },
        { id: "n2", type: "upload-image", data: { label: "B" } },
      ],
    })
    expect(schema.fields).toHaveLength(2)
  })

  it("dedupes colliding keys with numeric suffix", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "node", nodeId: "n1" },
            { type: "node", nodeId: "n2" },
          ],
        },
      },
      snapshotNodes: [
        { id: "n1", type: "upload-image", data: { label: "Photo" } },
        { id: "n2", type: "upload-image", data: { label: "Photo" } },
      ],
    })
    expect(schema.fields[0]!.key).toBe("photo")
    expect(schema.fields[1]!.key).toBe("photo_2")
  })

  it("typed field with allowedValues → select with options", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            {
              type: "field",
              id: "f1",
              nodeId: "n1",
              field: "tone",
              allowedValues: ["calm", "energetic"],
            },
          ],
        },
      },
      snapshotNodes: [{ id: "n1", type: "scene", data: { label: "Scene" } }],
    })
    expect(schema.fields[0]!.type).toBe("select")
    expect(schema.fields[0]!.options).toEqual(["calm", "energetic"])
  })

  it("ignores output and richtext items (only node + field surface as inputs)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "richtext", id: "r1", content: "Hello" },
            { type: "output", id: "o1", nodeId: "n9", outputKey: "image" },
            { type: "node", nodeId: "n1" },
          ],
        },
      },
      snapshotNodes: [{ id: "n1", type: "upload-image", data: { label: "Photo" } }],
    })
    expect(schema.fields).toHaveLength(1)
  })
})

describe("extractComponentInputSchema", () => {
  it("maps component_metadata.inputs through unchanged + dedupes", () => {
    const schema = extractComponentInputSchema({
      inputs: [
        { id: "h1", name: "image", fieldKey: "url", type: "image", required: true },
        { id: "h2", name: "image", fieldKey: "url", type: "image", required: false },
      ],
      outputs: [],
      exposedSettings: [],
    })
    expect(schema.fields).toHaveLength(2)
    expect(schema.fields[0]!.required).toBe(true)
    expect(schema.fields[0]!.key).toBe("image")
    expect(schema.fields[1]!.key).toBe("image_2")
    expect(schema.keyMap[schema.fields[1]!.key]).toEqual({ nodeId: "h2", fieldKey: "url" })
  })
})

describe("flatInputsToOverrides", () => {
  it("groups multiple keys hitting the same node under one entry", () => {
    const overrides = flatInputsToOverrides(
      { color: "red", size: 5 },
      {
        color: { nodeId: "n1", fieldKey: "color" },
        size: { nodeId: "n1", fieldKey: "size" },
      },
    )
    expect(overrides).toEqual({ n1: { color: "red", size: 5 } })
  })

  it("returns undefined when nothing maps", () => {
    expect(flatInputsToOverrides({ unknown: "x" }, {})).toBeUndefined()
  })

  it("drops undefined / null values silently", () => {
    expect(
      flatInputsToOverrides(
        { a: undefined, b: null, c: "kept" },
        {
          a: { nodeId: "n1", fieldKey: "a" },
          b: { nodeId: "n1", fieldKey: "b" },
          c: { nodeId: "n1", fieldKey: "c" },
        },
      ),
    ).toEqual({ n1: { c: "kept" } })
  })
})
