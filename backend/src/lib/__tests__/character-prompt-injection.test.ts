import { describe, it, expect } from "vitest"
import { buildPortraitPrompt } from "../character-prompts.js"

describe("buildPortraitPrompt person/wardrobe injection", () => {
  it("appends derived person + wardrobe hints into the seed clause", () => {
    const out = buildPortraitPrompt({
      seedPrompt: "cinematic headshot",
      person: { frame: "frame-slim" },         // real bare id from person.ts (Frame: Slim)
      wardrobe: { archetype: "wd-formal" },
    })
    expect(out).toContain("cinematic headshot")
    expect(out.toLowerCase()).toContain("formal")   // from buildWardrobeHints("wd-formal")
  })
})
