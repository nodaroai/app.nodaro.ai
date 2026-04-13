import { vi } from "vitest"
import {
  resolveIndex,
  applyRange,
  migrateEdgeOutputMode,
  buildRangeLabel,
} from "../edge-range.js"
import { parseListExpression } from "../edge-range"
import { resolveListExpression } from "../edge-range"
import { selectListItems } from "../edge-range"

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

describe("buildRangeLabel — List mode support", () => {
  it("returns raw list expression when non-empty (under 18 chars)", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, "list", "1, 2, last"),
    ).toBe("1, 2, last")
    expect(
      buildRangeLabel("all", undefined, undefined, undefined, undefined, "list", "1, 3..5, last"),
    ).toBe("1, 3..5, last")
  })

  it("truncates long list expressions to 18 chars with ellipsis", () => {
    const result = buildRangeLabel(
      "each",
      undefined,
      undefined,
      undefined,
      undefined,
      "list",
      "1, 3..5, 7, 9..11, last",
    )
    expect(result).toMatch(/…$/)
    expect(result!.length).toBeLessThanOrEqual(19)
  })

  it("returns undefined when list mode with empty expression", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, "list", ""),
    ).toBeUndefined()
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, "list", "   "),
    ).toBeUndefined()
  })

  it("does NOT fall through to range logic when list mode with empty expression", () => {
    expect(
      buildRangeLabel("each", "2", "last-1", 2, undefined, "list", ""),
    ).toBeUndefined()
  })

  it("preserves existing range-label behavior when selectorMode is range", () => {
    expect(
      buildRangeLabel("each", "2", "last-1", 2, undefined, "range", undefined),
    ).toBe("2..last-1 +2")
  })

  it("ignores selectorMode in item mode", () => {
    expect(
      buildRangeLabel("item", undefined, undefined, undefined, "3", "list", "1, 2"),
    ).toBe("3")
  })

  it("preserves existing range-label behavior when selectorMode is absent", () => {
    expect(buildRangeLabel("each", "2", "last-1", 2, undefined)).toBe("2..last-1 +2")
    expect(buildRangeLabel("each", "2", "last-1")).toBe("2..last-1")
  })
})

describe("parseListExpression", () => {
  it("accepts valid expressions", () => {
    expect(parseListExpression("1")).toEqual({ ok: true })
    expect(parseListExpression("1, 2, last")).toEqual({ ok: true })
    expect(parseListExpression("1..5")).toEqual({ ok: true })
    expect(parseListExpression("1..10:2")).toEqual({ ok: true })
    expect(parseListExpression("1..5:0")).toEqual({ ok: true })
    expect(parseListExpression("1, 3..5, last")).toEqual({ ok: true })
    expect(parseListExpression("")).toEqual({ ok: true })
    expect(parseListExpression("   ")).toEqual({ ok: true })
    expect(parseListExpression("last..1:-1")).toEqual({ ok: true })
  })

  it("rejects empty tokens between commas", () => {
    expect(parseListExpression("1,,2")).toEqual({
      ok: false,
      error: "Empty item between commas",
    })
  })

  it("rejects range with missing endpoint", () => {
    expect(parseListExpression("..5")).toEqual({
      ok: false,
      error: "Range missing endpoint: ..5",
    })
    expect(parseListExpression("1..")).toEqual({
      ok: false,
      error: "Range missing endpoint: 1..",
    })
  })

  it("rejects non-integer step", () => {
    expect(parseListExpression("1..5:1.5")).toEqual({
      ok: false,
      error: "Step must be an integer",
    })
  })

  it("rejects invalid index tokens", () => {
    expect(parseListExpression("garbage")).toEqual({
      ok: false,
      error: "Invalid index: garbage",
    })
  })
})

describe("resolveListExpression", () => {
  it("resolves single-index terms", () => {
    expect(resolveListExpression("1, 2, 3", 5)).toEqual([0, 1, 2])
    expect(resolveListExpression("1, 2, last", 5)).toEqual([0, 1, 4])
    expect(resolveListExpression("last, 1, last-1", 5)).toEqual([4, 0, 3])
  })

  it("resolves range terms", () => {
    expect(resolveListExpression("1..5", 10)).toEqual([0, 1, 2, 3, 4])
    expect(resolveListExpression("1..last", 3)).toEqual([0, 1, 2])
    expect(resolveListExpression("1..last-1", 5)).toEqual([0, 1, 2, 3])
  })

  it("resolves range with step", () => {
    expect(resolveListExpression("1..10:2", 10)).toEqual([0, 2, 4, 6, 8])
    expect(resolveListExpression("last..1:-1", 3)).toEqual([2, 1, 0])
    expect(resolveListExpression("1..5:0", 10)).toEqual([0, 1, 2, 3, 4])
  })

  it("returns empty for direction-mismatched range", () => {
    expect(resolveListExpression("1..10:-1", 10)).toEqual([])
  })

  it("mixes list and range terms", () => {
    expect(resolveListExpression("1, 3..5, last", 10)).toEqual([0, 2, 3, 4, 9])
  })

  it("treats empty/whitespace expression as all items", () => {
    expect(resolveListExpression("", 5)).toEqual([0, 1, 2, 3, 4])
    expect(resolveListExpression("   ", 5)).toEqual([0, 1, 2, 3, 4])
  })

  it("falls back to all items on malformed input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveListExpression("1,,2", 5)).toEqual([0, 1, 2, 3, 4])
    expect(resolveListExpression("1, ,2", 5)).toEqual([0, 1, 2, 3, 4])
    expect(resolveListExpression("1..garbage", 5)).toEqual([0, 1, 2, 3, 4])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("preserves duplicates and user order", () => {
    expect(resolveListExpression("1, 1, 2", 5)).toEqual([0, 0, 1])
  })

  it("clamps out-of-bounds indices", () => {
    expect(resolveListExpression("100, 200", 5)).toEqual([4, 4])
  })

  it("returns [] for empty list", () => {
    expect(resolveListExpression("1, 2", 0)).toEqual([])
  })
})

describe("selectListItems", () => {
  const items = ["a", "b", "c", "d", "e"]

  it("dispatches to resolveListExpression when selectorMode is list", () => {
    expect(
      selectListItems(items, { selectorMode: "list", listExpression: "1, last" }),
    ).toEqual(["a", "e"])
    expect(
      selectListItems(items, { selectorMode: "list", listExpression: "1..3" }),
    ).toEqual(["a", "b", "c"])
  })

  it("dispatches to applyRange when selectorMode is range", () => {
    expect(
      selectListItems(items, { selectorMode: "range", rangeFrom: "2", rangeTo: "4" }),
    ).toEqual(["b", "c", "d"])
  })

  it("falls back to applyRange when selectorMode is absent", () => {
    expect(selectListItems(items, { rangeFrom: "2", rangeTo: "4" })).toEqual(["b", "c", "d"])
    expect(selectListItems(items, {})).toEqual(items)
    expect(selectListItems(items, undefined)).toEqual(items)
  })

  it("ignores listExpression when selectorMode is not list", () => {
    expect(
      selectListItems(items, { selectorMode: "range", listExpression: "1, 2" }),
    ).toEqual(items)
    expect(
      selectListItems(items, { listExpression: "1, 2" }),
    ).toEqual(items)
  })

  it("returns [] for empty input list", () => {
    expect(
      selectListItems([], { selectorMode: "list", listExpression: "1, 2" }),
    ).toEqual([])
  })
})

import { describeEdgeBehavior } from "../edge-range"

describe("describeEdgeBehavior — basic modes", () => {
  it("last mode", () => {
    expect(describeEdgeBehavior({ outputMode: "last" })).toBe(
      "Passes only the most recent result.",
    )
  })

  it("each default config", () => {
    expect(describeEdgeBehavior({ outputMode: "each" })).toBe(
      "Runs the downstream node once per item.",
    )
  })

  it("all default config", () => {
    expect(describeEdgeBehavior({ outputMode: "all" })).toBe(
      "Passes all items together as a list.",
    )
  })

  it("default config treats empty-string range fields as defaults", () => {
    expect(
      describeEdgeBehavior({ outputMode: "each", rangeFrom: "", rangeTo: "" }),
    ).toBe("Runs the downstream node once per item.")
    expect(
      describeEdgeBehavior({ outputMode: "each", rangeFrom: " ", rangeTo: "last" }),
    ).toBe("Runs the downstream node once per item.")
  })

  it("default config treats step 0 as default", () => {
    expect(describeEdgeBehavior({ outputMode: "each", rangeStep: 0 })).toBe(
      "Runs the downstream node once per item.",
    )
  })
})

describe("describeEdgeBehavior — item mode", () => {
  it("item 1 → the first item", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "1" })).toBe(
      "Passes only the first item.",
    )
  })
  it("item N (N>=2) → item N", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "3" })).toBe(
      "Passes only item 3.",
    )
  })
  it("last", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "last" })).toBe(
      "Passes only the last item.",
    )
  })
  it("last-0 equivalent to last", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "last-0" })).toBe(
      "Passes only the last item.",
    )
  })
  it("last-1", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "last-1" })).toBe(
      "Passes only the second-to-last item.",
    )
  })
  it("last-4 uses ordinal fallback", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "last-4" })).toBe(
      "Passes only the 5th-from-last item.",
    )
  })
  it("canonicalizes empty/missing itemIndex to 1", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "" })).toBe(
      "Passes only the first item.",
    )
    expect(describeEdgeBehavior({ outputMode: "item" })).toBe(
      "Passes only the first item.",
    )
  })
  it("canonicalizes malformed itemIndex to 1", () => {
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "garbage" })).toBe(
      "Passes only the first item.",
    )
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "0" })).toBe(
      "Passes only the first item.",
    )
    expect(describeEdgeBehavior({ outputMode: "item", itemIndex: "\t3\n" })).toBe(
      "Passes only item 3.",
    )
  })
})

describe("describeEdgeBehavior — Range tab SELECTION_PHRASE", () => {
  it("each with simple range", () => {
    expect(
      describeEdgeBehavior({ outputMode: "each", rangeFrom: "2", rangeTo: "last-1" }),
    ).toBe("Fans out over items 2 through the second-to-last.")
  })

  it("all with simple range", () => {
    expect(
      describeEdgeBehavior({ outputMode: "all", rangeFrom: "2", rangeTo: "last-1" }),
    ).toBe("Passes items 2 through the second-to-last as a list.")
  })

  it("each full-list reverse", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "1",
        rangeStep: -1,
      }),
    ).toBe("Fans out over all items in reverse order.")
  })

  it("each positive step > 1", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "10",
        rangeStep: 2,
      }),
    ).toBe("Fans out over items 1 through 10 (every 2nd item).")
  })

  it("each step 3 and step 21 ordinals", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "10",
        rangeStep: 3,
      }),
    ).toBe("Fans out over items 1 through 10 (every 3rd item).")
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "21",
        rangeStep: 21,
      }),
    ).toBe("Fans out over items 1 through 21 (every 21st item).")
  })

  it("empty-result concrete", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "5",
        rangeTo: "2",
        rangeStep: 1,
      }),
    ).toBe("Selects no items — downstream node will not run.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        rangeFrom: "5",
        rangeTo: "2",
        rangeStep: 1,
      }),
    ).toBe("Selects no items — downstream node will receive an empty list.")
  })

  it("empty-result both relative", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "last-3",
        rangeStep: 1,
      }),
    ).toBe("Selects no items — downstream node will not run.")
  })

  it("empty-result negative step with from < to", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "5",
        rangeStep: -1,
      }),
    ).toBe("Selects no items — downstream node will not run.")
  })

  it("mixed-kind skips empty-result detection (falls through)", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last-5",
        rangeTo: "3",
        rangeStep: 1,
      }),
    ).toBe("Fans out over items the 6th-from-last through 3.")
  })

  it("A==B collapse concrete", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "3",
        rangeTo: "3",
      }),
    ).toBe("Runs the downstream node only on item 3.")
  })

  it("A==B collapse relative via last/last-0 alias", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "last-0",
      }),
    ).toBe("Runs the downstream node only on the last item.")
  })
})

describe("describeEdgeBehavior — List tab SELECTION_PHRASE", () => {
  it("3-term list", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1, 3, last",
      }),
    ).toBe("Fans out over items 1, 3, and the last one.")
  })

  it("all mode 3-term list with inner range", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "1, 3..5, last",
      }),
    ).toBe("Passes items 1, 3 through 5, and the last one as a list.")
  })

  it("2-term list (no Oxford comma)", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1, last",
      }),
    ).toBe("Fans out over items 1 and the last one.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "1, last",
      }),
    ).toBe("Passes items 1 and the last one as a list.")
  })

  it("single-range-term list", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1..5",
      }),
    ).toBe("Fans out over items 1 through 5.")
  })

  it("single-index term triggers special case", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "last",
      }),
    ).toBe("Runs the downstream node only on the last item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "3",
      }),
    ).toBe("Passes only item 3 as a list.")
  })

  it("collapsed range term A..A only triggers single-index special case", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "3..3",
      }),
    ).toBe("Passes only item 3 as a list.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "last..last-0",
      }),
    ).toBe("Passes only the last item as a list.")
  })

  it("empty/whitespace listExpression → default config", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "",
      }),
    ).toBe("Runs the downstream node once per item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "   ",
      }),
    ).toBe("Passes all items together as a list.")
  })

  it("malformed listExpression → fallback to mode default", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "garbage",
      }),
    ).toBe("Runs the downstream node once per item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "garbage",
      }),
    ).toBe("Passes all items together as a list.")
  })

  it("List tab range term with step > 1", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1..10:2",
      }),
    ).toBe("Fans out over items 1 through 10 (every 2nd).")
  })

  it("List tab empty-result range term rendered as-typed", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "5..2",
      }),
    ).toBe("Fans out over items 5 through 2.")
  })
})

describe("describeEdgeBehavior — useAllResults suffix", () => {
  it("item mode with useAllResults", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "item",
        itemIndex: "last",
        useAllResults: true,
      }),
    ).toBe("Passes only the last item (across all accumulated results).")
  })

  it("each default with useAllResults", () => {
    expect(
      describeEdgeBehavior({ outputMode: "each", useAllResults: true }),
    ).toBe("Runs the downstream node once per item (across all accumulated results).")
  })

  it("each list with useAllResults", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1, 3, last",
        useAllResults: true,
      }),
    ).toBe("Fans out over items 1, 3, and the last one (across all accumulated results).")
  })

  it("each single-index list with useAllResults", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "last",
        useAllResults: true,
      }),
    ).toBe("Runs the downstream node only on the last item (across all accumulated results).")
  })

  it("each range-collapsed with useAllResults", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "3",
        rangeTo: "3",
        useAllResults: true,
      }),
    ).toBe("Runs the downstream node only on item 3 (across all accumulated results).")
  })

  it("all range with useAllResults", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        rangeFrom: "2",
        rangeTo: "last-1",
        useAllResults: true,
      }),
    ).toBe("Passes items 2 through the second-to-last as a list (across all accumulated results).")
  })

  it("last mode ignores useAllResults", () => {
    expect(
      describeEdgeBehavior({ outputMode: "last", useAllResults: true }),
    ).toBe("Passes only the most recent result.")
  })
})

describe("describeEdgeBehavior — runsExpression suffix", () => {
  it("each mode + runsExpression list → swaps to 'across runs ...'", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "1, 3, last",
      }),
    ).toBe("Runs the downstream node once per item (across runs 1, 3, and the last one).")
  })

  it("each mode + runsExpression range", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "1..5",
      }),
    ).toBe("Runs the downstream node once per item (across runs 1 through 5).")
  })

  it("each mode + runsExpression single index 'last'", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "last",
      }),
    ).toBe("Runs the downstream node once per item (across runs the last one).")
  })

  it("item mode + runsExpression", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "item",
        itemIndex: "last",
        useAllResults: true,
        runsExpression: "1, 3, last",
      }),
    ).toBe("Passes only the last item (across runs 1, 3, and the last one).")
  })

  it("each mode + list selector + runsExpression both active", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "2, 3",
        useAllResults: true,
        runsExpression: "1, last",
      }),
    ).toBe("Fans out over items 2 and 3 (across runs 1 and the last one).")
  })

  it("malformed runsExpression falls back to 'all accumulated results'", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "abc",
      }),
    ).toBe("Runs the downstream node once per item (across all accumulated results).")
  })

  it("empty runsExpression with useAllResults true → 'all accumulated results'", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "",
      }),
    ).toBe("Runs the downstream node once per item (across all accumulated results).")
  })

  it("whitespace-only runsExpression → 'all accumulated results'", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: true,
        runsExpression: "   ",
      }),
    ).toBe("Runs the downstream node once per item (across all accumulated results).")
  })

  it("last mode + runsExpression → no suffix", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "last",
        useAllResults: true,
        runsExpression: "1, 3",
      }),
    ).toBe("Passes only the most recent result.")
  })

  it("useAllResults false + runsExpression → expression ignored, no suffix", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        useAllResults: false,
        runsExpression: "1, 3",
      }),
    ).toBe("Runs the downstream node once per item.")
  })

  it("all mode + range item filter + runsExpression range", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        rangeFrom: "2",
        rangeTo: "last-1",
        useAllResults: true,
        runsExpression: "1..3",
      }),
    ).toBe("Passes items 2 through the second-to-last as a list (across runs 1 through 3).")
  })
})

describe("buildRangeLabel — useAllResults + runsExpression", () => {
  it("useAllResults false, no runsExpression → returns item label only (existing behavior)", () => {
    expect(
      buildRangeLabel("each", "1", "last", 1, undefined, undefined, undefined, false, undefined),
    ).toBeUndefined() // default range, no label
    expect(
      buildRangeLabel("each", "2", "last-1", undefined, undefined, undefined, undefined, false, undefined),
    ).toBe("2..last-1")
  })

  it("useAllResults true, empty runsExpression, no item label → 'all runs'", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, undefined, undefined, true, undefined),
    ).toBe("all runs")
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, undefined, undefined, true, ""),
    ).toBe("all runs")
  })

  it("useAllResults true, runsExpression set, no item label → 'runs: <expr>'", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, undefined, undefined, true, "1, 3"),
    ).toBe("runs: 1, 3")
  })

  it("useAllResults true, empty runsExpression, item label set → 'all runs → items: <label>'", () => {
    expect(
      buildRangeLabel("each", "2", "last", undefined, undefined, undefined, undefined, true, undefined),
    ).toBe("all runs → items: 2..last")
  })

  it("useAllResults true, runsExpression + item label → 'runs: <expr> → items: <label>'", () => {
    expect(
      buildRangeLabel("each", "2", "last", undefined, undefined, undefined, undefined, true, "1, 3"),
    ).toBe("runs: 1, 3 → items: 2..last")
  })

  it("useAllResults true with list selector item label", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, "list", "2, 3", true, "1, last"),
    ).toBe("runs: 1, last → items: 2, 3")
  })

  it("useAllResults true with last mode (item label is undefined) → 'all runs' or 'runs: <expr>'", () => {
    expect(
      buildRangeLabel("last", undefined, undefined, undefined, undefined, undefined, undefined, true, undefined),
    ).toBe("all runs")
    expect(
      buildRangeLabel("last", undefined, undefined, undefined, undefined, undefined, undefined, true, "1, 3"),
    ).toBe("runs: 1, 3")
  })

  it("useAllResults false, runsExpression set → ignored (no label change)", () => {
    expect(
      buildRangeLabel("each", undefined, undefined, undefined, undefined, undefined, undefined, false, "1, 3"),
    ).toBeUndefined()
  })
})
