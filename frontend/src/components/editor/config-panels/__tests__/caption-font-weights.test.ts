import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CAPTION_LEVER_BOUNDS } from "@nodaro/shared/captions"
import { CAPTION_FONT_WEIGHTS } from "../processing-configs"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"

/**
 * The Font weight select offered 400–900 while the route, the render plan, the
 * MCP tool and the public doc all say 100–900 in 100s: a node authored with
 * `fontWeight: 300` opened with an EMPTY trigger (no SelectItem matches the
 * value) — a lever that is rendering and the panel cannot name — and a canvas
 * user following the doc could not pick the light weights at all. The list is
 * DERIVED from the shared bounds so it cannot drift from them again.
 */
describe("the Font weight options cover the whole wire range", () => {
  it("is every 100 step from the shared floor to the shared ceiling", () => {
    const { min, max } = CAPTION_LEVER_BOUNDS.fontWeight
    const expected: number[] = []
    for (let w = min; w <= max; w += 100) expected.push(w)
    expect([...CAPTION_FONT_WEIGHTS]).toEqual(expected)
    expect(CAPTION_FONT_WEIGHTS).toContain(100)
    expect(CAPTION_FONT_WEIGHTS).toContain(300)
  })

  // Each option renders `proccfg.fontWeight<N>`; a weight with no key shows the
  // raw key string in the menu.
  it("every weight has a label in every locale that ships the family", () => {
    for (const dict of [en, he] as ReadonlyArray<Record<string, string>>) {
      // Only the locales that translate this family at all — a partial dict
      // without the 400 label is not expected to carry 100 either.
      if (!dict["proccfg.fontWeight400"]) continue
      for (const w of CAPTION_FONT_WEIGHTS) {
        expect(dict[`proccfg.fontWeight${w}`], `proccfg.fontWeight${w}`).toBeTruthy()
      }
    }
  })

  // Structural: the menu must map over the derived list. A re-hardcoded array
  // in the JSX is exactly how the range narrowed the first time.
  it("the select renders the derived list, not a hand-written one", () => {
    const source = readFileSync(join(__dirname, "..", "processing-configs.tsx"), "utf8")
    expect(source).toMatch(/CAPTION_FONT_WEIGHTS\.map\(/)
    expect(source).not.toMatch(/\[\s*400,\s*500,\s*600,\s*700,\s*800,\s*900\s*\]/)
  })
})
