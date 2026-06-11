import { describe, it, expect } from "vitest"
import { LENSES } from "../lens.js"
import { MATERIALS } from "../materials.js"
import { MOODS } from "../mood.js"

/**
 * Cinematography catalog gap-fill (Seedance doctrine sources): probe + CCTV
 * lenses, subsurface material, relieved mood, and physical-externalization
 * enrichment of the core emotion hints (official BytePlus table: emotions as
 * externalized physical detail, never abstract words).
 *
 * The locale matrix below guards that the NEW ids ship with all 11 locale
 * sidecars — the global completeness check only verifies files exist, not
 * per-entry coverage, so without this a new entry silently falls back to
 * English in 11 locales.
 */
const LOCALES = ["ar", "de", "es", "fr", "he", "hi", "ja", "ko", "pt-BR", "ru", "zh-CN"] as const
const NEW_IDS: Record<string, string[]> = {
  lens: ["probe", "cctv"],
  materials: ["subsurface"],
  mood: ["relieved"],
}

describe("catalog gap-fill entries", () => {
  it("English catalogs carry the new entries with prompt hints", () => {
    for (const id of NEW_IDS.lens!) {
      const e = LENSES.find((l) => l.id === id)
      expect(e, id).toBeDefined()
      expect(e!.promptHint.length).toBeGreaterThan(20)
    }
    expect(MATERIALS.find((m) => m.id === "subsurface")?.promptHint).toContain("subsurface scattering")
    expect(MOODS.find((m) => m.id === "relieved")?.promptHint).toContain("long breath")
  })

  it("core emotion hints carry physical externalization (doctrine table)", () => {
    const hint = (id: string) => MOODS.find((m) => m.id === id)?.promptHint ?? ""
    expect(hint("sad")).toContain("shoulders trembling")
    expect(hint("joyful")).toContain("corners of the mouth")
    expect(hint("angry")).toContain("fists clenched")
    expect(hint("anxious")).toContain("eyes darting")
  })

  it.each(LOCALES)("locale %s has all new ids in its sidecars", async (locale) => {
    for (const [catalog, ids] of Object.entries(NEW_IDS)) {
      const mod = (await import(`../i18n/${catalog}.${locale}.ts`)) as {
        default: Record<string, { label?: string }>
      }
      for (const id of ids) {
        expect(mod.default[id]?.label, `${catalog}.${locale}: ${id}`).toBeTruthy()
      }
    }
  })
})
