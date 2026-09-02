import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Dropdown option labels ("16:9 (Landscape)", "2K (Standard)", style names)
 * come from RAW-ENGLISH data tables — model-options.ts and the option tables
 * of @nodaro/shared / @nodaro/prompts — not from JSX text, so the raw-English
 * source scan cannot see them. This guard pins the WIRING instead: wherever a
 * config panel maps over one of those tables and renders the row's `.label`
 * as visible text, the label must pass through a localizer (localizeOption /
 * localizeNode / a catalog resolver) or a copy helper. Tables built from
 * t()/tx() keys (the local *_OPTIONS() getters) are localized by construction
 * and are not checked. Whitespace- and newline-tolerant: prettier puts the
 * expression on its own line. (The localizers themselves are covered by
 * lib/i18n/__tests__/option-labels-he.)
 */
const DIR = path.resolve(__dirname, "..")
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** Everything model-options.ts exports (constants and preset getters) is a raw-English table. */
const MODEL_OPTIONS_EXPORTS = new Set(
  [...strip(fs.readFileSync(path.join(DIR, "model-options.ts"), "utf8")).matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]),
)

/** Names a file imports from a raw-table module. */
export function rawTableImports(src: string): Set<string> {
  const names = new Set<string>()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.\/model-options|@nodaro\/shared|@nodaro\/prompts)"/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim()
      if (!name) continue
      if (m[2] === "./model-options" ? MODEL_OPTIONS_EXPORTS.has(name) : /^[A-Z][A-Z0-9_]+$/.test(name)) names.add(name)
    }
  }
  return names
}

/** `{row.label}` rendered raw as a text node (bare or as an element's whole body). */
const rawLabelOf = (v: string) => new RegExp(`(?<=>)\\s*\\{\\s*${v}\\.label\\s*\\}\\s*(?=<)`)

/** Every raw-table `.map((row) => …)` whose body renders `{row.label}` unwrapped. */
export function rawLabelSites(src: string, tables: Set<string> = rawTableImports(src)): string[] {
  const hits: string[] = []
  for (const m of src.matchAll(/\b([A-Za-z_]\w*)(?:\(\))?\.map\(\(\s*(\w+)\b[^)]*\)\s*=>/g)) {
    if (!tables.has(m[1])) continue
    const body = src.slice(m.index, (m.index ?? 0) + 900)
    if (rawLabelOf(m[2]).test(body)) hits.push(`${src.slice(0, m.index).split("\n").length}: ${m[1]}.map((${m[2]}) … {${m[2]}.label}`)
  }
  return hits
}

const files = fs.readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && n !== "model-options.ts")

describe("config-panel dropdowns localize the labels of raw-English option tables", () => {
  for (const f of files) {
    it(`${f} renders no raw-table label unwrapped`, () => {
      const hits = rawLabelSites(strip(fs.readFileSync(path.join(DIR, f), "utf8")))
      expect(hits, `raw option labels in ${f}:\n${hits.join("\n")}`).toEqual([])
    })
  }
  it("still sees the raw tables and the wired sites (the guard is not vacuous)", () => {
    let tables = 0
    let wired = 0
    for (const f of files) {
      const src = strip(fs.readFileSync(path.join(DIR, f), "utf8"))
      tables += rawTableImports(src).size
      wired += [...src.matchAll(/\{\s*(?:localizeOption|localizeNode|styleCatalog\.resolveLabel)\(\s*(?:\w+\.value,\s*)?\w+\.label\s*\)\s*\}/g)].length
    }
    expect(tables).toBeGreaterThanOrEqual(30)
    expect(wired).toBeGreaterThanOrEqual(40)
  })
  it("fires on a prettier-formatted raw site and stays quiet on a wired one (self-check)", () => {
    const head = `import { IMAGE_ASPECT_RATIOS } from "./model-options"\n`
    const raw = head + `{IMAGE_ASPECT_RATIOS.map((r) => (\n  <SelectItem key={r.value} value={r.value}>\n    {r.label}\n  </SelectItem>\n))}`
    expect(rawLabelSites(raw).length).toBe(1)
    const wired = head + `{IMAGE_ASPECT_RATIOS.map((r) => (\n  <SelectItem key={r.value} value={r.value}>{localizeOption(r.label)}</SelectItem>\n))}`
    expect(rawLabelSites(wired)).toEqual([])
    const local = `{DELIMITER_OPTIONS().map((d) => (<SelectItem value={d.value}>{d.label}</SelectItem>))}`
    expect(rawLabelSites(local)).toEqual([])
    expect(rawTableImports(`import { IMAGE_GEN_MODELS, imageStylePresets, type Foo } from "./model-options"\nimport { SUNO_TEXT_MAX, getMax } from "@nodaro/shared"`)).toEqual(new Set(["IMAGE_GEN_MODELS", "imageStylePresets", "SUNO_TEXT_MAX"]))
  })
})
