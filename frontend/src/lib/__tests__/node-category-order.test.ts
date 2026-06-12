import { describe, it, expect } from "vitest"
import { CATEGORY_ORDER, categoryRank } from "../node-category-order"

// The Add Node menu's "All" tab shows root categories in a user-specified
// order. CATEGORY_ORDER is the single source of truth shared by the popup and
// the sidebar — this pins the requested sequence so it can't silently drift.
const REQUESTED_ROOT_ORDER = [
  "Input",
  "Assets",
  "AI",
  "Pickers",
  "Processing",
  "Data",
  "Component",
  "Workflow",
  "Triggers",
  "Output",
] as const

describe("CATEGORY_ORDER", () => {
  it("orders the real root categories exactly as requested", () => {
    const realRoots = CATEGORY_ORDER.filter((id) =>
      (REQUESTED_ROOT_ORDER as readonly string[]).includes(id),
    )
    expect(realRoots).toEqual([...REQUESTED_ROOT_ORDER])
  })

  it("keeps the per-entity sidebar categories slotted with Assets (before AI)", () => {
    for (const entity of ["Character", "Face", "Object", "Location"]) {
      expect(categoryRank(entity)).toBeGreaterThan(categoryRank("Assets"))
      expect(categoryRank(entity)).toBeLessThan(categoryRank("AI"))
    }
  })

  it("ranks unknown categories last", () => {
    expect(categoryRank("Nonexistent")).toBe(CATEGORY_ORDER.length)
  })
})
