import { describe, it, expect } from "vitest"
import { sortListItems } from "../list-sort.js"

describe("sortListItems — direction and basic types", () => {
  it("sorts text ascending by default (whole item, case-insensitive)", () => {
    expect(sortListItems(["banana", "Apple", "cherry"], {
      field: "", sortType: "text", direction: "asc",
    })).toEqual(["Apple", "banana", "cherry"])
  })

  it("sorts text descending", () => {
    expect(sortListItems(["banana", "apple", "cherry"], {
      field: "", sortType: "text", direction: "desc",
    })).toEqual(["cherry", "banana", "apple"])
  })

  it("sorts numbers numerically (not alphabetically)", () => {
    expect(sortListItems(["10", "9", "2", "100"], {
      field: "", sortType: "number", direction: "asc",
    })).toEqual(["2", "9", "10", "100"])
  })

  it("sorts ISO dates chronologically", () => {
    expect(sortListItems(
      ["2024-03-02T00:00:00Z", "2024-01-01T00:00:00Z", "2024-02-15T00:00:00Z"],
      { field: "", sortType: "date", direction: "asc" },
    )).toEqual([
      "2024-01-01T00:00:00Z",
      "2024-02-15T00:00:00Z",
      "2024-03-02T00:00:00Z",
    ])
  })
})

describe("sortListItems — auto detection", () => {
  it("auto-detects numeric strings and sorts them numerically", () => {
    expect(sortListItems(["10", "9", "2"], {
      field: "", sortType: "auto", direction: "asc",
    })).toEqual(["2", "9", "10"])
  })

  it("auto-detects ISO date strings", () => {
    expect(sortListItems(
      ["2024-03-02", "2024-01-01"],
      { field: "", sortType: "auto", direction: "asc" },
    )).toEqual(["2024-01-01", "2024-03-02"])
  })

  it("auto falls back to text when values aren't number or date", () => {
    expect(sortListItems(["banana", "Apple", "cherry"], {
      field: "", sortType: "auto", direction: "asc",
    })).toEqual(["Apple", "banana", "cherry"])
  })
})

describe("sortListItems — natural numeric-aware text", () => {
  it("sorts file2 before file10 under Text mode via Intl numeric", () => {
    expect(sortListItems(["file10", "file2", "file1"], {
      field: "", sortType: "text", direction: "asc",
    })).toEqual(["file1", "file2", "file10"])
  })
})

describe("sortListItems — missing / invalid always last", () => {
  it("keeps null/empty at the end in ascending order", () => {
    expect(sortListItems(["", "2", "1", ""], {
      field: "", sortType: "number", direction: "asc",
    })).toEqual(["1", "2", "", ""])
  })

  it("keeps null/empty at the end in descending order", () => {
    expect(sortListItems(["", "2", "1", ""], {
      field: "", sortType: "number", direction: "desc",
    })).toEqual(["2", "1", "", ""])
  })

  it("buckets unparseable Number strings as invalid (last)", () => {
    expect(sortListItems(["abc", "3", "1"], {
      field: "", sortType: "number", direction: "asc",
    })).toEqual(["1", "3", "abc"])
  })

  it("buckets unparseable Date strings as invalid (last)", () => {
    expect(sortListItems(["not-a-date", "2024-01-01", "2023-01-01"], {
      field: "", sortType: "date", direction: "asc",
    })).toEqual(["2023-01-01", "2024-01-01", "not-a-date"])
  })
})

describe("sortListItems — JSON field extraction", () => {
  it("sorts JSON items by a dot-path field", () => {
    const items = [
      JSON.stringify({ title: "A", score: 5 }),
      JSON.stringify({ title: "B", score: 9 }),
      JSON.stringify({ title: "C", score: 1 }),
    ]
    const result = sortListItems(items, {
      field: "score", sortType: "number", direction: "desc",
    })
    expect(result.map((r) => JSON.parse(r).title)).toEqual(["B", "A", "C"])
  })

  it("buckets items missing the field as invalid (last)", () => {
    const items = [
      JSON.stringify({ id: 1, score: 5 }),
      JSON.stringify({ id: 2 }),
      JSON.stringify({ id: 3, score: 1 }),
    ]
    const result = sortListItems(items, {
      field: "score", sortType: "number", direction: "asc",
    })
    expect(result.map((r) => JSON.parse(r).id)).toEqual([3, 1, 2])
  })
})

describe("sortListItems — stability", () => {
  it("preserves input order for equal keys", () => {
    const items = [
      JSON.stringify({ id: "a", tier: 1 }),
      JSON.stringify({ id: "b", tier: 1 }),
      JSON.stringify({ id: "c", tier: 1 }),
    ]
    const result = sortListItems(items, {
      field: "tier", sortType: "number", direction: "asc",
    })
    expect(result.map((r) => JSON.parse(r).id)).toEqual(["a", "b", "c"])
  })

  it("does not mutate the input array", () => {
    const input = ["c", "a", "b"]
    sortListItems(input, { field: "", sortType: "text", direction: "asc" })
    expect(input).toEqual(["c", "a", "b"])
  })
})
