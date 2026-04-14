import { describe, it, expect } from "vitest"
import { resolveIndex, applyRange, buildRangeLabel, migrateEdgeOutputMode } from "@nodaro-shared/edge-range"

describe("resolveIndex", () => {
  it("resolves absolute 1-based index to 0-based", () => {
    expect(resolveIndex("1", 10)).toBe(0)
    expect(resolveIndex("3", 10)).toBe(2)
    expect(resolveIndex("10", 10)).toBe(9)
  })

  it("resolves 'last' to last index", () => {
    expect(resolveIndex("last", 10)).toBe(9)
    expect(resolveIndex("last", 1)).toBe(0)
  })

  it("resolves 'last-N' to relative index", () => {
    expect(resolveIndex("last-1", 10)).toBe(8)
    expect(resolveIndex("last-2", 10)).toBe(7)
    expect(resolveIndex("last-9", 10)).toBe(0)
  })

  it("clamps out-of-bounds to valid range", () => {
    expect(resolveIndex("0", 10)).toBe(0)
    expect(resolveIndex("-1", 10)).toBe(0)
    expect(resolveIndex("20", 10)).toBe(9)
    expect(resolveIndex("last-100", 10)).toBe(0)
  })

  it("falls back to default for malformed input", () => {
    expect(resolveIndex("garbage", 10, "1")).toBe(0)
    expect(resolveIndex("last-abc", 10, "last")).toBe(9)
    expect(resolveIndex("last--2", 10, "1")).toBe(0)
    expect(resolveIndex("", 10, "1")).toBe(0)
  })

  it("handles empty list", () => {
    expect(resolveIndex("1", 0)).toBe(0)
    expect(resolveIndex("last", 0)).toBe(0)
  })
})

describe("applyRange", () => {
  const list = ["a", "b", "c", "d", "e"]

  it("returns full list with no range params", () => {
    expect(applyRange(list)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("slices with from and to", () => {
    expect(applyRange(list, "2", "4")).toEqual(["b", "c", "d"])
  })

  it("handles last-N notation", () => {
    expect(applyRange(list, "2", "last-1")).toEqual(["b", "c", "d"])
    expect(applyRange(list, "1", "last")).toEqual(["a", "b", "c", "d", "e"])
  })

  it("applies positive step", () => {
    expect(applyRange(list, "1", "last", 2)).toEqual(["a", "c", "e"])
    expect(applyRange(list, "1", "4", 2)).toEqual(["a", "c"])
  })

  it("applies negative step (reverse)", () => {
    expect(applyRange(list, "last", "1", -1)).toEqual(["e", "d", "c", "b", "a"])
    expect(applyRange(list, "last", "1", -2)).toEqual(["e", "c", "a"])
    expect(applyRange(list, "4", "2", -1)).toEqual(["d", "c", "b"])
  })

  it("returns empty for direction mismatch", () => {
    expect(applyRange(list, "1", "last", -1)).toEqual([])
    expect(applyRange(list, "last", "1", 1)).toEqual([])
  })

  it("treats step 0 as step 1", () => {
    expect(applyRange(list, "1", "last", 0)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("handles empty list", () => {
    expect(applyRange([], "1", "last")).toEqual([])
  })

  it("handles single-item list", () => {
    expect(applyRange(["x"], "1", "last")).toEqual(["x"])
  })
})

describe("migrateEdgeOutputMode", () => {
  it("migrates item:0 to item + itemIndex 1", () => {
    expect(migrateEdgeOutputMode({ outputMode: "item:0" })).toEqual({
      outputMode: "item",
      itemIndex: "1",
    })
  })

  it("migrates item:3 to item + itemIndex 4", () => {
    expect(migrateEdgeOutputMode({ outputMode: "item:3" })).toEqual({
      outputMode: "item",
      itemIndex: "4",
    })
  })

  it("leaves non-item modes unchanged", () => {
    expect(migrateEdgeOutputMode({ outputMode: "each" })).toEqual({ outputMode: "each" })
    expect(migrateEdgeOutputMode({ outputMode: "last" })).toEqual({ outputMode: "last" })
    expect(migrateEdgeOutputMode({ outputMode: "all" })).toEqual({ outputMode: "all" })
  })

  it("leaves already-migrated item mode unchanged", () => {
    expect(migrateEdgeOutputMode({ outputMode: "item", itemIndex: "3" }))
      .toEqual({ outputMode: "item", itemIndex: "3" })
  })

  it("handles undefined data", () => {
    expect(migrateEdgeOutputMode(undefined)).toBeUndefined()
  })

  it("handles empty data", () => {
    expect(migrateEdgeOutputMode({})).toEqual({})
  })
})

describe("buildRangeLabel", () => {
  it("returns undefined for default each (no range)", () => {
    expect(buildRangeLabel("each")).toBeUndefined()
    expect(buildRangeLabel("each", undefined, undefined, undefined)).toBeUndefined()
  })

  it("builds label for each with range", () => {
    expect(buildRangeLabel("each", "2", "last-1")).toBe("2..last-1")
    expect(buildRangeLabel("each", "2", "last-1", 2)).toBe("2..last-1 +2")
    expect(buildRangeLabel("each", "last", "1", -1)).toBe("last..1 -1")
    expect(buildRangeLabel("each", "last", "1", -2)).toBe("last..1 -2")
  })

  it("builds label for all with range", () => {
    expect(buildRangeLabel("all", "3", "last")).toBe("3..last")
  })

  it("returns undefined for default all (no range)", () => {
    expect(buildRangeLabel("all")).toBeUndefined()
  })

  it("builds label for item", () => {
    expect(buildRangeLabel("item", undefined, undefined, undefined, "3")).toBe("3")
    expect(buildRangeLabel("item", undefined, undefined, undefined, "last-1")).toBe("last-1")
  })

  it("returns undefined for last mode", () => {
    expect(buildRangeLabel("last")).toBeUndefined()
  })

  it("omits step when step is 1 (default)", () => {
    expect(buildRangeLabel("each", "2", "last", 1)).toBe("2..last")
  })

  it("omits range when from=1 and to=last (defaults)", () => {
    expect(buildRangeLabel("each", "1", "last")).toBeUndefined()
    expect(buildRangeLabel("each", "1", "last", 1)).toBeUndefined()
  })
})

import {
  resolveListExpression,
  parseListExpression,
  selectListItems,
  describeEdgeBehavior,
} from "@nodaro-shared/edge-range"

describe("frontend re-export smoke test", () => {
  it("resolveListExpression is callable", () => {
    expect(resolveListExpression("1, 2", 5)).toEqual([0, 1])
  })
  it("parseListExpression is callable", () => {
    expect(parseListExpression("1, 2")).toEqual({ ok: true })
  })
  it("selectListItems is callable", () => {
    expect(
      selectListItems(["a", "b", "c"], { selectorMode: "list", listExpression: "1, 3" }),
    ).toEqual(["a", "c"])
  })
  it("describeEdgeBehavior is callable", () => {
    expect(describeEdgeBehavior({ outputMode: "last" })).toBe(
      "Passes the selected result.",
    )
  })
})
