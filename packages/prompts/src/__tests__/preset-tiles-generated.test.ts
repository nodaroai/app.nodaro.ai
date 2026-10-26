// @test-watches tools/preset-tiles/** packages/prompts/src/factory-presets/tiles/** frontend/src/lib/i18n/preset-content-tiles.*.generated.ts
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { COPY_LOCALES, LEDGER_PATHS, mergeLedgers, quotedPhrases, renderModules, slotLabel, slotPhrases, templatePrompt, TILES_DIR_PATH, type TileLedger } from "../../../../tools/preset-tiles/render.js"
import { GENERATE_IMAGE_TILE_PRESETS } from "../factory-presets/tiles/index.generated.js"
import { getFactoryPresets } from "../factory-presets.js"

const ROOT = join(__dirname, "..", "..", "..", "..")
const TILES_DIR = join(ROOT, TILES_DIR_PATH)
const ledger = mergeLedgers(LEDGER_PATHS.map((p) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as TileLedger))
/** A checkout with core.autocrlf rewrites the committed modules to CRLF; the comparison is on content, not line endings. */
const lf = (text: string) => text.replace(/\r\n/g, "\n")

describe("Create Image tiles — the generated modules match the ledger", () => {
  const rendered = renderModules(ledger)

  it("every committed module — presets and the app's preset copy per language — is exactly what the ledger renders (run tools/preset-tiles/build.mts)", () => {
    for (const [name, source] of Object.entries(rendered)) {
      expect(lf(readFileSync(join(ROOT, name), "utf8")), name).toBe(source)
    }
  })

  it("no stale generated module is left behind", () => {
    const onDisk = readdirSync(TILES_DIR).filter((f) => f.endsWith(".generated.ts")).map((f) => `${TILES_DIR_PATH}/${f}`)
    const expected = Object.keys(rendered).filter((name) => name.startsWith(TILES_DIR_PATH))
    expect(onDisk.sort()).toEqual(expected.sort())
  })

  it("every tile carries a name in every interface language", () => {
    for (const t of ledger.templates) {
      for (const locale of COPY_LOCALES) expect(t.copy?.[locale]?.name?.trim(), `${t.id}: ${locale}`).toBeTruthy()
    }
  })

  it("the catalog carries one preset per ledger template, in ledger order", () => {
    expect(GENERATE_IMAGE_TILE_PRESETS.map((p) => p.id)).toEqual(ledger.templates.map((t) => `generate-image/${t.id}`))
    const all = getFactoryPresets("generate-image").map((p) => p.id)
    for (const p of GENERATE_IMAGE_TILE_PRESETS) expect(all).toContain(p.id)
  })
})

describe("Create Image tiles — what each preset promises", () => {
  it("renders with the model and size the tile picture was made with, and says when it works from the person's photo", () => {
    for (const t of ledger.templates) {
      const p = GENERATE_IMAGE_TILE_PRESETS.find((x) => x.id === `generate-image/${t.id}`)!
      expect(p.data.provider, t.id).toBe(t.model ?? ledger.model)
      expect(p.data.resolution, t.id).toBe(ledger.resolution)
      expect(typeof p.data.aspectRatio, t.id).toBe("string")
      expect(p.minReferences ?? 0, t.id).toBe(t.minReferences ?? 0)
    }
  })

  it("opens one slot per named headline phrase, TEXT then TEXT2…, each defaulting to the phrase the tile shows, and nothing else", () => {
    for (const t of ledger.templates) {
      const phrases = slotPhrases(t)
      const prompt = templatePrompt(t)
      const opened = [...prompt.matchAll(/\{([^}|]+)\|\|([^}]*)\}/g)].map((m) => [m[1].trim(), m[2].trim()])
      expect(opened, t.id).toEqual(phrases.map((phrase, at) => [slotLabel(at + 1), phrase]))
      expect(t.sampleText ?? "", `${t.id}: sampleText is what the slots show`).toBe(phrases.join(" "))
      // Every other quoted phrase stays as it was: a label, a button, a badge.
      for (const phrase of quotedPhrases(t.prompt)) if (!phrases.includes(phrase)) expect(prompt, t.id).toContain(`"${phrase}"`)
    }
  })

  it("names its slots on every prompt that quotes more than one phrase (the headline, not a label or a button; an empty list opens none)", () => {
    for (const t of ledger.templates) {
      if (t.textDefault === undefined && quotedPhrases(t.prompt).length > 1) expect(Array.isArray(t.slots), `${t.id}: needs slots`).toBe(true)
    }
  })

  it("files every tile under a tab, with a section where the tab has them, and a non-empty platform list only where one applies", () => {
    for (const p of GENERATE_IMAGE_TILE_PRESETS) {
      expect(p.group, p.id).toBeTruthy()
      if (p.section !== undefined) expect(p.section.length, p.id).toBeGreaterThan(0)
      if (p.platforms !== undefined) expect(p.platforms.length, p.id).toBeGreaterThan(0)
    }
    const youtube = GENERATE_IMAGE_TILE_PRESETS.filter((p) => p.group === "YouTube")
    expect(youtube.every((p) => p.section && p.platforms?.[0] === "YouTube")).toBe(true)
  })

  it("every tile has a description a person can act on (who uses it), except layouts and type styles", () => {
    for (const p of GENERATE_IMAGE_TILE_PRESETS) {
      if (p.group === "Layout" || p.group === "Text") continue
      expect(p.description, p.id).toBeTruthy()
    }
  })
})
