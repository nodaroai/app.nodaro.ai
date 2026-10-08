import { describe, it, expect } from "vitest"
import { tidyReferenceTokenGaps, unboundReferenceTokenText } from "../unbound-reference-tokens.js"
import { resolveReferenceTokens } from "../video-reference-resolver.js"

describe("unboundReferenceTokenText — what a token with no reference at its slot renders to", () => {
  it("a labelled token becomes its label, verbatim", () => {
    expect(unboundReferenceTokenText("person")).toBe("person")
    expect(unboundReferenceTokenText("clothes and shoes")).toBe("clothes and shoes")
  })

  it("an unlabelled token renders to nothing", () => {
    expect(unboundReferenceTokenText(undefined)).toBe("")
  })
})

describe("tidyReferenceTokenGaps — the gap a dropped token leaves", () => {
  it("collapses a run of horizontal whitespace to one space and trims", () => {
    expect(tidyReferenceTokenGaps("walk past  slowly ")).toBe("walk past slowly")
    expect(tidyReferenceTokenGaps(" \tlead")).toBe("lead")
  })

  it("keeps newline structure", () => {
    expect(tidyReferenceTokenGaps("a  b\n\nc  d\ne")).toBe("a b\n\nc d\ne")
  })
})

describe("resolveReferenceTokens renders an out-of-range token through the shared helpers", () => {
  const counts = { image: 1, video: 0, audio: 0 }
  it("labelled → label, unlabelled → dropped, gap collapsed", () => {
    expect(resolveReferenceTokens("a {image:2:dog}  and {video:1} run", counts)).toBe("a dog and run")
  })
})
