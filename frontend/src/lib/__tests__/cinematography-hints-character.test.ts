import { describe, it, expect } from "vitest"
import { collectCinematographyHints } from "../cinematography-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Character-borne element placement contract.
//
// A held-prop / text wired into a Character that FEEDS a consumer carries its
// element downstream. Placement depends on the consumer:
//   - BULLET consumers (generate-image, video gen, …) stamp the element onto the
//     character's identity bullet via `ConnectedReference.elementInjection`, and
//     pass `excludeCharacterElements: true` so it is NOT ALSO appended to the
//     prompt tail here (the user-reported "attached at the end" double bug).
//   - NON-bullet consumers (edit-image, location, …) have no bullet, so by
//     DEFAULT the element is appended to their cinematography-hints list (tail).
const gi = "gi"
const n = (nodes: unknown[]) => nodes as unknown as WorkflowNode[]
const e = (edges: unknown[]) => edges as unknown as WorkflowEdge[]

const heldPropGraph = () => ({
  nodes: n([
    { id: "gi", type: "generate-image", data: {} },
    { id: "char", type: "character", data: { characterName: "Alice" } },
    { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
  ]),
  edges: e([
    { source: "hp", target: "char", targetHandle: "assets" }, // prop → character
    { source: "char", target: "gi", targetHandle: "references" }, // character → consumer
  ]),
})

describe("collectCinematographyHints — character element placement", () => {
  it("DEFAULT includes the character's element (non-bullet consumers, tail)", () => {
    const { nodes, edges } = heldPropGraph()
    const hints = collectCinematographyHints(gi, nodes, edges)
    expect(hints.some((h) => /smartphone/i.test(h))).toBe(true)
  })

  it("OMITS the character's element when excludeCharacterElements is set (bullet consumers)", () => {
    const { nodes, edges } = heldPropGraph()
    const hints = collectCinematographyHints(gi, nodes, edges, { excludeCharacterElements: true })
    expect(hints.some((h) => /smartphone/i.test(h))).toBe(false)
  })

  it("still folds a picker wired DIRECTLY to the consumer, regardless of the flag", () => {
    // The non-character path is untouched — a held-prop wired straight to the
    // consumer's `elements` handle still folds into the body in both modes.
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ])
    const edges = e([{ source: "hp", target: "gi", targetHandle: "elements" }])
    expect(collectCinematographyHints(gi, nodes, edges).some((h) => /smartphone/i.test(h))).toBe(true)
    expect(
      collectCinematographyHints(gi, nodes, edges, { excludeCharacterElements: true }).some((h) => /smartphone/i.test(h)),
    ).toBe(true)
  })
})
