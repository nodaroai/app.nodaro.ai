import { describe, it, expect } from "vitest"
import { STYLING_DIMENSION_ORDER } from "@nodaro/prompts"
import { STYLING_TOPICS } from "../styling-topics"
import { characterSectionIconUrl } from "../../icons/character-art"

describe("STYLING_TOPICS", () => {
  it("lists every styling dimension exactly once", () => {
    const listed = STYLING_TOPICS.flatMap((t) => t.dimensions)
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual([...STYLING_DIMENSION_ORDER].sort())
  })

  it("gives every topic its round icon", () => {
    expect(STYLING_TOPICS.filter((t) => characterSectionIconUrl(t.label) === undefined).map((t) => t.label)).toEqual([])
  })
})
