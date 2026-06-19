import { describe, it, expect } from "vitest"
import { collectCinematographyHints } from "@/lib/cinematography-hints"
import { buildNodeRefMap } from "@/lib/node-refs"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Variable ↔ auto-inject reconciliation:
//  1. a look/elements source REFERENCED as {label} in prompt/negative is NOT
//     also auto-injected (no double).
//  2. several same-label connections collapse into ONE {label} whose value is
//     prompt → elements → look, inner by edge order.
const n = (x: unknown[]) => x as unknown as WorkflowNode[]
const e = (x: unknown[]) => x as unknown as WorkflowEdge[]

describe("used-as-variable suppression — collectCinematographyHints", () => {
  const injected = (consumerData: Record<string, unknown>, handle: string) => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: consumerData },
      { id: "hp", type: "held-prop", data: { label: "Prop", heldProp: "smartphone" } },
    ])
    const edges = e([{ source: "hp", target: "gi", targetHandle: handle }])
    return collectCinematographyHints("gi", nodes, edges).some((h) => /smartphone/i.test(h))
  }

  it("auto-injects a look source when NOT referenced", () => {
    expect(injected({ prompt: "a plain scene" }, "look")).toBe(true)
  })
  it("skips a look source referenced as {label} (no double)", () => {
    expect(injected({ prompt: "a scene holding {Prop}" }, "look")).toBe(false)
  })
  it("skips an elements source referenced as {label} (no double)", () => {
    expect(injected({ prompt: "a scene holding {Prop}" }, "elements")).toBe(false)
  })
  it("scans the negative field too", () => {
    expect(injected({ prompt: "x", negativePrompt: "no {Prop}" }, "look")).toBe(false)
  })
})

describe("same-label combine — buildNodeRefMap", () => {
  const graph = () => ({
    nodes: n([
      { id: "c", type: "generate-image", data: { label: "C" } },
      { id: "p1", type: "held-prop", data: { label: "X", heldProp: "smartphone" } },
      { id: "p2", type: "held-prop", data: { label: "X", heldProp: "umbrella" } },
    ]),
    edges: e([
      { source: "p1", target: "c", targetHandle: "elements" },
      { source: "p2", target: "c", targetHandle: "look" },
    ]),
  })

  it("merges same-label sources into one canonical {x}, elements before look", () => {
    const { nodes, edges } = graph()
    // node labels are "X" → canonical (lowercase) map key "x"
    const x = (buildNodeRefMap("c", nodes, edges).get("x") ?? "").toLowerCase()
    expect(x).toMatch(/smartphone/)
    expect(x).toMatch(/umbrella/)
    expect(x.indexOf("smartphone")).toBeLessThan(x.indexOf("umbrella"))
  })

  it("does not suffix a combined label", () => {
    const { nodes, edges } = graph()
    const map = buildNodeRefMap("c", nodes, edges)
    expect(map.has("x")).toBe(true)
    expect(map.has("x (2)")).toBe(false)
  })
})

describe("case-insensitive variables — TEXt/TEXT collapse + suppression", () => {
  it("collapses differently-cased labels (TEXt + TEXT) into ONE canonical {text}, elements before look", () => {
    const nodes = n([
      { id: "c", type: "generate-image", data: { label: "C" } },
      { id: "p1", type: "held-prop", data: { label: "TEXt", heldProp: "smartphone" } },
      { id: "p2", type: "held-prop", data: { label: "TEXT", heldProp: "umbrella" } },
    ])
    const edges = e([
      { source: "p1", target: "c", targetHandle: "elements" },
      { source: "p2", target: "c", targetHandle: "look" },
    ])
    const map = buildNodeRefMap("c", nodes, edges)
    expect(map.has("text")).toBe(true) // canonical key, regardless of label casing
    const v = (map.get("text") ?? "").toLowerCase()
    expect(v).toMatch(/smartphone/)
    expect(v).toMatch(/umbrella/)
    expect(v.indexOf("smartphone")).toBeLessThan(v.indexOf("umbrella"))
  })

  it("suppresses a look source case-insensitively ({foo} ↔ a node labeled Foo)", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: { prompt: "scene with {foo}" } },
      { id: "hp", type: "held-prop", data: { label: "Foo", heldProp: "smartphone" } },
    ])
    const edges = e([{ source: "hp", target: "gi", targetHandle: "look" }])
    expect(collectCinematographyHints("gi", nodes, edges).some((h) => /smartphone/i.test(h))).toBe(false)
  })
})
