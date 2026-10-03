import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { OBJECT_ASSET_PRESETS } from "@nodaro/prompts"
import { translate } from "@/lib/i18n"
import { hasPresetLabel, presetLabel } from "../preset-labels"

/**
 * Every studio's quick-preset id ("front", "fighting stance", "rotate-360") is
 * persisted as the asset's name and sent to the generator, so the id is data
 * and the chip shows a separate caption. A new id added to a `*_PRESETS`
 * array without a caption would render its English id on every language's
 * chip row — this scan fails the build instead.
 */
const EDITOR = path.resolve(__dirname, "../..")
const STUDIO_DIRS = ["character-studio", "creature-studio", "location-studio", "object-studio"]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p)
  }
  return out
}

function presetIds(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  // Object Studio's chips come from the shared prompt package, not a local array.
  for (const [kind, ids] of Object.entries(OBJECT_ASSET_PRESETS)) found.set(`@nodaro/prompts:${kind}`, [...ids])
  for (const dir of STUDIO_DIRS) {
    for (const file of walk(path.join(EDITOR, dir))) {
      const src = fs.readFileSync(file, "utf8")
      for (const m of src.matchAll(/const [A-Z_]*PRESETS[A-Z_]*\s*=\s*\[([^\]]*)\]/g)) {
        const ids = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
        if (ids.length) found.set(path.relative(EDITOR, file) + ":" + m.index, ids)
      }
    }
  }
  return found
}

describe("studio preset chip captions", () => {
  it("every *_PRESETS id in the four studios has a caption", () => {
    const arrays = presetIds()
    const ids = [...new Set([...arrays.values()].flat())]
    // Floor so a reshaped array declaration fails loudly instead of matching nothing.
    expect(ids.length).toBeGreaterThan(80)
    const missing = ids.filter((id) => !hasPresetLabel(id))
    expect(missing, `preset ids with no studioPreset.* caption:\n${missing.join("\n")}`).toEqual([])
  })

  it("captions are real Hebrew and never fall back to the id", () => {
    const ids = [...new Set([...presetIds().values()].flat())]
    const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("he", key, vars)
    const english = ids.filter((id) => !/[֐-׿]/.test(presetLabel(t, id)))
    expect(english, `Hebrew captions without Hebrew letters:\n${english.join("\n")}`).toEqual([])
  })

  it("an unknown id renders verbatim rather than blank", () => {
    const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
    expect(presetLabel(t, "some-new-preset")).toBe("some-new-preset")
  })

  it("English captions are the ids themselves — the English chip row is unchanged", () => {
    const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
    const ids = [...new Set([...presetIds().values()].flat())]
    const changed = ids.filter((id) => presetLabel(t, id) !== id)
    expect(changed, `English caption differs from the id:\n${changed.join("\n")}`).toEqual([])
  })
})
