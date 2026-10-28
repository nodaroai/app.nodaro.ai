// @vitest-environment node
// @test-watches frontend/src/components/editor/*-studio/*-studio-modal.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The Keepers shelf button is wired into each studio's header by hand (there
// is no shared header component), so nothing but this scan notices when one of
// the four stops rendering it — an admin would simply find no way to shelve
// that kind from Studio.
const ROOT = join(__dirname, "..", "..")
const STUDIOS = [
  ["character", "character-studio/character-studio-modal.tsx"],
  ["creature", "creature-studio/creature-studio-modal.tsx"],
  ["location", "location-studio/location-studio-modal.tsx"],
  ["object", "object-studio/object-studio-modal.tsx"],
] as const

describe("every entity studio header renders the Keepers shelf button for its kind", () => {
  it.each(STUDIOS)("%s studio", (kind, file) => {
    const src = readFileSync(join(ROOT, file), "utf8")
    expect(src).toContain('from "../studio-shell/keepers-shelf-button"')
    const usage = src.match(/<KeepersShelfButton[\s\S]*?\/>/g) ?? []
    expect(usage, `${file} renders no <KeepersShelfButton />`).toHaveLength(1)
    expect(usage[0]).toContain(`kind="${kind}"`)
    expect(usage[0]).toMatch(/dbId=\{/)
    expect(usage[0]).toMatch(/sourceImageUrl=\{/)
  })
})
