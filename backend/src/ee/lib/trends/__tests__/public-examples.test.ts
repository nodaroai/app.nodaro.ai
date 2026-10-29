import { describe, expect, it } from "vitest"
import { TrendRunError } from "../compose.js"
import { listedExamples, publicExampleOf, shownOriginal, storedExampleRequest } from "../public-examples.js"
import type { TrendExample, TrendVersionData } from "../types.js"

const ex = (n: number): TrendExample => ({ videoUrl: `https://cdn.example/ex${n}.mp4`, width: 720, height: 1280, durationSec: 12, slots: {}, sourceJobId: `j${n}` })
const DISPLAY = { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 720, height: 1280, durationSec: 12 }
const data = (hideOriginal: boolean | undefined, n: number): TrendVersionData =>
  ({
    name: { en: "T" },
    source: { videoUrl: "https://cdn.example/src.mp4", durationSec: 12, display: DISPLAY },
    previewStart: null,
    slots: [],
    references: [],
    examples: Array.from({ length: n }, (_, i) => ex(i + 1)),
    ...(hideOriginal === undefined ? {} : { hideOriginal }),
  }) as TrendVersionData

const outOfRange = (fn: () => unknown, example: number) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TrendRunError)
    expect((e as TrendRunError).code).toBe("example_out_of_range")
    expect((e as TrendRunError).message).toBe(`This trend has no example ${example}.`)
    return
  }
  throw new Error("not refused")
}

describe("the public numbering of a trend's examples", () => {
  it("a trend that shows its original: the display copy, every example, the stored numbers as given", () => {
    for (const hide of [undefined, false]) {
      const d = data(hide, 3)
      expect(shownOriginal(d)).toBe(DISPLAY)
      expect(listedExamples(d)).toEqual(d.examples)
      expect([undefined, 1, 2, 3, 4].map((n) => storedExampleRequest(d, n))).toEqual([undefined, 1, 2, 3, 4])
      expect([0, 1, 2, 3].map((k) => publicExampleOf(k, false))).toEqual([0, 1, 2, 3])
    }
  })

  it("a trend that hides it: Example 1 is the original, the list starts at Example 2", () => {
    const d = data(true, 3)
    expect(shownOriginal(d)).toBe(d.examples[0])
    expect(listedExamples(d)).toEqual([ex(2), ex(3)])
    expect(shownOriginal(data(true, 0))).toBeUndefined()
  })

  it("a request: n → n + 1, none → stored 1, checked against the listed count", () => {
    const d = data(true, 3)
    expect(storedExampleRequest(d, undefined)).toBe(1)
    expect(storedExampleRequest(d, 1)).toBe(2)
    expect(storedExampleRequest(d, 2)).toBe(3)
    outOfRange(() => storedExampleRequest(d, 3), 3)
    outOfRange(() => storedExampleRequest(d, 0), 0)
    // One example, shown as the original: none listed.
    expect(storedExampleRequest(data(true, 1), undefined)).toBe(1)
    outOfRange(() => storedExampleRequest(data(true, 1), 1), 1)
    // No example at all (cannot publish so): no example, as on any trend with none.
    expect(storedExampleRequest(data(true, 0), undefined)).toBeUndefined()
  })

  it("a read back: stored k → k − 1, stored 1 (the original) → none, 0 stays 0", () => {
    expect([0, 1, 2, 3].map((k) => publicExampleOf(k, true))).toEqual([0, undefined, 1, 2])
  })
})
