import { describe, it, expect } from "vitest"
import { tagPromptProvenance } from "../prompt-provenance"

const join = (segs: { text: string }[]) => segs.map((s) => s.text).join("")

describe("tagPromptProvenance", () => {
  it("returns one user segment when nothing matches (join === input)", () => {
    expect(tagPromptProvenance("a red car", [])).toEqual([{ text: "a red car", origin: "user" }])
  })

  it("tags a located fragment and leaves the rest user", () => {
    const segs = tagPromptProvenance("a red car, cinematic", [{ text: "cinematic", origin: "picker" }])
    expect(segs).toEqual([
      { text: "a red car, ", origin: "user" },
      { text: "cinematic", origin: "picker" },
    ])
    expect(join(segs)).toBe("a red car, cinematic")
  })

  it("precedence: earlier fragment wins; inner overlap is not double-tagged", () => {
    const text = "Use this reference: Kira. A red car"
    const segs = tagPromptProvenance(text, [
      { text: "Use this reference: Kira.", origin: "mention" },
      { text: "Kira", origin: "variable" },
    ])
    expect(segs.find((s) => s.origin === "variable")).toBeUndefined()
    expect(join(segs)).toBe(text)
  })

  it("tags every occurrence of a fragment", () => {
    const segs = tagPromptProvenance("foo bar foo", [{ text: "foo", origin: "snippet" }])
    expect(segs.filter((s) => s.origin === "snippet")).toHaveLength(2)
    expect(join(segs)).toBe("foo bar foo")
  })

  it("empty input → empty segments", () => {
    expect(tagPromptProvenance("", [{ text: "x", origin: "variable" }])).toEqual([])
  })
})
