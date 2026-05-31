import { describe, it, expect } from "vitest"
import type { InfiniteData } from "@tanstack/react-query"
import {
  patchInfiniteItems,
  removeInfiniteItems,
} from "@/lib/optimistic-cache"

interface Item {
  id: string
  isFavorite: boolean
}
interface Page {
  data: Item[]
  nextCursor: string | null
}

function makeData(): InfiniteData<Page> {
  return {
    pages: [
      {
        data: [
          { id: "a", isFavorite: false },
          { id: "b", isFavorite: true },
        ],
        nextCursor: "cur1",
      },
      {
        data: [
          { id: "c", isFavorite: false },
          { id: "d", isFavorite: false },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [undefined, "cur1"],
  }
}

describe("patchInfiniteItems", () => {
  it("updates the matching item on whichever page it lives", () => {
    const data = makeData()
    const next = patchInfiniteItems<"data", Item, Page>(
      data,
      "data",
      (i) => i.id === "c",
      (i) => ({ ...i, isFavorite: true }),
    )!
    expect(next.pages[1].data[0].isFavorite).toBe(true)
    // every other item untouched
    expect(next.pages[0].data[0].isFavorite).toBe(false)
    expect(next.pages[1].data[1].isFavorite).toBe(false)
  })

  it("does not mutate the original data (enables rollback)", () => {
    const data = makeData()
    const next = patchInfiniteItems<"data", Item, Page>(
      data,
      "data",
      (i) => i.id === "a",
      (i) => ({ ...i, isFavorite: true }),
    )!
    expect(next).not.toBe(data)
    expect(next.pages).not.toBe(data.pages)
    expect(next.pages[0]).not.toBe(data.pages[0])
    // original snapshot intact
    expect(data.pages[0].data[0].isFavorite).toBe(false)
    // pageParams reference preserved
    expect(next.pageParams).toBe(data.pageParams)
  })

  it("returns undefined unchanged", () => {
    expect(
      patchInfiniteItems<"data", Item, Page>(
        undefined,
        "data",
        () => true,
        (i) => i,
      ),
    ).toBeUndefined()
  })
})

describe("removeInfiniteItems", () => {
  it("removes the matching item and preserves page structure", () => {
    const data = makeData()
    const next = removeInfiniteItems<"data", Item, Page>(
      data,
      "data",
      (i) => i.id === "b",
    )!
    expect(next.pages[0].data.map((i) => i.id)).toEqual(["a"])
    expect(next.pages[1].data.map((i) => i.id)).toEqual(["c", "d"])
    expect(next.pages[0].nextCursor).toBe("cur1")
  })

  it("does not mutate the original data", () => {
    const data = makeData()
    removeInfiniteItems<"data", Item, Page>(data, "data", (i) => i.id === "a")
    expect(data.pages[0].data.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("returns undefined unchanged", () => {
    expect(
      removeInfiniteItems<"data", Item, Page>(undefined, "data", () => true),
    ).toBeUndefined()
  })
})
