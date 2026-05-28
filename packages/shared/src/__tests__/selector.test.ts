import { vi } from "vitest"
import {
  resolveIndex,
  applyRange,
  migrateEdgeOutputMode,
  buildRangeLabel,
} from "../selector.js"
import { parseListExpression } from "../selector"
import { resolveListExpression } from "../selector"
import { selectListItems } from "../selector"

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

  it('includes step suffix for mode "all" with step 2', () => {
    expect(buildRangeLabel("all", undefined, undefined, 2)).toBe("1..last +2")
  })

  it('includes negative step suffix for mode "all" with step -1', () => {
    expect(buildRangeLabel("all", "last", "1", -1)).toBe("last..1 -1")
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

import { describeEdgeBehavior } from "../selector"

describe("describeEdgeBehavior — basic modes", () => {
  it("last mode", () => {
    expect(describeEdgeBehavior({ outputMode: "last" })).toBe(
      "Passes the selected result.",
    )
  })

  it("each default config", () => {
    expect(describeEdgeBehavior({ outputMode: "each" })).toBe(
      "Runs the next node one by one, per item.",
    )
  })

  it("all default config", () => {
    expect(describeEdgeBehavior({ outputMode: "all" })).toBe(
      "Passes all items at once.",
    )
  })

  it("default config treats empty-string range fields as defaults", () => {
    expect(
      describeEdgeBehavior({ outputMode: "each", rangeFrom: "", rangeTo: "" }),
    ).toBe("Runs the next node one by one, per item.")
    expect(
      describeEdgeBehavior({ outputMode: "each", rangeFrom: " ", rangeTo: "last" }),
    ).toBe("Runs the next node one by one, per item.")
  })

  it("default config treats step 0 as default", () => {
    expect(describeEdgeBehavior({ outputMode: "each", rangeStep: 0 })).toBe(
      "Runs the next node one by one, per item.",
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
    ).toBe("Runs the next node once for items 2 through the second-to-last.")
  })

  it("all with simple range", () => {
    expect(
      describeEdgeBehavior({ outputMode: "all", rangeFrom: "2", rangeTo: "last-1" }),
    ).toBe("Passes items 2 through the second-to-last at once.")
  })

  it("each full-list reverse", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "1",
        rangeStep: -1,
      }),
    ).toBe("Runs the next node once for all items in reverse order.")
  })

  it("each positive step > 1", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "10",
        rangeStep: 2,
      }),
    ).toBe("Runs the next node once for items 1 through 10 (every 2nd item).")
  })

  it("each step 3 and step 21 ordinals", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "10",
        rangeStep: 3,
      }),
    ).toBe("Runs the next node once for items 1 through 10 (every 3rd item).")
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "21",
        rangeStep: 21,
      }),
    ).toBe("Runs the next node once for items 1 through 21 (every 21st item).")
  })

  it("empty-result concrete", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "5",
        rangeTo: "2",
        rangeStep: 1,
      }),
    ).toBe("Nothing selected — the next node won't run.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        rangeFrom: "5",
        rangeTo: "2",
        rangeStep: 1,
      }),
    ).toBe("Nothing selected — the next node will get an empty bundle.")
  })

  it("empty-result both relative", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "last-3",
        rangeStep: 1,
      }),
    ).toBe("Nothing selected — the next node won't run.")
  })

  it("empty-result negative step with from < to", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "1",
        rangeTo: "5",
        rangeStep: -1,
      }),
    ).toBe("Nothing selected — the next node won't run.")
  })

  it("mixed-kind skips empty-result detection (falls through)", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last-5",
        rangeTo: "3",
        rangeStep: 1,
      }),
    ).toBe("Runs the next node once for items the 6th-from-last through 3.")
  })

  it("A==B collapse concrete", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "3",
        rangeTo: "3",
      }),
    ).toBe("Runs the next node only on item 3.")
  })

  it("A==B collapse relative via last/last-0 alias", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        rangeFrom: "last",
        rangeTo: "last-0",
      }),
    ).toBe("Runs the next node only on the last item.")
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
    ).toBe("Runs the next node once for items 1, 3, and the last one.")
  })

  it("all mode 3-term list with inner range", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "1, 3..5, last",
      }),
    ).toBe("Passes items 1, 3 through 5, and the last one at once.")
  })

  it("2-term list (no Oxford comma)", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1, last",
      }),
    ).toBe("Runs the next node once for items 1 and the last one.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "1, last",
      }),
    ).toBe("Passes items 1 and the last one at once.")
  })

  it("single-range-term list", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1..5",
      }),
    ).toBe("Runs the next node once for items 1 through 5.")
  })

  it("single-index term triggers special case", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "last",
      }),
    ).toBe("Runs the next node only on the last item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "3",
      }),
    ).toBe("Passes only item 3.")
  })

  it("collapsed range term A..A only triggers single-index special case", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "3..3",
      }),
    ).toBe("Passes only item 3.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "last..last-0",
      }),
    ).toBe("Passes only the last item.")
  })

  it("empty/whitespace listExpression → default config", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "",
      }),
    ).toBe("Runs the next node one by one, per item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "   ",
      }),
    ).toBe("Passes all items at once.")
  })

  it("malformed listExpression → fallback to mode default", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "garbage",
      }),
    ).toBe("Runs the next node one by one, per item.")
    expect(
      describeEdgeBehavior({
        outputMode: "all",
        selectorMode: "list",
        listExpression: "garbage",
      }),
    ).toBe("Passes all items at once.")
  })

  it("List tab range term with step > 1", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "1..10:2",
      }),
    ).toBe("Runs the next node once for items 1 through 10 (every 2nd).")
  })

  it("List tab empty-result range term rendered as-typed", () => {
    expect(
      describeEdgeBehavior({
        outputMode: "each",
        selectorMode: "list",
        listExpression: "5..2",
      }),
    ).toBe("Runs the next node once for items 5 through 2.")
  })
})

import type { FullSelectorMode, SelectorConfig, SelectorResult } from "../selector.js"

describe("SelectorConfig types", () => {
  it("compiles for the item mode minimum config", () => {
    const c: SelectorConfig = { mode: "item", itemIndex: "1" }
    expect(c.mode).toBe("item")
  })

  it("compiles for the predicate mode full config", () => {
    const c: SelectorConfig = {
      mode: "predicate",
      predicateField: "score",
      predicateOp: ">=",
      predicateValue: "15",
      predicateMatch: "all",
      predicateCaseSensitive: false,
    }
    expect(c.predicateMatch).toBe("all")
  })

  it("SelectorResult enforces both keys", () => {
    const r: SelectorResult = { picked: ["a"], rest: ["b", "c"] }
    expect(r.picked.length + r.rest.length).toBe(3)
  })
})

import { runSelector } from "../selector.js"

describe("runSelector — item mode", () => {
  it("picks 1-based index", () => {
    const { picked, rest } = runSelector(
      ["a", "b", "c", "d"],
      { mode: "item", itemIndex: "2" },
    )
    expect(picked).toEqual(["b"])
    expect(rest).toEqual(["a", "c", "d"])
  })

  it('resolves "last-1"', () => {
    const { picked } = runSelector(
      ["a", "b", "c", "d"],
      { mode: "item", itemIndex: "last-1" },
    )
    expect(picked).toEqual(["c"])
  })

  it("returns empty arrays on empty input", () => {
    const { picked, rest } = runSelector([], { mode: "item", itemIndex: "1" })
    expect(picked).toEqual([])
    expect(rest).toEqual([])
  })
})

describe("runSelector — range mode", () => {
  it("slices from/to inclusive", () => {
    const { picked, rest } = runSelector(
      ["a", "b", "c", "d", "e"],
      { mode: "range", rangeFrom: "2", rangeTo: "4", rangeStep: 1 },
    )
    expect(picked).toEqual(["b", "c", "d"])
    expect(rest).toEqual(["a", "e"])
  })

  it("partitions by INDEX (not value) so duplicates land in the right buckets", () => {
    // If the implementation used items.indexOf(value) to recover picked
    // indices, both "a"s would resolve to index 0 and the second "a" would
    // end up in `rest`, while index 2 ("c") would leak into picked.
    const { picked, rest } = runSelector(
      ["a", "b", "a", "c"],
      { mode: "range", rangeFrom: "2", rangeTo: "3", rangeStep: 1 },
    )
    expect(picked).toEqual(["b", "a"])  // indices 1, 2
    expect(rest).toEqual(["a", "c"])    // indices 0, 3
  })
})

describe("runSelector — list mode", () => {
  it("picks at specific 1-based indices", () => {
    const { picked, rest } = runSelector(
      ["a", "b", "c", "d", "e"],
      { mode: "list", listExpression: "1,3,5" },
    )
    expect(picked).toEqual(["a", "c", "e"])
    expect(rest).toEqual(["b", "d"])
  })
})

describe("runSelector — random mode", () => {
  it("is deterministic for the same seed", () => {
    const a = runSelector(["a", "b", "c", "d"], { mode: "random", seed: "42", randomCount: 2 })
    const b = runSelector(["a", "b", "c", "d"], { mode: "random", seed: "42", randomCount: 2 })
    expect(a.picked).toEqual(b.picked)
    expect(a.rest).toEqual(b.rest)
  })

  it("returns different results for different seeds", () => {
    const a = runSelector(["a", "b", "c", "d"], { mode: "random", seed: "1", randomCount: 2 })
    const b = runSelector(["a", "b", "c", "d"], { mode: "random", seed: "999", randomCount: 2 })
    // It's possible for two seeds to coincide, but with 4 items + count 2 this
    // is overwhelmingly unlikely for the chosen seeds.
    expect(a.picked).not.toEqual(b.picked)
  })

  it("samples without replacement", () => {
    const { picked } = runSelector(["a", "b", "c", "d"], { mode: "random", seed: "7", randomCount: 3 })
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
  })

  it("clamps count to list length", () => {
    const { picked, rest } = runSelector(["a", "b"], { mode: "random", seed: "7", randomCount: 10 })
    expect(picked).toHaveLength(2)
    expect(rest).toHaveLength(0)
  })

  it("defaults count to 1 when omitted", () => {
    const { picked } = runSelector(["a", "b", "c"], { mode: "random", seed: "7" })
    expect(picked).toHaveLength(1)
  })

  it("uses Math.random when seed is empty", () => {
    // No determinism check — just verify it runs and returns a valid result.
    const { picked, rest } = runSelector(["a", "b", "c"], { mode: "random", randomCount: 1 })
    expect(picked).toHaveLength(1)
    expect(rest).toHaveLength(2)
  })
})

describe("runSelector — modulo mode", () => {
  it("picks index = divisor % length", () => {
    const { picked, rest } = runSelector(
      ["a", "b", "c"],
      { mode: "modulo", moduloDivisor: "5" },
    )
    // 5 % 3 = 2 → index 2 → "c"
    expect(picked).toEqual(["c"])
    expect(rest).toEqual(["a", "b"])
  })

  it("handles divisor < length", () => {
    const { picked } = runSelector(
      ["a", "b", "c"],
      { mode: "modulo", moduloDivisor: "1" },
    )
    expect(picked).toEqual(["b"])
  })

  it("falls back to index 0 on non-numeric divisor", () => {
    const { picked } = runSelector(
      ["a", "b", "c"],
      { mode: "modulo", moduloDivisor: "abc" },
    )
    expect(picked).toEqual(["a"])
  })

  it("falls back to index 0 when divisor is missing", () => {
    const { picked } = runSelector(["a", "b", "c"], { mode: "modulo" })
    expect(picked).toEqual(["a"])
  })
})

describe("runSelector — predicate mode", () => {
  const items = [
    JSON.stringify({ name: "a", score: 10 }),
    JSON.stringify({ name: "b", score: 20 }),
    JSON.stringify({ name: "c", score: 30 }),
  ]

  it("returns first matching item by default", () => {
    const { picked, rest } = runSelector(items, {
      mode: "predicate",
      predicateField: "score",
      predicateOp: ">=",
      predicateValue: "15",
    })
    expect(picked).toHaveLength(1)
    expect(JSON.parse(picked[0]).name).toBe("b")
    expect(rest).toHaveLength(2)
  })

  it("returns all matching items when match='all'", () => {
    const { picked, rest } = runSelector(items, {
      mode: "predicate",
      predicateField: "score",
      predicateOp: ">=",
      predicateValue: "15",
      predicateMatch: "all",
    })
    expect(picked.map((p) => JSON.parse(p).name)).toEqual(["b", "c"])
    expect(rest.map((p) => JSON.parse(p).name)).toEqual(["a"])
  })

  it("returns empty picked when no items match", () => {
    const { picked, rest } = runSelector(items, {
      mode: "predicate",
      predicateField: "score",
      predicateOp: ">",
      predicateValue: "100",
    })
    expect(picked).toEqual([])
    expect(rest).toEqual(items)
  })

  it("respects case-sensitive flag for string ops", () => {
    const stringItems = [JSON.stringify({ name: "Hero" }), JSON.stringify({ name: "hero" })]
    const sensitive = runSelector(stringItems, {
      mode: "predicate", predicateField: "name", predicateOp: "=",
      predicateValue: "hero", predicateMatch: "all", predicateCaseSensitive: true,
    })
    expect(sensitive.picked).toHaveLength(1)

    const insensitive = runSelector(stringItems, {
      mode: "predicate", predicateField: "name", predicateOp: "=",
      predicateValue: "hero", predicateMatch: "all", predicateCaseSensitive: false,
    })
    expect(insensitive.picked).toHaveLength(2)
  })

  it("matches whole item when predicateField is blank", () => {
    // The selector-config.tsx field input shows the placeholder
    // "blank = whole item". evaluateCondition treats an empty field path as
    // "compare against the whole parsed item" — selectByPredicate used to
    // early-bail on missing predicateField, defeating that UI affordance.
    const items = ["alpha", "bravo", "charlie"]
    const out = runSelector(items, {
      mode: "predicate",
      predicateOp: "contains",
      predicateValue: "rav",
      predicateMatch: "all",
    })
    expect(out.picked).toEqual(["bravo"])
    expect(out.rest).toEqual(["alpha", "charlie"])
  })

  it("defaults predicateOp to '=' when undefined", () => {
    // The selector-config.tsx op dropdown shows `op={config.predicateOp ?? "="}`.
    // First-time predicate use without explicitly picking an op used to
    // silently return picked=[] because the early-bail tripped. Now the
    // runtime matches the UI's visual default.
    const items = [
      JSON.stringify({ name: "hero" }),
      JSON.stringify({ name: "villain" }),
    ]
    const out = runSelector(items, {
      mode: "predicate",
      predicateField: "name",
      predicateValue: "villain",
      predicateMatch: "all",
    })
    expect(out.picked).toHaveLength(1)
    expect(JSON.parse(out.picked[0]).name).toBe("villain")
  })

  it("uses case-INsensitive matching by default when predicateCaseSensitive is undefined", () => {
    // The selector-config.tsx case checkbox shows
    // `caseSensitive={config.predicateCaseSensitive ?? false}` — unchecked
    // by default. Before the fix, undefined config silently flipped to
    // case-sensitive at runtime (evaluateCondition's default), so the user
    // saw "case-insensitive" UI and got case-sensitive matching.
    const stringItems = [JSON.stringify({ name: "Hero" }), JSON.stringify({ name: "hero" })]
    const out = runSelector(stringItems, {
      mode: "predicate",
      predicateField: "name",
      predicateOp: "=",
      predicateValue: "hero",
      predicateMatch: "all",
      // predicateCaseSensitive intentionally omitted
    })
    expect(out.picked).toHaveLength(2)
  })
})

describe("runSelector — named-key mode", () => {
  const items = [
    JSON.stringify({ name: "hero", url: "x" }),
    JSON.stringify({ name: "villain", url: "y" }),
    JSON.stringify({ name: "sidekick", url: "z" }),
  ]

  it("picks the first item whose field equals value", () => {
    const { picked, rest } = runSelector(items, {
      mode: "named-key",
      namedKeyField: "name",
      namedKeyValue: "hero",
    })
    expect(picked).toHaveLength(1)
    expect(JSON.parse(picked[0]).url).toBe("x")
    expect(rest).toHaveLength(2)
  })

  it("returns empty picked when no match", () => {
    const { picked, rest } = runSelector(items, {
      mode: "named-key",
      namedKeyField: "name",
      namedKeyValue: "ghost",
    })
    expect(picked).toEqual([])
    expect(rest).toEqual(items)
  })
})

// ---------------------------------------------------------------------------
// resolveSelectorRefs — {NodeLabel} resolution for template-aware fields
// ---------------------------------------------------------------------------
import { resolveSelectorRefs } from "../selector.js"

describe("resolveSelectorRefs", () => {
  const variables = new Map<string, string>([
    ["LoopIteration", "5"],
    ["HeroName", "knight"],
  ])

  it("resolves refs in moduloDivisor", () => {
    const out = resolveSelectorRefs(
      { mode: "modulo", moduloDivisor: "{LoopIteration}" },
      undefined,
      variables,
    )
    expect(out.moduloDivisor).toBe("5")
  })

  it("resolves refs in predicateValue, namedKeyValue, seed", () => {
    const out = resolveSelectorRefs(
      {
        mode: "named-key",
        namedKeyField: "name",
        namedKeyValue: "{HeroName}",
        seed: "{HeroName}",
        predicateValue: "{HeroName}",
      },
      undefined,
      variables,
    )
    expect(out.namedKeyValue).toBe("knight")
    expect(out.seed).toBe("knight")
    expect(out.predicateValue).toBe("knight")
  })

  it("leaves non-template fields untouched", () => {
    const out = resolveSelectorRefs(
      { mode: "item", itemIndex: "last-1" },
      undefined,
      variables,
    )
    expect(out.itemIndex).toBe("last-1")
  })

  it("leaves unresolved refs verbatim", () => {
    const out = resolveSelectorRefs(
      { mode: "modulo", moduloDivisor: "{Unknown}" },
      undefined,
      variables,
    )
    expect(out.moduloDivisor).toBe("{Unknown}")
  })

  it("substitutes {{trigger.foo}} in predicateValue when triggerData is passed", () => {
    // Selector must keep `{{trigger.*}}` semantics in lockstep with
    // filter-list / router conditions — both call `substituteTriggerTokens`.
    const out = resolveSelectorRefs(
      {
        mode: "predicate",
        predicateField: "name",
        predicateOp: "=",
        predicateValue: "{{trigger.hero}}",
      },
      { hero: "knight" },
      variables,
    )
    expect(out.predicateValue).toBe("knight")
  })

  it("mixes {Label} refs and {{trigger.*}} tokens in the same field", () => {
    const out = resolveSelectorRefs(
      {
        mode: "named-key",
        namedKeyField: "name",
        namedKeyValue: "{HeroName}-{{trigger.suffix}}",
      },
      { suffix: "v2" },
      variables,
    )
    expect(out.namedKeyValue).toBe("knight-v2")
  })
})
