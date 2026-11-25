/**
 * The 3D animated film style: what users read is free of the studio's name,
 * and what models read has not moved. Wording that reaches a model shifts
 * results, so it stays byte-identical until someone decides to change it.
 */
import { beforeAll, describe, it, expect } from "vitest"
import { NON_EN_LOCALE_IDS, entryMatchesQuery, type LocaleCatalogMap, type LocaleId } from "@nodaro/shared/i18n"
import {
  FACTORY_PRESETS,
  STYLES,
  buildMultiPickerAnalyzerSpec,
  buildPickerAnalyzerSpec,
  getPickerCatalog,
  getRegisteredPickerCatalogs,
  getStyle,
  getStyleLabel,
  getStylePromptHint,
  getStyleTerm,
  getStyleVideoPromptHint,
  projectPickerCatalog,
} from "../index.js"

const STYLE_ID = "pixar-3d"

/** The studio's name, in every script a translation has spelled it or could. */
const STUDIO_NAME = /pixar|皮克斯|ピクサー|픽사|пиксар|بيكسار|פיקסאר|פיקסר|पिक्सर|पिक्सार/i

describe("the 3D animated film style", () => {
  it("is called 3D Animated Film", () => {
    expect(getStyle(STYLE_ID)?.label).toBe("3D Animated Film")
    expect(getStyleLabel(STYLE_ID)).toBe("3D Animated Film")
    expect(getPickerCatalog("style")?.options?.find((o) => o.id === STYLE_ID)?.label).toBe("3D Animated Film")
  })

  it("keeps its id and its medium", () => {
    expect(STYLES.map((s) => s.id)).toContain(STYLE_ID)
    expect(getStyle(STYLE_ID)?.medium).toBe("3d")
  })

  it("sends models the same wording, byte for byte", () => {
    expect(getStylePromptHint(STYLE_ID)).toBe(
      "Pixar-style 3D character animation, polished CG with appealing rounded character design, soft subsurface skin shading, cinematic key lighting and expressive animated feature-film quality",
    )
    expect(getStyleVideoPromptHint(STYLE_ID)).toBe(
      "Pixar-style 3D animated feature film: appealing rounded character designs, soft subsurface skin shading, polished CG materials, cinematic key lighting, expressive animation.",
    )
    expect(getStyleTerm(STYLE_ID)).toBe("pixar-style 3d animation")
  })

  it("reads the same in the analyzers' system prompt, byte for byte", () => {
    const line = "- pixar-3d: Pixar 3D — Polished character animation CG"
    expect(buildMultiPickerAnalyzerSpec(["style"]).legend.split("\n")).toContain(line)
    expect(buildMultiPickerAnalyzerSpec(["style", "mood"]).legend.split("\n")).toContain(line)
  })

  it("is the only style whose analyzer wording differs from its label", () => {
    expect(STYLES.filter((s) => s.promptLabel !== undefined).map((s) => s.id)).toEqual([STYLE_ID])
    const legend = buildPickerAnalyzerSpec("style").dimensions[0].legend
    for (const s of STYLES) {
      expect(legend.find((row) => row.id === s.id)?.label, s.id).toBe(s.promptLabel ?? s.label)
    }
  })

  it("does not carry the analyzer wording to any catalog a client reads", () => {
    const catalog = getPickerCatalog("style")
    expect(catalog?.options?.some((o) => "promptLabel" in o)).toBe(false)
    for (const detail of ["compact", "full"] as const) {
      const projected = JSON.stringify(projectPickerCatalog(catalog!, { detail }))
      expect(projected).not.toContain("promptLabel")
      expect(projected).toContain('"label":"3D Animated Film"')
    }
  })

  it("is found by its id, and that is the only style the query finds", () => {
    const found = STYLES.filter((s) => entryMatchesQuery("style", s.id, s.label, s.description, "en", "pixar"))
    expect(found.map((s) => s.id)).toEqual([STYLE_ID])
  })
})

describe("presets sent to models keep their wording", () => {
  const preset = (id: string) => Object.values(FACTORY_PRESETS).flat().find((p) => p.id === id)

  it("names change, prompts do not", () => {
    expect(preset("generate-image/pixar-3d")?.name).toBe("3D Animated Film")
    expect(preset("generate-image/pixar-3d")?.data).toMatchObject({
      style: STYLE_ID,
      prompt: "{character or subject || a curious round-cheeked kid with big expressive eyes}, polished 3D animated render, soft subsurface skin, warm key light with gentle bounce, charming appeal",
    })
    expect(preset("generate-video/cartoon-3d")?.description).toBe("Playful animated-film motion.")
    expect(preset("generate-video/cartoon-3d")?.data.prompt).toContain("glossy Pixar-style rendering with soft subsurface skin")
    expect(preset("generate-image/text-inflated-clay")?.data.prompt).toContain("playful Pixar-like render")
  })
})

// A hint, a term, a `prompt` or a `promptPrefix` is what a model reads, and is
// outside this guard on purpose. So is `promptLabel`.
describe("what users read never names the studio", () => {
  it("the guard catches the name however it is spelled", () => {
    for (const spelling of ["Pixar 3D", "PIXAR", "皮克斯 3D", "ピクサー風", "픽사 스타일", "Пиксар", "بيكسار", "פיקסאר", "पिक्सर"]) {
      expect(spelling).toMatch(STUDIO_NAME)
    }
  })

  it("catalog names, descriptions and dimension names", () => {
    for (const catalog of getRegisteredPickerCatalogs()) {
      expect(catalog.label, catalog.catalogId).not.toMatch(STUDIO_NAME)
      for (const dimension of catalog.dimensions ?? []) expect(dimension.label, catalog.catalogId).not.toMatch(STUDIO_NAME)
      const options = [...(catalog.options ?? []), ...(catalog.dimensions ?? []).flatMap((d) => d.options)]
      for (const option of options) {
        expect(option.label, `${catalog.catalogId}/${option.id}`).not.toMatch(STUDIO_NAME)
        expect(option.description ?? "", `${catalog.catalogId}/${option.id}`).not.toMatch(STUDIO_NAME)
      }
    }
  })

  it("factory preset names, descriptions, groups and sections", () => {
    for (const preset of Object.values(FACTORY_PRESETS).flat()) {
      for (const text of [preset.name, preset.description, preset.group, preset.section]) {
        expect(text ?? "", preset.id).not.toMatch(STUDIO_NAME)
      }
    }
  })

  describe("catalog translations in every locale", () => {
    /** Every sidecar that exists, by locale: one per (registered catalog, locale). */
    const sidecars = new Map<LocaleId, { catalogId: string; map: LocaleCatalogMap }[]>()

    // Importing the sidecars is nearly all of this check's time: 429 files,
    // 6.4 MB of source, each transformed on first import. In one test body that
    // took 1.1-1.4 s on CI and 5.1 s on a runner running 3-4x slow, past vitest's
    // 5 s default. So they load once, here, in parallel (about 0.7 s locally,
    // against 1.9 s one at a time), with a budget of their own.
    beforeAll(async () => {
      const loaded = await Promise.all(
        getRegisteredPickerCatalogs().flatMap((catalog) =>
          NON_EN_LOCALE_IDS.map(async (locale) => {
            try {
              const mod = (await import(`../../../shared/src/i18n/${catalog.catalogId}.${locale}.ts`)) as { default?: LocaleCatalogMap }
              return { locale, catalogId: catalog.catalogId, map: mod.default ?? {} }
            } catch {
              return undefined // a missing sidecar is i18n-locale-completeness.test.ts's job
            }
          }),
        ),
      )
      for (const sidecar of loaded) {
        if (!sidecar) continue
        sidecars.set(sidecar.locale, [...(sidecars.get(sidecar.locale) ?? []), sidecar])
      }
    }, 60_000)

    /** The entries in a locale's sidecars whose label or description names the studio, and how many were read. */
    function scan(locale: LocaleId): { read: number; offenders: string[] } {
      let read = 0
      const offenders: string[] = []
      for (const { catalogId, map } of sidecars.get(locale) ?? []) {
        for (const [id, entry] of Object.entries(map)) {
          read += 1
          if (STUDIO_NAME.test(entry?.label ?? "")) offenders.push(`${catalogId}.${locale}/${id} label: ${entry?.label}`)
          if (STUDIO_NAME.test(entry?.description ?? "")) offenders.push(`${catalogId}.${locale}/${id} description: ${entry?.description}`)
        }
      }
      return { read, offenders }
    }

    it.each(NON_EN_LOCALE_IDS)("%s", (locale) => {
      const { read, offenders } = scan(locale)
      expect(offenders).toEqual([])
      expect(read, locale).toBeGreaterThan(0)
    })

    it("reads more than 10,000 entries across the locales", () => {
      const read = NON_EN_LOCALE_IDS.reduce((n, locale) => n + scan(locale).read, 0)
      expect(read).toBeGreaterThan(10_000)
    })
  })

  it("translates the style's name in every locale rather than keeping the English", async () => {
    for (const locale of NON_EN_LOCALE_IDS) {
      const mod = (await import(`../../../shared/src/i18n/style.${locale}.ts`)) as { default: LocaleCatalogMap }
      const label = mod.default[STYLE_ID]?.label
      expect(label, locale).toBeTruthy()
      expect(label, locale).not.toBe("3D Animated Film")
    }
  })
})
