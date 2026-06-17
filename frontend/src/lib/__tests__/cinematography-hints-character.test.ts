import { describe, it, expect } from "vitest"
import { collectCinematographyHints } from "../cinematography-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Character-borne element injection: a held-prop (or any text/picker) wired into
// a Character that FEEDS a Generate Image/Video node must surface in that node's
// prompt hints — `collectCinematographyHints` is the single source the preview,
// the run executor, and the backend all share, so folding it here makes the prop
// appear in the downstream Final Prompt.
const gi = "gi"
const n = (nodes: unknown[]) => nodes as unknown as WorkflowNode[]
const e = (edges: unknown[]) => edges as unknown as WorkflowEdge[]

describe("collectCinematographyHints — character-borne elements", () => {
  it("folds a held-prop wired to a character that feeds the consumer", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: {} },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ])
    const edges = e([
      { source: "hp", target: "char", targetHandle: "assets" }, // prop → character
      { source: "char", target: "gi", targetHandle: "references" }, // character → consumer
    ])
    const hints = collectCinematographyHints(gi, nodes, edges)
    expect(hints.some((h) => /smartphone/i.test(h))).toBe(true)
  })

  it("also reads the character's legacy Prompt ('in') handle", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: {} },
      { id: "t", type: "text-prompt", data: { text: "wearing a red scarf" } },
    ])
    const edges = e([
      { source: "t", target: "char", targetHandle: "in" },
      { source: "char", target: "gi", targetHandle: "references" },
    ])
    const hints = collectCinematographyHints(gi, nodes, edges)
    expect(hints.some((h) => /red scarf/i.test(h))).toBe(true)
  })

  it("returns no character hint when the character has nothing wired", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: {} },
    ])
    const edges = e([{ source: "char", target: "gi", targetHandle: "references" }])
    expect(collectCinematographyHints(gi, nodes, edges)).toEqual([])
  })

  it("does not double-count a character wired via multiple handles", () => {
    const nodes = n([
      { id: "gi", type: "generate-image", data: {} },
      { id: "char", type: "character", data: {} },
      { id: "hp", type: "held-prop", data: { heldProp: "smartphone" } },
    ])
    const edges = e([
      { source: "hp", target: "char", targetHandle: "assets" },
      { source: "char", target: "gi", targetHandle: "references" },
      { source: "char", target: "gi", targetHandle: "image" },
    ])
    const hints = collectCinematographyHints(gi, nodes, edges)
    expect(hints.filter((h) => /smartphone/i.test(h))).toHaveLength(1)
  })
})
