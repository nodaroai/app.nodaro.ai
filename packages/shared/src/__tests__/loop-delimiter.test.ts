import { describe, it, expect } from "vitest"
import { splitByLoopDelimiter, NO_SPLIT_DELIMITER } from "../loop-delimiter.js"

describe("splitByLoopDelimiter", () => {
  it("defaults to newline when no columns supplied", () => {
    expect(splitByLoopDelimiter("a\nb\nc", undefined)).toEqual(["a", "b", "c"])
  })

  it("defaults to newline when first text column has no splitDelimiter", () => {
    expect(splitByLoopDelimiter("a\nb", [{ type: "text" }])).toEqual(["a", "b"])
  })

  it("splits by the configured delimiter", () => {
    expect(
      splitByLoopDelimiter("a,b,c", [{ type: "text", splitDelimiter: "," }]),
    ).toEqual(["a", "b", "c"])
  })

  it("returns the input as a single item when delimiter is the no-split sentinel", () => {
    expect(
      splitByLoopDelimiter("a\nb\nc", [{ type: "text", splitDelimiter: NO_SPLIT_DELIMITER }]),
    ).toEqual(["a\nb\nc"])
  })

  it("returns empty array when no-split is selected and input is whitespace", () => {
    expect(
      splitByLoopDelimiter("   \n   ", [{ type: "text", splitDelimiter: NO_SPLIT_DELIMITER }]),
    ).toEqual([])
  })

  it("ignores non-text columns when picking the splitDelimiter", () => {
    expect(
      splitByLoopDelimiter("a;b", [
        { type: "image", splitDelimiter: "," },
        { type: "text", splitDelimiter: ";" },
      ]),
    ).toEqual(["a", "b"])
  })
})
