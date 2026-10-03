import { describe, expect, it } from "vitest"
import { SAVED_POST_MAX_TAGS, SAVED_POST_TAG_MAX, normalizeSavedPostTags } from "../index.js"

describe("normalizeSavedPostTags", () => {
  it("trims, lower-cases, drops a leading # and collapses inner spaces", () => {
    expect(normalizeSavedPostTags(["  #Hooks ", "Cold   Open"])).toEqual(["hooks", "cold open"])
  })

  it("drops empty tags, repeats and anything that is not text", () => {
    expect(normalizeSavedPostTags(["a", "A", "#a", "", "   ", 7, null, "b"])).toEqual(["a", "b"])
  })

  it("caps each tag and the number of tags", () => {
    const many = Array.from({ length: SAVED_POST_MAX_TAGS + 5 }, (_, i) => `tag${i}`)
    expect(normalizeSavedPostTags(many)).toHaveLength(SAVED_POST_MAX_TAGS)
    expect(normalizeSavedPostTags(["x".repeat(100)])[0]).toHaveLength(SAVED_POST_TAG_MAX)
  })

  it("reads anything that is not a list as no tags", () => {
    expect(normalizeSavedPostTags("hooks")).toEqual([])
    expect(normalizeSavedPostTags(undefined)).toEqual([])
  })

  it("keeps tags in other scripts", () => {
    expect(normalizeSavedPostTags(["#פתיחה", "フック"])).toEqual(["פתיחה", "フック"])
  })

  it("splits on commas in any script, so one typed line can hold several tags", () => {
    expect(normalizeSavedPostTags(["hooks, openers"])).toEqual(["hooks", "openers"])
    expect(normalizeSavedPostTags(["フック、書き出し"])).toEqual(["フック", "書き出し"])
    expect(normalizeSavedPostTags(["훅，오프닝"])).toEqual(["훅", "오프닝"])
  })

  it("removes the characters that would change a tag filter's meaning", () => {
    expect(normalizeSavedPostTags(['ho}o{ks', 'say "hi"', "back\\slash"])).toEqual(["hooks", "say hi", "backslash"])
  })
})
