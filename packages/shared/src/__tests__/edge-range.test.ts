import {
  resolveIndex,
  applyRange,
  migrateEdgeOutputMode,
  buildRangeLabel,
} from "../edge-range.js"

// ---------------------------------------------------------------------------
// resolveIndex
// ---------------------------------------------------------------------------
describe("resolveIndex", () => {
  it('resolves "1" to 0-based index 0', () => {
    expect(resolveIndex("1", 5)).toBe(0)
  })

  it('resolves "3" to 0-based index 2', () => {
    expect(resolveIndex("3", 5)).toBe(2)
  })

  it('resolves "last" to the final index', () => {
    expect(resolveIndex("last", 5)).toBe(4)
  })

  it('resolves "last-1" to second-to-last index', () => {
    expect(resolveIndex("last-1", 5)).toBe(3)
  })

  it('resolves "last-2" relative to a short list', () => {
    expect(resolveIndex("last-2", 3)).toBe(0)
  })

  it("clamps out-of-bounds high values", () => {
    expect(resolveIndex("10", 3)).toBe(2)
  })

  it("clamps out-of-bounds low values from last-N", () => {
    expect(resolveIndex("last-5", 3)).toBe(0)
  })

  it("returns 0 for an empty list", () => {
    expect(resolveIndex("1", 0)).toBe(0)
    expect(resolveIndex("last", 0)).toBe(0)
  })

  it('falls back to default on malformed expr "abc"', () => {
    expect(resolveIndex("abc", 5)).toBe(0)
  })

  it('falls back to default on "last-" (missing offset)', () => {
    expect(resolveIndex("last-", 5)).toBe(0)
  })

  it("trims whitespace before parsing", () => {
    expect(resolveIndex(" 2 ", 5)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// applyRange
// ---------------------------------------------------------------------------
describe("applyRange", () => {
  const items = ["a", "b", "c", "d", "e"]

  it("returns all items with default params", () => {
    expect(applyRange(items)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("slices from=2 to=4", () => {
    expect(applyRange(items, "2", "4")).toEqual(["b", "c", "d"])
  })

  it("selects a single item with from=last to=last", () => {
    expect(applyRange(items, "last", "last")).toEqual(["e"])
  })

  it("applies a positive step of 2", () => {
    expect(applyRange(items, "1", "last", 2)).toEqual(["a", "c", "e"])
  })

  it("reverses with step=-1", () => {
    expect(applyRange(items, "last", "1", -1)).toEqual([
      "e",
      "d",
      "c",
      "b",
      "a",
    ])
  })

  it("reverses with step=-2", () => {
    expect(applyRange(items, "5", "1", -2)).toEqual(["e", "c", "a"])
  })

  it("returns empty on direction mismatch (forward range, negative step)", () => {
    expect(applyRange(items, "1", "5", -1)).toEqual([])
  })

  it("returns empty on direction mismatch (reverse range, positive step)", () => {
    expect(applyRange(items, "5", "1", 1)).toEqual([])
  })

  it("treats step=0 as step=1", () => {
    expect(applyRange(items, "1", "last", 0)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ])
  })

  it("returns empty array for empty list", () => {
    expect(applyRange([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// migrateEdgeOutputMode
// ---------------------------------------------------------------------------
describe("migrateEdgeOutputMode", () => {
  it("returns undefined for undefined input", () => {
    expect(migrateEdgeOutputMode(undefined)).toBeUndefined()
  })

  it("returns data unchanged when no outputMode", () => {
    const data = { foo: "bar" }
    expect(migrateEdgeOutputMode(data)).toEqual({ foo: "bar" })
  })

  it('returns data unchanged when outputMode is "list"', () => {
    const data = { outputMode: "list" }
    expect(migrateEdgeOutputMode(data)).toEqual({ outputMode: "list" })
  })

  it('migrates "item:0" to 1-based itemIndex "1"', () => {
    const result = migrateEdgeOutputMode({ outputMode: "item:0" })
    expect(result).toEqual({ outputMode: "item", itemIndex: "1" })
  })

  it('migrates "item:2" to 1-based itemIndex "3"', () => {
    const result = migrateEdgeOutputMode({ outputMode: "item:2" })
    expect(result).toEqual({ outputMode: "item", itemIndex: "3" })
  })

  it('falls back to itemIndex "1" for "item:abc" (NaN)', () => {
    const result = migrateEdgeOutputMode({ outputMode: "item:abc" })
    expect(result).toEqual({ outputMode: "item", itemIndex: "1" })
  })

  it("preserves other data fields during migration", () => {
    const data = { outputMode: "item:0", color: "red", count: 42 }
    const result = migrateEdgeOutputMode(data)
    expect(result).toEqual({
      outputMode: "item",
      itemIndex: "1",
      color: "red",
      count: 42,
    })
  })
})

// ---------------------------------------------------------------------------
// buildRangeLabel
// ---------------------------------------------------------------------------
describe("buildRangeLabel", () => {
  it('returns undefined for mode "last"', () => {
    expect(buildRangeLabel("last")).toBeUndefined()
  })

  it('returns the itemIndex for mode "item"', () => {
    expect(buildRangeLabel("item", undefined, undefined, undefined, "3")).toBe(
      "3",
    )
  })

  it('returns undefined for mode "item" without itemIndex', () => {
    expect(buildRangeLabel("item")).toBeUndefined()
  })

  it('returns undefined for mode "all" with default range and step', () => {
    expect(buildRangeLabel("all", "1", "last", 1)).toBeUndefined()
  })

  it('builds label for mode "all" with non-default from', () => {
    expect(buildRangeLabel("all", "2")).toBe("2..last")
  })

  it('includes step suffix for mode "each" with step 2', () => {
    expect(buildRangeLabel("each", undefined, undefined, 2)).toBe(
      "1..last +2",
    )
  })

  it('includes negative step suffix for mode "each" with step -1', () => {
    expect(buildRangeLabel("each", undefined, undefined, -1)).toBe(
      "1..last -1",
    )
  })

  it('builds label for mode "all" with from and to', () => {
    expect(buildRangeLabel("all", "2", "4")).toBe("2..4")
  })
})
