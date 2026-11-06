/**
 * Every art style has a name of its own in each language Nodaro's apps offer
 * in their language menus (Hebrew, Japanese, Korean, Brazilian Portuguese):
 * an explicit `label` in the style sidecar, never the English fallback by
 * omission. Where a language keeps the English loanword ("Anime",
 * "Cyberpunk" in Brazilian Portuguese), the sidecar says so explicitly, so
 * the choice is deliberate and a new style cannot ship untranslated there.
 * The other locales follow the general sidecar rule (a loanword may be left
 * out) and are not held to this.
 */
import { describe, it, expect } from "vitest"
import type { LocaleCatalogMap, LocaleId } from "@nodaro/shared/i18n"
import { STYLES } from "../index.js"

const OFFERED = ["he", "ja", "ko", "pt-BR"] as const satisfies readonly LocaleId[]

async function sidecar(locale: LocaleId): Promise<LocaleCatalogMap> {
  return ((await import(`../../../shared/src/i18n/style.${locale}.ts`)) as { default: LocaleCatalogMap }).default
}

describe("art style names in the languages the apps offer", () => {
  it.each(OFFERED)("%s names every style explicitly", async (locale) => {
    const map = await sidecar(locale)
    const unnamed = STYLES.filter((style) => !map[style.id]?.label?.trim()).map((style) => style.id)
    expect(unnamed).toEqual([])
  })

  it("Brazilian Portuguese keeps the loanwords Brazilians use, and says the rest in Portuguese", async () => {
    const map = await sidecar("pt-BR")
    const label = (id: string) => map[id]?.label
    for (const [id, name] of [
      ["anime", "Anime"],
      ["cyberpunk", "Cyberpunk"],
      ["steampunk", "Steampunk"],
      ["vaporwave", "Vaporwave"],
      ["ukiyo-e", "Ukiyo-e"],
    ] as const) expect(label(id), id).toBe(name)
    expect(label("ascii-art")).toBe("Arte ASCII")
    expect(label("claymation")).toBe("Animação em massinha")
    expect(label("blueprint")).toBe("Planta técnica")
  })

  it("Korean says ukiyo-e and ASCII art in Hangul", async () => {
    const map = await sidecar("ko")
    expect(map["ukiyo-e"]?.label).toBe("우키요에")
    expect(map["ascii-art"]?.label).toBe("아스키 아트")
  })
})
