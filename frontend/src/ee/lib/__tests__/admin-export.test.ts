import { describe, it, expect } from "vitest"
import { exportPreamble, fetchAllRows, markdownTable, EXPORT_MAX_ROWS } from "../admin-export"

describe("markdownTable", () => {
  it("renders a GFM table with escaped pipes/newlines and — for empty cells", () => {
    const md = markdownTable(
      ["A", "B"],
      [
        ["plain", "with | pipe"],
        ["multi\nline", null],
      ],
    )
    expect(md.split("\n")).toEqual([
      "| A | B |",
      "| --- | --- |",
      "| plain | with \\| pipe |",
      "| multi line | — |",
    ])
  })
})

describe("exportPreamble", () => {
  it("names active filters and skips 'all'/empty ones", () => {
    const md = exportPreamble({
      title: "T",
      description: "D",
      filters: { status: "new", picker: "all", type: "" },
      rowCount: 3,
      total: 3,
    })
    expect(md).toContain("# T")
    expect(md).toContain("filters: status=new")
    expect(md).not.toContain("picker=")
    expect(md).not.toContain("truncated")
  })

  it("flags truncation when the cap trimmed rows", () => {
    const md = exportPreamble({ title: "T", description: "D", filters: {}, rowCount: 10, total: 20 })
    expect(md).toContain("10 of 20 rows")
    expect(md).toContain(`${EXPORT_MAX_ROWS}-row export cap`)
  })
})

describe("fetchAllRows", () => {
  it("pages until total is reached", async () => {
    const pages: Record<number, string[]> = { 0: ["a", "b"], 100: ["c"] }
    const calls: number[] = []
    const { rows, total } = await fetchAllRows(async (offset) => {
      calls.push(offset)
      return { data: pages[offset] ?? [], total: 3 }
    })
    expect(rows).toEqual(["a", "b", "c"])
    expect(total).toBe(3)
    expect(calls).toEqual([0, 100])
  })

  it("stops on an empty page even if total lies", async () => {
    const { rows } = await fetchAllRows(async (offset) => ({
      data: offset === 0 ? ["a"] : [],
      total: 999,
    }))
    expect(rows).toEqual(["a"])
  })
})
