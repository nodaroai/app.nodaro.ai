import { describe, it, expect } from "vitest"
import { collectCinematographyHints } from "@/lib/cinematography-hints"
import { stampElementInjections } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import type { ConnectedReference } from "@nodaro/shared"

// "Prompt Injection" config section: per-consumer-node toggles that disable the
// AUTOMATIC injection of Look and Elements. The gates are HANDLE-SCOPED:
//   - injectLook === false     → drops the Look family (look / cinematography / style)
//   - injectElements === false → drops the `elements` handle + character-borne elements
// Default is ON (undefined/true). Runtime gates live in collectCinematographyHints
// (per-edge by targetHandle) and stampElementInjections (character-borne);
// mirrored in payload-builder.ts.
const n = (x: unknown[]) => x as unknown as WorkflowNode[]
const e = (x: unknown[]) => x as unknown as WorkflowEdge[]

describe("Look / Elements toggles are HANDLE-scoped — collectCinematographyHints", () => {
  // A held-prop produces a hint via getNodePromptHint regardless of which handle
  // it lands on, so wiring the SAME source to `look` vs `elements` isolates the
  // per-handle gate.
  const hasProp = (consumerData: Record<string, unknown>, handle: string) => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: consumerData },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ])
    const edges = e([{ source: "hp", target: "gi", targetHandle: handle }])
    return collectCinematographyHints("gi", nodes, edges).some((h) => /smartphone/i.test(h))
  }

  it("injects both handles by default (no flags)", () => {
    expect(hasProp({}, "look")).toBe(true)
    expect(hasProp({}, "elements")).toBe(true)
  })

  it("injectLook=false drops the `look` handle but KEEPS `elements`", () => {
    expect(hasProp({ injectLook: false }, "look")).toBe(false)
    expect(hasProp({ injectLook: false }, "elements")).toBe(true)
  })

  it("injectElements=false drops the `elements` handle but KEEPS `look`", () => {
    expect(hasProp({ injectElements: false }, "elements")).toBe(false)
    expect(hasProp({ injectElements: false }, "look")).toBe(true)
  })

  it("`cinematography` and `style` handles follow Inject Look (not Elements)", () => {
    expect(hasProp({ injectLook: false }, "cinematography")).toBe(false)
    expect(hasProp({ injectLook: false }, "style")).toBe(false)
    expect(hasProp({ injectElements: false }, "cinematography")).toBe(true)
    expect(hasProp({ injectElements: false }, "style")).toBe(true)
  })
})

describe("Inject Elements toggle — character-borne elements (stampElementInjections)", () => {
  // held-prop → Character → consumer: the prop rides the character's identity
  // bullet via ConnectedReference.elementInjection. These travel on the
  // `references` handle (not `elements`), but are the same FAMILY → Inject Elements.
  const graph = (consumerData: Record<string, unknown>) => ({
    nodes: n([
      { id: "gi", type: "generate-image", data: consumerData },
      { id: "char", type: "character", data: { characterName: "Alice" } },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ]),
    edges: e([
      { source: "hp", target: "char", targetHandle: "assets" },
      { source: "char", target: "gi", targetHandle: "references" },
    ]),
  })
  const refs = (): ConnectedReference[] => [
    { id: "char", defaultName: "Alice", source: "wired-character", url: "u1", characterSlug: "alice" },
  ]

  it("stamps by default (injectElements undefined)", () => {
    const { nodes, edges } = graph({})
    expect(stampElementInjections(refs(), "gi", nodes, edges)[0].elementInjection).toMatch(/smartphone/i)
  })

  it("still stamps when only injectLook is off (Look toggle must not touch Elements)", () => {
    const { nodes, edges } = graph({ injectLook: false })
    expect(stampElementInjections(refs(), "gi", nodes, edges)[0].elementInjection).toMatch(/smartphone/i)
  })

  it("returns refs un-stamped when injectElements === false", () => {
    const { nodes, edges } = graph({ injectElements: false })
    expect(stampElementInjections(refs(), "gi", nodes, edges)[0].elementInjection).toBeUndefined()
  })
})
