import { describe, it, expect } from "vitest"
import {
  extractAppInputSchema,
  extractComponentInputSchema,
  flatInputsToOverrides,
  mergeInputOverrides,
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

  it("maps parameter-picker nodes to their real override field, not the inert 'value'", () => {
    // Regression: pickers were absent from NODE_TYPE_INFO and fell back to
    // fieldKey "value" — but getParameterValue reads data.tone / data.shotSize /
    // data.actionFx, so the curated input was SILENTLY DROPPED on every app /
    // MCP / SDK run. Now derived from the shared INPUT_FIELD_MAP source of truth.
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "node", nodeId: "t1" },
            { type: "node", nodeId: "f1" },
            { type: "node", nodeId: "a1" },
          ],
        },
      },
      snapshotNodes: [
        { id: "t1", type: "tone", data: { label: "Tone" } },
        { id: "f1", type: "framing", data: { label: "Framing" } },
        { id: "a1", type: "action-fx", data: { label: "Action FX" } },
      ],
    })
    const fields = schema.fields
    expect(schema.keyMap[fields[0]!.key]).toEqual({ nodeId: "t1", fieldKey: "tone" })
    expect(schema.keyMap[fields[1]!.key]).toEqual({ nodeId: "f1", fieldKey: "shotSize" })
    expect(schema.keyMap[fields[2]!.key]).toEqual({ nodeId: "a1", fieldKey: "actionFx" })
    for (const k of Object.keys(schema.keyMap)) {
      expect(schema.keyMap[k]!.fieldKey).not.toBe("value")
    }
    // End-to-end: this is exactly what /v1/app/:slug/run now does for flat inputs.
    expect(flatInputsToOverrides({ [fields[0]!.key]: "energetic" }, schema.keyMap)).toEqual({
      t1: { tone: "energetic" },
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

  // Phase 3 — lottie slot fields. A `slot:<sid>` field item on a lottie
  // motion-graphics node resolves through the shared deriveLottieSlotFields
  // single source of truth: color → "color", number → "number", text → "text".
  it("derives lottie slot field items into typed schema entries", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "field", id: "i1", nodeId: "mg1", field: "slot:primaryColor" },
            { type: "field", id: "i2", nodeId: "mg1", field: "slot:nameText" },
            { type: "field", id: "i3", nodeId: "mg1", field: "slot:barWidth" },
          ],
        },
      },
      snapshotNodes: [
        {
          id: "mg1",
          type: "motion-graphics",
          data: {
            label: "Title Card",
            motionPlan: {
              planType: "lottie-graphic",
              slots: {
                primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } },
                nameText: { p: "Jane Doe" },
                barWidth: { p: { a: 0, k: 360 } },
              },
            },
          },
        },
      ],
    })

    expect(schema.fields).toHaveLength(3)
    const byField = Object.fromEntries(
      schema.fields.map((f) => [schema.keyMap[f.key]!.fieldKey, f]),
    )

    expect(byField["slot:primaryColor"]).toMatchObject({
      label: "Title Card: Primary Color",
      type: "color",
      description: "Hex color, e.g. #ff0073",
    })
    expect(byField["slot:nameText"]).toMatchObject({
      label: "Title Card: Name Text",
      type: "text",
    })
    expect(byField["slot:barWidth"]!.type).toBe("number")
    expect(byField["slot:barWidth"]!.description).toMatch(/720/)

    // Override field keys are preserved verbatim (slot:<sid>) so the runtime
    // can compose the full-plan replacement.
    expect(schema.keyMap[schema.fields[0]!.key]).toEqual({
      nodeId: "mg1",
      fieldKey: "slot:primaryColor",
    })
  })

  it("falls back to generic text for a slot: field on a non-lottie node", () => {
    // Guard: the slot:* prefix alone must NOT trigger lottie derivation —
    // only a motion-graphics node carrying a lottie-graphic plan does.
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [{ type: "field", id: "i1", nodeId: "n1", field: "slot:foo" }],
        },
      },
      snapshotNodes: [{ id: "n1", type: "scene", data: { label: "Scene" } }],
    })
    expect(schema.fields[0]!.type).toBe("text")
    expect(schema.fields[0]!.label).toBe("Scene: slot:foo")
  })

  it("gives a lottie number slot its slider bounds as min / max / step", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: { inputItems: [{ type: "field", id: "i1", nodeId: "mg1", field: "slot:opacity" }] },
      },
      snapshotNodes: [
        {
          id: "mg1",
          type: "motion-graphics",
          data: { label: "Card", motionPlan: { planType: "lottie-graphic", slots: { opacity: { p: { a: 0, k: 0.5 } } } } },
        },
      ],
    })
    expect(schema.fields[0]).toMatchObject({ type: "number", min: 0, max: 1, step: 0.01 })
  })
})

// An exposed slider used to reach get_app_inputs as `type: "text"`. Its control
// type and range come from the node's NODE_DEFINITIONS descriptor, through the
// table gen-skills renders (generated/exposable-sliders.ts).
describe("extractAppInputSchema — exposed sliders", () => {
  const ttsApp = (items: unknown[]) =>
    extractAppInputSchema({
      snapshotSettings: { presentationSettings: { inputItems: items as never } },
      snapshotNodes: [
        { id: "tts", type: "text-to-speech", data: { label: "Voice" } },
        { id: "llm", type: "llm-chat", data: { label: "Writer" } },
        { id: "odd", type: "not-a-node-type", data: { label: "Odd" } },
      ],
    })

  it("types an exposed slider as a number carrying the descriptor's min, max and step", () => {
    const schema = ttsApp([{ type: "field", id: "f1", nodeId: "tts", field: "stability" }])
    expect(schema.fields[0]).toEqual({
      key: "voice_stability",
      label: "Voice: stability",
      type: "number",
      required: false,
      min: 0,
      max: 1,
      step: 0.05,
    })
    expect(schema.keyMap.voice_stability).toMatchObject({ nodeId: "tts", fieldKey: "stability" })
  })

  it("resolves a slider published under a legacy key, and keeps the stored key on the wire", () => {
    // Apps published before the Similarity re-key store `similarity`; the
    // descriptor now declares `similarityBoost`. The merge canonicalizes later.
    const schema = ttsApp([{ type: "field", id: "f1", nodeId: "tts", field: "similarity" }])
    expect(schema.fields[0]).toMatchObject({ type: "number", min: 0, max: 1, step: 0.05 })
    expect(schema.keyMap[schema.fields[0]!.key]).toMatchObject({ nodeId: "tts", fieldKey: "similarity" })
  })

  it("reads each node's own sliders (llm-chat temperature and maxTokens)", () => {
    const schema = ttsApp([
      { type: "field", id: "f1", nodeId: "llm", field: "temperature" },
      { type: "field", id: "f2", nodeId: "llm", field: "maxTokens" },
    ])
    expect(schema.fields.map((f) => [f.type, f.min, f.max, f.step])).toEqual([
      ["number", 0, 2, 0.1],
      ["number", 256, 16384, 256],
    ])
  })

  it("keeps a non-slider field, an unknown node type and an allowedValues card as before", () => {
    const schema = ttsApp([
      { type: "field", id: "f1", nodeId: "llm", field: "systemPrompt" },
      { type: "field", id: "f2", nodeId: "odd", field: "stability" },
      { type: "field", id: "f3", nodeId: "tts", field: "stability", allowedValues: [0.25, 0.5] },
      { type: "field", id: "f4", nodeId: "missing", field: "stability" },
    ])
    expect(schema.fields.map((f) => f.type)).toEqual(["text", "text", "select", "text"])
    for (const f of schema.fields) expect(f).not.toHaveProperty("min")
    expect(schema.fields[2]!.options).toEqual([0.25, 0.5])
  })

  it("a numeric string sent for the slider reaches the node as a number", () => {
    const schema = ttsApp([
      { type: "field", id: "f1", nodeId: "tts", field: "stability" },
      { type: "field", id: "f2", nodeId: "llm", field: "systemPrompt" },
    ])
    expect(flatInputsToOverrides({ voice_stability: " 0.4 ", writer_systemprompt: "42" }, schema.keyMap)).toEqual({
      tts: { stability: 0.4 },
      llm: { systemPrompt: "42" },
    })
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

  describe("a field the schema typed `number`", () => {
    const keyMap = {
      level: { nodeId: "n1", fieldKey: "level", type: "number" as const },
      note: { nodeId: "n1", fieldKey: "note" },
    }

    it("takes a number as it is", () => {
      expect(flatInputsToOverrides({ level: 0.7 }, keyMap)).toEqual({ n1: { level: 0.7 } })
    })

    it("turns a decimal numeric string (spaces allowed) into that number", () => {
      for (const [sent, got] of [["0.4", 0.4], [" 12 ", 12], ["-1", -1], [".5", 0.5], ["1e2", 100]] as const) {
        expect(flatInputsToOverrides({ level: sent }, keyMap)).toEqual({ n1: { level: got } })
      }
    })

    it("passes an unusable value through unchanged, for the node's own funnel to judge (as before)", () => {
      for (const sent of ["", "loud", "0x10", "Infinity", true, { v: 1 }]) {
        expect(flatInputsToOverrides({ level: sent }, keyMap)).toEqual({ n1: { level: sent } })
      }
    })

    it("leaves a numeric string on a field not typed number as a string", () => {
      expect(flatInputsToOverrides({ note: "3" }, keyMap)).toEqual({ n1: { note: "3" } })
    })
  })
})

describe("mergeInputOverrides", () => {
  it("returns undefined when both sides are absent or empty", () => {
    expect(mergeInputOverrides(undefined, undefined)).toBeUndefined()
    expect(mergeInputOverrides({}, {})).toBeUndefined()
    expect(mergeInputOverrides({}, undefined)).toBeUndefined()
  })

  it("passes the base through when there is no overlay", () => {
    expect(mergeInputOverrides({ n1: { text: "a cat" } }, undefined)).toEqual({
      n1: { text: "a cat" },
    })
  })

  it("passes the overlay through when there is no base", () => {
    expect(mergeInputOverrides(undefined, { n1: { promptPrefix: "cinematic" } })).toEqual({
      n1: { promptPrefix: "cinematic" },
    })
  })

  it("merges the same node per field, overlay winning on conflicts", () => {
    expect(
      mergeInputOverrides(
        { n1: { text: "a cat", seed: 1 } },
        { n1: { seed: 42, promptPrefix: "cinematic" } },
      ),
    ).toEqual({ n1: { text: "a cat", seed: 42, promptPrefix: "cinematic" } })
  })

  it("keeps nodes that appear on only one side", () => {
    expect(
      mergeInputOverrides({ n1: { text: "a cat" } }, { n2: { promptSuffix: "35mm" } }),
    ).toEqual({ n1: { text: "a cat" }, n2: { promptSuffix: "35mm" } })
  })

  it("never mutates either input", () => {
    const base = { n1: { text: "a cat" } }
    const overlay = { n1: { promptPrefix: "cinematic" } }
    const merged = mergeInputOverrides(base, overlay)
    expect(base).toEqual({ n1: { text: "a cat" } })
    expect(overlay).toEqual({ n1: { promptPrefix: "cinematic" } })
    expect(merged!.n1).not.toBe(base.n1)
    expect(merged!.n1).not.toBe(overlay.n1)
  })
})

describe("extractAppInputSchema — a field published under its older key", () => {
  it("keeps the flat key and the stored field key, so MCP / SDK callers of a published app are unaffected", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: {
        presentationSettings: {
          inputItems: [
            { type: "field", id: "f1", nodeId: "tts1", field: "similarity" },
            { type: "field", id: "f2", nodeId: "tts1", field: "similarityBoost" },
          ],
        },
      },
      snapshotNodes: [{ id: "tts1", type: "text-to-speech", data: { label: "Narration" } }],
    })
    expect(schema.fields.map((f) => f.key)).toEqual(["narration_similarity", "narration_similarityboost"])
    // `type: "number"`: both spellings are the Similarity slider (numeric strings are coerced).
    expect(schema.keyMap["narration_similarity"]).toEqual({ nodeId: "tts1", fieldKey: "similarity", type: "number" })
    expect(schema.keyMap["narration_similarityboost"]).toEqual({ nodeId: "tts1", fieldKey: "similarityBoost", type: "number" })
  })
})
