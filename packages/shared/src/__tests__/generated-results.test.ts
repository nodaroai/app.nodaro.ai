import { spreadJsonArrayIfSingleton } from "../generated-results.js"

describe("spreadJsonArrayIfSingleton", () => {
  it("spreads a single JSON-array string into stringified elements", () => {
    const input = [JSON.stringify([{ a: 1 }, { a: 2 }])]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toEqual(['{"a":1}', '{"a":2}'])
  })

  it("preserves string elements verbatim (no double-stringify)", () => {
    const input = [JSON.stringify(["hello", "world"])]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toEqual(["hello", "world"])
  })

  it("leaves multi-item lists alone", () => {
    const input = [JSON.stringify([1, 2]), JSON.stringify([3, 4])]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toBe(input)
  })

  it("leaves non-JSON single items alone", () => {
    const input = ["just a sentence"]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toBe(input)
  })

  it("leaves JSON objects (non-array) alone", () => {
    const input = [JSON.stringify({ a: 1, b: 2 })]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toBe(input)
  })

  it("leaves an empty JSON array alone", () => {
    const input = ["[]"]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toBe(input)
  })

  it("handles whitespace-padded JSON arrays", () => {
    const input = ["  [1, 2, 3]  "]
    const result = spreadJsonArrayIfSingleton(input)
    expect(result).toEqual(["1", "2", "3"])
  })

  it("leaves empty list alone", () => {
    const result = spreadJsonArrayIfSingleton([])
    expect(result).toEqual([])
  })
})
