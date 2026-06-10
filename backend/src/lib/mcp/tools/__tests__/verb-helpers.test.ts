import { describe, it, expect, vi } from "vitest"

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async ({ assetId }: { assetId: string }) =>
    assetId === "known-asset" ? "https://cdn.nodaro.ai/images/known-asset.png" : null,
  ),
}))

const { coerceStringArray, resolveRefArray } = await import("../_verb-helpers.js")

describe("coerceStringArray", () => {
  it("passes a clean array through, trimming and dropping empties", () => {
    expect(coerceStringArray(["  https://a.png ", "", "https://b.png"], 14)).toEqual([
      "https://a.png",
      "https://b.png",
    ])
  })

  it("parses a JSON-stringified array (the MCP client serialization slip)", () => {
    expect(coerceStringArray('["https://a.png","https://b.png"]', 14)).toEqual([
      "https://a.png",
      "https://b.png",
    ])
  })

  it("wraps a lone bare string into a single-element array", () => {
    expect(coerceStringArray("https://a.png", 14)).toEqual(["https://a.png"])
  })

  it("treats an unparseable bracket-string as a single opaque item", () => {
    expect(coerceStringArray("[not json", 14)).toEqual(["[not json"])
  })

  it("filters non-string entries and enforces the cap", () => {
    expect(coerceStringArray(["a", 42, null, "b", "c"], 2)).toEqual(["a", "b"])
  })

  it("returns [] for undefined, empty string, and non-string/array values", () => {
    expect(coerceStringArray(undefined, 14)).toEqual([])
    expect(coerceStringArray("   ", 14)).toEqual([])
    expect(coerceStringArray(42, 14)).toEqual([])
    expect(coerceStringArray({ a: 1 }, 14)).toEqual([])
  })
})

describe("resolveRefArray", () => {
  it("passes URLs through, resolves asset ids, drops unresolvable ids", async () => {
    const out = await resolveRefArray(
      ["https://cdn.nodaro.ai/uploads/x.png", "known-asset", "missing-asset"],
      "u1",
      "image",
      14,
    )
    expect(out).toEqual([
      "https://cdn.nodaro.ai/uploads/x.png",
      "https://cdn.nodaro.ai/images/known-asset.png",
    ])
  })

  it("accepts the JSON-stringified form end-to-end", async () => {
    const out = await resolveRefArray('["https://cdn.nodaro.ai/uploads/x.png"]', "u1", "image", 14)
    expect(out).toEqual(["https://cdn.nodaro.ai/uploads/x.png"])
  })
})
