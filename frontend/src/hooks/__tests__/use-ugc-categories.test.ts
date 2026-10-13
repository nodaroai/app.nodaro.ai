import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ ugcCategoriesApi: vi.fn() }))

import { readUgcCategories } from "../use-ugc-categories"

describe("the product categories UGC Creator's panel offers", () => {
  it("are the route's ids and labels, in its order", () => {
    expect(readUgcCategories({ categories: [{ id: "beauty", label: "Beauty" }, { id: "tech", label: "Tech" }] })).toEqual([
      { id: "beauty", label: "Beauty" },
      { id: "tech", label: "Tech" },
    ])
  })

  it("read untrusted: an entry with no id is dropped, one with no label shows its id, a repeat is shown once", () => {
    const raw = { categories: [{ id: "" }, { label: "No id" }, "beauty", null, { id: "tech" }, { id: "tech", label: "Again" }, { id: "home", label: 3 }] }
    expect(readUgcCategories(raw)).toEqual([
      { id: "tech", label: "tech" },
      { id: "home", label: "home" },
    ])
  })

  it("nothing usable (no answer yet, the route absent, another shape) is an empty list", () => {
    expect(readUgcCategories(undefined)).toEqual([])
    expect(readUgcCategories({})).toEqual([])
    expect(readUgcCategories({ categories: "beauty" })).toEqual([])
  })
})
