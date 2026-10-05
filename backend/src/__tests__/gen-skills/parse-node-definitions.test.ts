import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  parseNodeDefinitions,
  parseDataInterface,
} from "../../../scripts/lib/gen-skills/parse-node-definitions.js"

const NODES_TS = resolve(__dirname, "../../../../frontend/src/types/nodes.ts")

describe("parseNodeDefinitions", () => {
  it("extracts the generate-image entry with expected shape", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    const gi = defs.find((d) => d.type === "generate-image")
    expect(gi).toBeDefined()
    expect(gi?.label).toBe("Generate Image")
    expect(gi?.category).toBe("ai")
    expect(gi?.inputs).toEqual(expect.arrayContaining(["prompt", "negative", "references", "assets", "elements", "look"]))
    expect(gi?.outputs).toContain("image")
    expect(gi?.defaultData).toMatchObject({
      label: expect.any(String),
      prompt: expect.any(String),
      provider: expect.any(String),
    })
  })

  it("extracts the list entry", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    const list = defs.find((d) => d.type === "list")
    expect(list).toBeDefined()
    expect(list?.label).toBe("List")
    expect(list?.category).toBe("input")
  })

  it("returns a non-empty array", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    expect(defs.length).toBeGreaterThanOrEqual(40)
    // A runaway-parse sanity bound (a regex that matches every object literal
    // in nodes.ts would return thousands), not a cap on the product: the node
    // catalog reached 200 with audio-sync (2026-09-25).
    expect(defs.length).toBeLessThan(400)
  })

  it("every entry has the canonical fields", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    for (const d of defs) {
      // Node type slugs are lowercase kebab; some legitimately start with a
      // digit (e.g. `3d-title`), so the first char is `[a-z0-9]`, not `[a-z]`.
      expect(d.type, `entry: ${JSON.stringify(d)}`).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(d.label).toBeDefined()
      expect(d.category).toBeDefined()
      expect(Array.isArray(d.inputs)).toBe(true)
      expect(Array.isArray(d.outputs)).toBe(true)
      expect(typeof d.defaultData).toBe("object")
    }
  })
})

describe("parseDataInterface", () => {
  it("extracts GenerateImageData fields with optionality", () => {
    const iface = parseDataInterface(NODES_TS, "GenerateImageData")
    expect(iface).toBeDefined()
    const fieldNames = iface!.fields.map((f) => f.name)
    expect(fieldNames).toContain("prompt")
    expect(fieldNames).toContain("provider")
    const promptField = iface!.fields.find((f) => f.name === "prompt")
    expect(promptField?.optional).toBe(false)
  })

  it("returns undefined for unknown interface name", () => {
    const iface = parseDataInterface(NODES_TS, "NonExistentInterfaceXYZ")
    expect(iface).toBeUndefined()
  })

  it("preserves union types as raw strings in field.type", () => {
    // CombineVideosData's `transition` was the original fixture, but PR #2595
    // broadened it to `string` to cover ~50 FFmpeg xfade ids. RenderVideoData's
    // `aspectRatio` is a small, stable enum union that demonstrates the same
    // extraction behavior.
    const iface = parseDataInterface(NODES_TS, "RenderVideoData")
    expect(iface).toBeDefined()
    const aspect = iface!.fields.find((f) => f.name === "aspectRatio")
    expect(aspect?.type).toContain("16:9")
    expect(aspect?.type).toContain("9:16")
    expect(aspect?.type).toContain("|") // proves the union was preserved verbatim
  })
})

describe("parseNodeDefinitions edge cases", () => {
  // Pinning tests for deviations from the original B.3 spec — without these,
  // a future refactor could silently re-remove these behaviors and produce
  // doc-drift that no other test would catch.

  it("peels AsExpression on string properties (e.g., 'component' uses 'utility' as const)", () => {
    // The `component` node in nodes.ts writes `category: "utility" as const`.
    // readStringExpr must peel the AsExpression wrapper or the category will
    // come back as something other than the literal string "utility".
    const defs = parseNodeDefinitions(NODES_TS)
    const comp = defs.find((d) => d.type === "component")
    expect(comp).toBeDefined()
    expect(comp?.category).toBe("utility")
  })

  it("accepts digit-prefixed types (e.g., '3d-title')", () => {
    // The canonical-field test below uses /^[a-z0-9][a-z0-9-]*$/ — this test
    // pins that the real-world '3d-title' node makes it through the parser
    // and isn't silently dropped by some upstream filter.
    const defs = parseNodeDefinitions(NODES_TS)
    const t = defs.find((d) => d.type === "3d-title")
    expect(t).toBeDefined()
    expect(t?.label).toBeDefined()
  })
})

describe("parseDataInterface edge cases", () => {
  it("handles `export type X = { ... }` alias form (TypeLiteral fallback)", () => {
    // GenerateImageData is declared via `export type GenerateImageData = { ... }`,
    // NOT `interface GenerateImageData { ... }`. The earlier
    // "extracts GenerateImageData fields" test already exercises this path —
    // this test makes the dependency on the type-alias fallback explicit so a
    // refactor that drops the alias branch from collectInterfaceMembers
    // immediately breaks this assertion.
    const iface = parseDataInterface(NODES_TS, "GenerateImageData")
    expect(iface).toBeDefined()
    expect(iface!.name).toBe("GenerateImageData")
    expect(iface!.fields.length).toBeGreaterThan(5)
  })

  it("follows `extends` clauses so mixin fields are documented (LensData)", () => {
    // LensData is `interface LensData extends PickerConsumerData,
    // PickerHintModeFields { ... }`. A heritage clause is an
    // ExpressionWithTypeArguments, not a TypeReference — handing it to the
    // type-node resolver silently yielded nothing, so every field a picker
    // inherits from a shared mixin was missing from its generated skill doc
    // (while the equivalent `type X = { … } & Mixin` alias documented them).
    // This pins that both spellings now document the same shape.
    const iface = parseDataInterface(NODES_TS, "LensData")
    expect(iface).toBeDefined()
    const names = iface!.fields.map((f) => f.name)
    // Own members come first, in declaration order.
    expect(names.slice(0, 2)).toEqual(["label", "lens"])
    // Inherited from PickerHintModeFields / PickerConsumerData.
    expect(names).toContain("hintMode")
    expect(names).toContain("applyMode")
    const hintMode = iface!.fields.find((f) => f.name === "hintMode")
    expect(hintMode?.optional).toBe(true)
    expect(hintMode?.type).toBe('"full" | "compact"')
  })

  it("documents the same hintMode field for the alias-shaped pickers (FramingData)", () => {
    // FramingData is the `type X = { … } & PickerConsumerData &
    // PickerHintModeFields` spelling — the intersection path. Interface and
    // alias pickers must not drift.
    const iface = parseDataInterface(NODES_TS, "FramingData")
    expect(iface).toBeDefined()
    expect(iface!.fields.map((f) => f.name)).toContain("hintMode")
  })

  it("returns { name, fields: [] } for union-type aliases (e.g., SceneNodeData)", () => {
    // SceneNodeData is a union of many *Data types — not a TypeLiteral.
    // collectInterfaceMembers' final `return []` branch handles this:
    // alias exists, but no readable member list. Documented contract is
    // "alias exists with empty fields", which is what the parser returns.
    const iface = parseDataInterface(NODES_TS, "SceneNodeData")
    expect(iface).toBeDefined()
    expect(iface!.name).toBe("SceneNodeData")
    expect(iface!.fields).toEqual([])
  })
})

describe("parseNodeDefinitions exposable sliders", () => {
  // The backend has no typed view of NODE_DEFINITIONS, so the slider bounds an
  // app exposes reach `get_app_inputs` only through the generated table that
  // gen-skills renders from these parsed entries (exposable-sliders.ts).
  it("reads the Text to Speech voice-setting sliders (key, min, max, step only)", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    const tts = defs.find((d) => d.type === "text-to-speech")
    expect(tts?.sliders).toEqual([
      { key: "stability", min: 0, max: 1, step: 0.05 },
      { key: "similarityBoost", min: 0, max: 1, step: 0.05 },
    ])
  })

  it("reads a negative bound (voice-design loudness)", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    const vd = defs.find((d) => d.sliders.some((s) => s.key === "loudness"))
    expect(vd?.sliders).toEqual([{ key: "loudness", min: -1, max: 1, step: 0.1 }])
  })

  it("gives every node a sliders array, empty when it exposes none", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    for (const d of defs) expect(Array.isArray(d.sliders), d.type).toBe(true)
    expect(defs.find((d) => d.type === "list")?.sliders).toEqual([])
  })

  describe("fails loudly on a shape it cannot read", () => {
    const dir = mkdtempSync(join(tmpdir(), "parse-sliders-"))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))
    const fixture = (name: string, fields: string): string => {
      const file = join(dir, `${name}.ts`)
      writeFileSync(
        file,
        `const SHARED = []\nexport const NODE_DEFINITIONS = [\n  { type: "x", label: "X", category: "ai", inputs: [], outputs: [], defaultData: {}, exposableFields: ${fields} },\n]\n`,
      )
      return file
    }

    it("a slider bound that is not a numeric literal", () => {
      const file = fixture("ident", `[{ key: "a", label: "A", type: "slider" as const, min: 0, max: MAX, step: 1 }]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/slider 'a'.*max/)
    })

    it("an exposableFields value that is not an array literal", () => {
      const file = fixture("notarray", `SHARED`)
      expect(() => parseNodeDefinitions(file)).toThrow(/exposableFields/)
    })

    it("a spread element (a slider could hide in it)", () => {
      const file = fixture("spread", `[...SHARED]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/exposableFields/)
    })

    it("a spread inside a slider entry (its bounds could hide in it)", () => {
      const file = fixture("slider-spread", `[{ key: "a", label: "A", type: "slider" as const, ...SHARED }]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/entry 'a' has a spread \(\.\.\.SHARED\)/)
    })

    it("a spread inside any entry (it could make the entry a slider)", () => {
      const file = fixture("entry-spread", `[{ key: "b", label: "B", type: "select" as const, ...SHARED }]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/entry 'b' has a spread/)
    })

    it("a slider property it cannot name (computed key)", () => {
      const file = fixture("computed", `[{ key: "c", label: "C", type: "slider" as const, ["max"]: 9 }]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/slider 'c'.*\["max"\]/)
    })

    it("reads a bound written with a quoted name", () => {
      const file = fixture("quoted", `[{ "key": "e", label: "E", "type": "slider" as const, "min": 2, 'max': 9 }]`)
      expect(parseNodeDefinitions(file)[0]?.sliders).toEqual([{ key: "e", min: 2, max: 9 }])
    })

    it("a slider property that is not a plain assignment (shorthand)", () => {
      const file = fixture("shorthand", `[{ key: "d", label: "D", type: "slider" as const, max }]`)
      expect(() => parseNodeDefinitions(file)).toThrow(/slider 'd'.*max/)
    })

    it("still ignores a non-slider entry's unreadable values (select options from a call)", () => {
      const file = fixture(
        "select",
        `[{ key: "p", label: "P", type: "select" as const, options: SHARED.map((v) => v), defaultValue: SHARED.length }, { key: "d", label: "D", type: "slider" as const, min: 1, max: 9 }]`,
      )
      expect(parseNodeDefinitions(file)[0]?.sliders).toEqual([{ key: "d", min: 1, max: 9 }])
    })
  })
})
