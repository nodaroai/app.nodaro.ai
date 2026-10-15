// @test-watches backend/src/routes/workflow-templates.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { templateSlugCandidate, RESERVED_TEMPLATE_SLUGS } from "../template-slug.js"

describe("templateSlugCandidate", () => {
  it("attempt 0 with a requested slug is that slug, exactly", () => {
    expect(templateSlugCandidate("ugc-website-video", "Anything", 0)).toBe("ugc-website-video")
  })

  it("honours the full 50 characters the publish body allows", () => {
    const fifty = "a".repeat(50)
    expect(templateSlugCandidate(fifty, "Name", 0)).toBe(fifty)
  })

  it("does not leave a trailing dash", () => {
    expect(templateSlugCandidate("a".repeat(49) + "!b", "Name", 0)).toBe("a".repeat(49))
  })

  it("a later attempt is the requested slug plus a random suffix", () => {
    expect(templateSlugCandidate("ugc-website-video", "Anything", 1)).toMatch(/^ugc-website-video-[a-z0-9]{1,6}$/)
  })

  it("no requested slug is the name plus a suffix, on every attempt", () => {
    for (const attempt of [0, 1, 2]) {
      expect(templateSlugCandidate(undefined, "My Template", attempt)).toMatch(/^my-template-[a-z0-9]{1,6}$/)
    }
  })

  it("a requested slug with nothing usable in it falls back to the name", () => {
    expect(templateSlugCandidate("!!!", "My Template", 0)).toMatch(/^my-template-[a-z0-9]{1,6}$/)
  })

  it("a reserved slug is suffixed even on the first attempt", () => {
    expect(templateSlugCandidate("browse", "X", 0)).toMatch(/^browse-[a-z0-9]{1,6}$/)
  })
})

describe("RESERVED_TEMPLATE_SLUGS", () => {
  it("names every static /v1/templates/<word> route the template routes register", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../routes/workflow-templates.ts", import.meta.url)),
      "utf8",
    )
    const statics = new Set<string>()
    for (const m of src.matchAll(/app\.(?:get|post|patch|put|delete)\(\s*"\/v1\/templates\/([a-z][a-z-]*)"/g)) {
      statics.add(m[1])
    }
    expect(statics.size).toBeGreaterThan(0)
    for (const word of statics) expect(RESERVED_TEMPLATE_SLUGS.has(word), word).toBe(true)
  })
})
