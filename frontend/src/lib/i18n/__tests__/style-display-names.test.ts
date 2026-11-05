// @vitest-environment node
import { describe, it, expect } from "vitest"
import { en } from "../en"
import { he } from "../he"
import { ja } from "../ja"
import { ko } from "../ko"
import { ptBR } from "../pt-br"
import { PRESET_CONTENT_HE } from "../preset-content.he"
import { PRESET_CONTENT_JA } from "../preset-content.ja"
import { PRESET_CONTENT_KO } from "../preset-content.ko"
import { PRESET_CONTENT_PT_BR } from "../preset-content.pt-br"

/** The studio's name, in every script a translation has spelled it or could. */
const STUDIO_NAME = /pixar|皮克斯|ピクサー|픽사|пиксар|بيكسار|פיקסאר|פיקסר|पिक्सर|पिक्सार/i

const DICTS = { en, he, ja, ko, ptBR } as const
const PRESET_CONTENT = { he: PRESET_CONTENT_HE, ja: PRESET_CONTENT_JA, ko: PRESET_CONTENT_KO, ptBr: PRESET_CONTENT_PT_BR } as const

describe("the 3D animated entity style", () => {
  it("is called 3D Animated in English on both surfaces", () => {
    expect(en["cfgext.entStyle3dPixar"]).toBe("3D Animated")
    expect(en["studio.style3dPixar"]).toBe("3D Animated")
  })

  it.each(Object.entries(DICTS))("reads the same on both surfaces in %s", (_locale, dict) => {
    expect(dict["cfgext.entStyle3dPixar"]).toBe(dict["studio.style3dPixar"])
  })
})

describe("what users read never names the studio", () => {
  it.each(Object.entries(DICTS))("the %s dictionary's text", (_locale, dict) => {
    for (const [key, text] of Object.entries(dict)) expect(text, key).not.toMatch(STUDIO_NAME)
  })

  it.each(Object.entries(PRESET_CONTENT))("the %s preset names and descriptions", (_locale, content) => {
    for (const [id, copy] of Object.entries(content)) {
      expect(copy.name, id).not.toMatch(STUDIO_NAME)
      expect(copy.description ?? "", id).not.toMatch(STUDIO_NAME)
    }
  })
})
