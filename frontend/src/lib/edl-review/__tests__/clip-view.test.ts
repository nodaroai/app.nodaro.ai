import { describe, expect, it } from "vitest"
import { clipFilterCounts, filterClipCards } from "../clip-view"
import type { ClipCard } from "../build-clip-cards"

const card = (row: number, keep: boolean) => ({ row, keep }) as ClipCard
const CARDS = [card(0, true), card(1, false), card(2, true), card(3, false), card(4, false)]

describe("the Clip Pack grid's filter (R15 a)", () => {
  it("All shows every card in plan order, Kept the kept ones, Dropped the dropped", () => {
    expect(filterClipCards(CARDS, "all").map((c) => c.row)).toEqual([0, 1, 2, 3, 4])
    expect(filterClipCards(CARDS, "kept").map((c) => c.row)).toEqual([0, 2])
    expect(filterClipCards(CARDS, "dropped").map((c) => c.row)).toEqual([1, 3, 4])
  })

  it("counts what each filter shows", () => {
    expect(clipFilterCounts(CARDS)).toEqual({ all: 5, kept: 2, dropped: 3 })
    expect(clipFilterCounts([])).toEqual({ all: 0, kept: 0, dropped: 0 })
  })
})
