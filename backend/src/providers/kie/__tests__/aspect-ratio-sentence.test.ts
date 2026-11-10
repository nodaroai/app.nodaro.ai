import { describe, expect, it } from "vitest"

import {
  aspectRatioRefusalSentence,
  aspectRatioWordsOf,
  limitRatio,
  pictureShapeSentence,
  plainRatio,
  ratioList,
  refusedAspectRatioSentence,
  requestedAspectRatioOf,
} from "../aspect-ratio-sentence.js"

describe("plainRatio: only a ratio as a person picks it is quoted", () => {
  it.each([
    ["3:2", "3:2"],
    [" 16:9 ", "16:9"],
    ["21:9", "21:9"],
  ])("%j is %j", (value, ratio) => {
    expect(plainRatio(value)).toBe(ratio)
  })

  it.each([["landscape_16_9"], ["1536x1024"], ["auto"], ["adaptive"], ["16:9:1"], ["0:9"], [""], [3], [null], [undefined]])(
    "%j is no plain ratio",
    (value) => {
      expect(plainRatio(value)).toBeNull()
    },
  )
})

describe("requestedAspectRatioOf: the ratio a request asked the model for", () => {
  it("reads aspect_ratio, then aspectRatio", () => {
    expect(requestedAspectRatioOf({ aspect_ratio: "3:2" })).toBe("3:2")
    expect(requestedAspectRatioOf({ aspectRatio: "21:9" })).toBe("21:9")
    expect(requestedAspectRatioOf({ aspect_ratio: "4:5", aspectRatio: "21:9" })).toBe("4:5")
  })

  it("a request in hand with no ratio as a person picks it is null", () => {
    expect(requestedAspectRatioOf({ aspect_ratio: "landscape_16_9" })).toBeNull()
    expect(requestedAspectRatioOf({ aspect_ratio: "adaptive" })).toBeNull()
    expect(requestedAspectRatioOf({ image_size: "16:9" })).toBeNull()
    expect(requestedAspectRatioOf({})).toBeNull()
  })

  it("no request in hand is undefined", () => {
    expect(requestedAspectRatioOf(undefined)).toBeUndefined()
    expect(requestedAspectRatioOf(null)).toBeUndefined()
  })
})

describe("aspectRatioWordsOf: what the provider's words say about the ratio", () => {
  it.each([
    // the wordings on record
    ["aspect_ratio must be one of 16:9, 9:16", ["16:9", "9:16"], null],
    ["Aspect ratio only supports [16:9, 9:16]", ["16:9", "9:16"], null],
    ["Invalid aspect_ratio value: 3:2", null, "3:2"],
    ["Invalid aspect ratio setting", null, null],
    // the sent ratio, named before the list, after it, or after its own cue
    ["aspect_ratio 3:2 is not supported, must be one of 16:9, 9:16", ["16:9", "9:16"], "3:2"],
    ["aspect_ratio must be one of 16:9, 9:16, got 3:2", ["16:9", "9:16"], "3:2"],
    ["aspect_ratio must be one of 16:9, 9:16 (value: 3:2)", ["16:9", "9:16"], "3:2"],
    ["Input should be 16:9 or 9:16 [aspect_ratio=3:2]", ["16:9", "9:16"], "3:2"],
    // a list ends at the first other word
    ["must be 16:9 or 9:16 at 1080p; 1:1 is only available at 720p", ["16:9", "9:16"], null],
    // a status in a wrapper around the words is no list
    ["Runway failed: [400] Invalid aspect ratio 4:3", null, "4:3"],
    // a bound with decimals, or a clock time, names no ratio a person picks
    ["image aspect ratio must be between 1:2.5 and 2.5:1", null, null],
    ["Generation failed at 12:30:45: invalid aspect ratio", null, null],
  ])("%j", (words, accepted, sent) => {
    expect(aspectRatioWordsOf(words)).toEqual({ accepted, sent, range: null })
  })

  it.each([
    ["image aspect ratio must be between 1:4 and 4:1", "1:4", "4:1"],
    ["aspect_ratio should be between 2:5 and 5:2", "2:5", "5:2"],
    ["the input's aspect ratio must be from 1:3 to 3:1", "1:3", "3:1"],
  ])("a range is a range, never a list: %j", (words, low, high) => {
    expect(aspectRatioWordsOf(words)).toEqual({ accepted: null, sent: null, range: { low, high } })
  })

  it("a sentence that ends on the list keeps its last ratio", () => {
    expect(aspectRatioWordsOf("aspect_ratio must be one of 16:9, 9:16.").accepted).toEqual(["16:9", "9:16"])
  })
})

describe("ratioList: ratios as a sentence reads them", () => {
  it.each([
    [["16:9"], "16:9"],
    [["16:9", "9:16"], "16:9 and 9:16"],
    [["1:1", "16:9", "9:16"], "1:1, 16:9 and 9:16"],
  ])("%j", (ratios, text) => {
    expect(ratioList(ratios)).toBe(text)
  })
})

describe("refusedAspectRatioSentence: a ratio the model does not take", () => {
  it("names the chosen ratio and the ones the model takes", () => {
    expect(refusedAspectRatioSentence("3:2", ["16:9", "9:16"])).toBe(
      "This model doesn't take 3:2. It takes 16:9 and 9:16. Pick one of them and run again.",
    )
  })

  it("names the chosen ratio when the model gave no list", () => {
    expect(refusedAspectRatioSentence("3:2", null)).toBe("This model doesn't take 3:2. Pick another aspect ratio and run again.")
  })

  it("says the chosen aspect ratio when the ratio itself is not known", () => {
    expect(refusedAspectRatioSentence(null, ["16:9", "9:16"])).toBe(
      "This model doesn't take the chosen aspect ratio. It takes 16:9 and 9:16. Pick one of them and run again.",
    )
    expect(refusedAspectRatioSentence(null, null)).toBe(
      "This model doesn't take the chosen aspect ratio. Pick another aspect ratio and run again.",
    )
  })

  it("a chosen ratio the model's own list names: neither the ratio nor the list is quoted", () => {
    expect(refusedAspectRatioSentence("16:9", ["16:9", "9:16"])).toBe(
      "This model doesn't take the chosen aspect ratio. Pick another aspect ratio and run again.",
    )
  })

  it("a single ratio the model takes is picked, not one of them", () => {
    expect(refusedAspectRatioSentence("3:2", ["16:9"])).toBe("This model doesn't take 3:2. It takes 16:9. Pick it and run again.")
  })
})

describe("aspectRatioRefusalSentence: the provider's words and the request, together", () => {
  it("the request's ratio wins over the one the words name", () => {
    expect(aspectRatioRefusalSentence("Invalid aspect_ratio value: 4:3", "3:2")).toBe(
      "This model doesn't take 3:2. Pick another aspect ratio and run again.",
    )
  })

  it("with no request in hand, the ratio the words say was sent", () => {
    expect(aspectRatioRefusalSentence("Invalid aspect_ratio value: 3:2", undefined)).toBe(
      "This model doesn't take 3:2. Pick another aspect ratio and run again.",
    )
  })

  it("a request in hand with no ratio a person picks: no ratio from the words is quoted", () => {
    expect(aspectRatioRefusalSentence("aspect ratio 21:9 of the input image is not supported", null)).toBe(
      "This model doesn't take the chosen aspect ratio. Pick another aspect ratio and run again.",
    )
  })

  it("a range with the chosen ratio inside it is the picture's shape", () => {
    expect(aspectRatioRefusalSentence("image aspect ratio must be between 1:4 and 4:1", "16:9")).toBe(
      "This picture's shape doesn't fit this model. It takes pictures between 1:4 and 4:1. Crop it and run again.",
    )
    expect(aspectRatioRefusalSentence("aspect_ratio should be between 2:5 and 5:2", undefined)).toBe(
      "This picture's shape doesn't fit this model. It takes pictures between 2:5 and 5:2. Crop it and run again.",
    )
  })

  it("a range the chosen ratio falls outside is the ratio", () => {
    expect(aspectRatioRefusalSentence("aspect_ratio must be between 1:4 and 4:1", "8:1")).toBe(
      "This model doesn't take 8:1. Pick another aspect ratio and run again.",
    )
  })
})

describe("limitRatio: a picture-shape limit as a ratio", () => {
  it.each([
    [0.4, "2:5"],
    [2.5, "5:2"],
    [2 / 5, "2:5"],
    [5 / 2, "5:2"],
    [0.125, "1:8"],
    [8, "8:1"],
    [1, "1:1"],
    [3 / 7, "3:7"],
  ])("%d is %j", (x, ratio) => {
    expect(limitRatio(x)).toBe(ratio)
  })

  it.each([[Math.PI], [0], [-1], [Infinity], [Number.NaN]])("%d has no ratio to name", (x) => {
    expect(limitRatio(x)).toBeNull()
  })
})

describe("pictureShapeSentence: a picture too wide or too tall for the model", () => {
  it("too wide, with the range the model takes", () => {
    expect(pictureShapeSentence(2400, 600, 0.4, 2.5)).toBe(
      "This picture is too wide for this model (2400×600). It takes pictures between 2:5 and 5:2. Crop it and run again.",
    )
    expect(pictureShapeSentence(1000, 100, 0.125, 8)).toBe(
      "This picture is too wide for this model (1000×100). It takes pictures between 1:8 and 8:1. Crop it and run again.",
    )
  })

  it("too tall", () => {
    expect(pictureShapeSentence(600, 2400, 0.4, 2.5)).toBe(
      "This picture is too tall for this model (600×2400). It takes pictures between 2:5 and 5:2. Crop it and run again.",
    )
  })

  it("leaves the range out when a side has no limit, or no ratio names it", () => {
    expect(pictureShapeSentence(2400, 600, 0, 2.5)).toBe("This picture is too wide for this model (2400×600). Crop it and run again.")
    expect(pictureShapeSentence(100, 2400, 0.4, Infinity)).toBe("This picture is too tall for this model (100×2400). Crop it and run again.")
    expect(pictureShapeSentence(2400, 600, 0.4, Math.PI)).toBe("This picture is too wide for this model (2400×600). Crop it and run again.")
  })
})
