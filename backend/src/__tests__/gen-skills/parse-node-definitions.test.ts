import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
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
    expect(typeof gi?.creditCost).toBe("number")
    expect(gi?.inputs).toContain("in")
    expect(gi?.outputs).toContain("image")
    expect(gi?.defaultData).toMatchObject({
      label: expect.any(String),
      prompt: expect.any(String),
      provider: expect.any(String),
    })
  })

  it("extracts the loop (Table) entry", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    const loop = defs.find((d) => d.type === "loop")
    expect(loop).toBeDefined()
    expect(loop?.label).toBe("Table")
    expect(loop?.category).toBe("input")
  })

  it("returns a non-empty array", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    expect(defs.length).toBeGreaterThanOrEqual(40)
    expect(defs.length).toBeLessThan(200)
  })

  it("every entry has the canonical fields", () => {
    const defs = parseNodeDefinitions(NODES_TS)
    for (const d of defs) {
      // Node type slugs are lowercase kebab; some legitimately start with a
      // digit (e.g. `3d-title`), so the first char is `[a-z0-9]`, not `[a-z]`.
      expect(d.type, `entry: ${JSON.stringify(d)}`).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(d.label).toBeDefined()
      expect(d.category).toBeDefined()
      expect(typeof d.creditCost).toBe("number")
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
    const iface = parseDataInterface(NODES_TS, "CombineVideosData")
    expect(iface).toBeDefined()
    const transition = iface!.fields.find((f) => f.name === "transition")
    expect(transition?.type).toContain("cut")
    expect(transition?.type).toContain("fade")
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
