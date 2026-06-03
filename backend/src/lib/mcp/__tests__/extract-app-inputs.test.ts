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

  it("falls back to legacy inputOrder when inputItems is missing", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          // Legacy shape — string[] of node-ids
          inputOrder: ["n1", "n2"],
        },
      },
      snapshotNodes: [
        { id: "n1", type: "upload-image", data: { label: "Photo" } },
        { id: "n2", type: "text-prompt", data: { label: "Style" } },
      ],
    })
    expect(schema.fields).toHaveLength(2)
    expect(schema.fields[0]!.type).toBe("image")
    expect(schema.fields[1]!.type).toBe("text")
  })

  it("auto-derives inputs from source nodes when no presentation settings exist (Zebrify-style)", () => {
    // Apps with no presentationSettings should still surface their
    // source-type nodes (upload-* / text-prompt) as implicit inputs.
    const schema = extractAppInputSchema({
      snapshotSettings: null,
      snapshotNodes: [
        { id: "n1", type: "upload-image", data: { label: "Subject" } },
        // Non-source nodes are ignored — only source-type nodes become inputs.
        { id: "n2", type: "generate-image", data: { label: "AI step" } },
        { id: "n3", type: "text-prompt", data: { label: "Style" } },
      ],
    })
    expect(schema.fields).toHaveLength(2)
    expect(schema.fields[0]!.type).toBe("image")
    expect(schema.fields[1]!.type).toBe("text")
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

  // Phase 2 #4 — locations are exposed as app inputs whose value is a
  // `selectedVariant` slug in the form `"<bucket>/<variant>"`.
  it("surfaces a location node with fieldKey=selectedVariant (Phase 2 #4)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [{ type: "node", nodeId: "loc1" }],
        },
      },
      snapshotNodes: [
        {
          id: "loc1",
          type: "location",
          data: {
            label: "Old Library",
            timeOfDay: [{ name: "night", url: "https://r2/night.png" }],
            weather: [{ name: "rain", url: "https://r2/rain.png" }],
          },
        },
      ],
    })
    expect(schema.fields).toHaveLength(1)
    const field = schema.fields[0]!
    expect(field.type).toBe("text")
    expect(field.label).toBe("Old Library")
    expect(schema.keyMap[field.key]).toEqual({
      nodeId: "loc1",
      fieldKey: "selectedVariant",
    })
  })

  it("auto-derives location nodes as inputs when no presentationSettings (Phase 2 #4)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: null,
      snapshotNodes: [
        { id: "loc1", type: "location", data: { label: "Park" } },
        { id: "txt1", type: "text-prompt", data: { label: "Prompt" } },
      ],
    })
    // Both nodes should surface — location now joins the NODE_TYPE_INFO
    // table, so the auto-derive fallback includes it.
    expect(schema.fields).toHaveLength(2)
    expect(schema.fields.some((f) => f.label === "Park")).toBe(true)
  })

  // ── code-review #2 ───────────────────────────────────────────────────────
  // (1) Raw, un-migrated `loop` snapshot nodes (apps published before the
  // loop→list rename, on editions where the DB sweep hasn't run) must be
  // normalized to `list` BEFORE deriving inputs — otherwise NODE_TYPE_INFO has
  // no `loop` entry and the input is silently dropped.
  it("normalizes a raw `loop` node to a list input (curated)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: { inputItems: [{ type: "node", nodeId: "lp1" }] },
      },
      snapshotNodes: [
        {
          id: "lp1",
          type: "loop",
          data: {
            label: "Prompts",
            columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
            rows: [["a"]],
          },
        },
      ],
    })
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0]!.type).toBe("list")
    // Single-column → writes to `items` (FIX #1 coerces the array to rows).
    expect(schema.keyMap[schema.fields[0]!.key]).toEqual({
      nodeId: "lp1",
      fieldKey: "items",
    })
  })

  it("auto-derives a raw `loop` node as an input (no presentationSettings)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: null,
      snapshotNodes: [
        {
          id: "lp1",
          type: "loop",
          data: {
            label: "Prompts",
            columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
            rows: [["a"]],
          },
        },
      ],
    })
    // Without loop→list normalization the auto-derive filter
    // (NODE_TYPE_INFO[n.type]) drops the raw `loop` node entirely.
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0]!.label).toBe("Prompts")
  })

  // (2) A single-column list writes to `items` (the shape ListInputCard sends);
  // a MULTI-column list must write to `rows` (string[][] — the shape
  // LoopInputCard sends + the backend list extractor reads). Mapping a
  // multi-column list to `items` silently corrupts the grid (the orchestrator
  // would coerce the array into single-cell rows, destroying columns 2+).
  it("single-column list maps to fieldKey=items", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: { inputItems: [{ type: "node", nodeId: "l1" }] },
      },
      snapshotNodes: [
        {
          id: "l1",
          type: "list",
          data: {
            label: "Items",
            columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
            rows: [["a"]],
          },
        },
      ],
    })
    expect(schema.keyMap[schema.fields[0]!.key]).toEqual({
      nodeId: "l1",
      fieldKey: "items",
    })
  })

  it("multi-column list maps to fieldKey=rows (NOT items — avoids grid corruption)", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: { inputItems: [{ type: "node", nodeId: "t1" }] },
      },
      snapshotNodes: [
        {
          id: "t1",
          type: "list",
          data: {
            label: "Table",
            columns: [
              { id: "c1", handleId: "col_c1", type: "text" },
              { id: "c2", handleId: "col_c2", type: "text" },
            ],
            rows: [["a", "b"]],
          },
        },
      ],
    })
    expect(schema.keyMap[schema.fields[0]!.key]).toEqual({
      nodeId: "t1",
      fieldKey: "rows",
    })
    expect(schema.fields[0]!.type).toBe("list")
    // The 2D shape requirement is documented for the caller.
    expect(schema.fields[0]!.description).toMatch(/rows/i)
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
