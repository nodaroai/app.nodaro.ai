import { zipMergeLists } from "../list-merge.js"

describe("zipMergeLists", () => {
  it("merges two equal-length object lists element-wise", () => {
    const result = zipMergeLists([
      [JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 })],
      [JSON.stringify({ b: 10 }), JSON.stringify({ b: 20 })],
    ])
    expect(result).toEqual([
      JSON.stringify({ a: 1, b: 10 }),
      JSON.stringify({ a: 2, b: 20 }),
    ])
  })

  it("cycles a single-item list over a longer list (the user's scenario)", () => {
    const result = zipMergeLists([
      [
        JSON.stringify({ name: "a" }),
        JSON.stringify({ name: "b" }),
        JSON.stringify({ name: "c" }),
      ],
      [JSON.stringify({ grade: 23 })],
    ])
    expect(result).toEqual([
      JSON.stringify({ name: "a", grade: 23 }),
      JSON.stringify({ name: "b", grade: 23 }),
      JSON.stringify({ name: "c", grade: 23 }),
    ])
  })

  it("cycles the longer side the other way too (1 x 3)", () => {
    const result = zipMergeLists([
      [JSON.stringify({ grade: 23 })],
      [
        JSON.stringify({ name: "a" }),
        JSON.stringify({ name: "b" }),
        JSON.stringify({ name: "c" }),
      ],
    ])
    expect(result).toEqual([
      JSON.stringify({ grade: 23, name: "a" }),
      JSON.stringify({ grade: 23, name: "b" }),
      JSON.stringify({ grade: 23, name: "c" }),
    ])
  })

  it("wraps with modulo on mismatched non-factor lengths (3 x 2)", () => {
    const result = zipMergeLists([
      [
        JSON.stringify({ x: 1 }),
        JSON.stringify({ x: 2 }),
        JSON.stringify({ x: 3 }),
      ],
      [JSON.stringify({ y: "a" }), JSON.stringify({ y: "b" })],
    ])
    expect(result).toEqual([
      JSON.stringify({ x: 1, y: "a" }),
      JSON.stringify({ x: 2, y: "b" }),
      JSON.stringify({ x: 3, y: "a" }),
    ])
  })

  it("later source overrides earlier on key conflicts", () => {
    const result = zipMergeLists([
      [JSON.stringify({ a: 1, b: 1 })],
      [JSON.stringify({ b: 2 })],
    ])
    expect(result).toEqual([JSON.stringify({ a: 1, b: 2 })])
  })

  it("concatenates non-object items as strings when no side is an object", () => {
    const result = zipMergeLists([
      ["hello ", "hi "],
      ["world", "there"],
    ])
    expect(result).toEqual(["hello world", "hi there"])
  })

  it("spreads object side and ignores non-object side for object keys", () => {
    const result = zipMergeLists([
      [JSON.stringify({ a: 1 })],
      ["raw string"],
    ])
    expect(result).toEqual([JSON.stringify({ a: 1 })])
  })

  it("ignores empty lists but keeps single-non-empty as passthrough", () => {
    const result = zipMergeLists([[], [JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 })]])
    expect(result).toEqual([JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 })])
  })

  it("returns empty when all inputs are empty", () => {
    expect(zipMergeLists([])).toEqual([])
    expect(zipMergeLists([[], []])).toEqual([])
  })
})
