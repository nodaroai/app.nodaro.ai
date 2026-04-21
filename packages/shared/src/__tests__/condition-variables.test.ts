import { describe, it, expect } from "vitest"
import { buildConditionVariables } from "../condition-variables.js"

type N = { id: string; type?: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const node = (id: string, type: string, label: string, extra: Record<string, unknown> = {}): N => ({
  id,
  type,
  data: { label, ...extra },
})

const edge = (source: string, target: string, targetHandle = "in", sourceHandle: string | null = "prompt"): E => ({
  source,
  target,
  sourceHandle,
  targetHandle,
})

// A minimal extractor that reads the node's `data.text`.
const extract = (n: N): string | undefined =>
  typeof n.data.text === "string" ? (n.data.text as string) : undefined

describe("buildConditionVariables", () => {
  it("includes only nodes connected to the target's `variables` handle", () => {
    const tpVar = node("v", "text-prompt", "DateRef", { text: "2026-04-21" })
    const tpData = node("d", "text-prompt", "DataSource", { text: "listitem" })
    const filter = node("f", "filter-list", "Filter")
    const edges: E[] = [
      edge("v", "f", "variables", "prompt"),
      edge("d", "f", "in", "prompt"),
    ]
    const map = buildConditionVariables("f", edges, [tpVar, tpData, filter], extract)
    expect(map.size).toBe(1)
    expect(map.get("DateRef")).toBe("2026-04-21")
    expect(map.has("DataSource")).toBe(false)
  })

  it("returns an empty map when no variables-handle edges exist", () => {
    const tp = node("d", "text-prompt", "Data", { text: "x" })
    const filter = node("f", "filter-list", "Filter")
    const edges: E[] = [edge("d", "f", "in", "prompt")]
    const map = buildConditionVariables("f", edges, [tp, filter], extract)
    expect(map.size).toBe(0)
  })

  it("keys by the source node's label", () => {
    const n1 = node("a", "text-prompt", "My Label", { text: "v1" })
    const filter = node("f", "filter-list", "Filter")
    const map = buildConditionVariables("f", [edge("a", "f", "variables", "prompt")], [n1, filter], extract)
    expect(map.get("My Label")).toBe("v1")
  })

  it("falls back to node type when label is missing", () => {
    const n1: N = { id: "a", type: "text-prompt", data: { text: "v1" } }
    const filter = node("f", "filter-list", "Filter")
    const map = buildConditionVariables("f", [edge("a", "f", "variables", "prompt")], [n1, filter], extract)
    expect(map.get("text-prompt")).toBe("v1")
  })

  it("suffixes duplicates with (2), (3), ...", () => {
    const a = node("a", "text-prompt", "Same", { text: "first" })
    const b = node("b", "text-prompt", "Same", { text: "second" })
    const c = node("c", "text-prompt", "Same", { text: "third" })
    const filter = node("f", "filter-list", "Filter")
    const edges: E[] = [
      edge("a", "f", "variables", "prompt"),
      edge("b", "f", "variables", "prompt"),
      edge("c", "f", "variables", "prompt"),
    ]
    const map = buildConditionVariables("f", edges, [a, b, c, filter], extract)
    expect(map.get("Same")).toBe("first")
    expect(map.get("Same (2)")).toBe("second")
    expect(map.get("Same (3)")).toBe("third")
  })

  it("skips sources with no extractable output", () => {
    const withText = node("a", "text-prompt", "Has", { text: "present" })
    const noText = node("b", "text-prompt", "Missing") // no data.text
    const filter = node("f", "filter-list", "Filter")
    const edges: E[] = [
      edge("a", "f", "variables", "prompt"),
      edge("b", "f", "variables", "prompt"),
    ]
    const map = buildConditionVariables("f", edges, [withText, noText, filter], extract)
    expect(map.get("Has")).toBe("present")
    expect(map.has("Missing")).toBe(false)
  })

  it("ignores edges targeting other nodes", () => {
    const tp = node("a", "text-prompt", "Ref", { text: "x" })
    const other = node("o", "filter-list", "Other")
    const filter = node("f", "filter-list", "Filter")
    const edges: E[] = [edge("a", "o", "variables", "prompt")]
    const map = buildConditionVariables("f", edges, [tp, other, filter], extract)
    expect(map.size).toBe(0)
  })
})
