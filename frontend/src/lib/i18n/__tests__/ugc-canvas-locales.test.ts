/**
 * The UGC canvas strings (Add Captions plan note, the Creator card, the Present
 * restrict count) ship in every registered chrome locale. Seven locales fell
 * back to English for them until PR A; the dicts are partial by design and the
 * coverage report is non-failing, so this pins the keys — present, non-empty,
 * and carrying exactly the English value's {placeholders} — in all eleven dicts.
 */
import { describe, it, expect } from "vitest"
import { en, type ChromeDict, type MessageKey } from "../en"
import { he } from "../he"
import { ar } from "../ar"
import { de } from "../de"
import { es } from "../es"
import { fr } from "../fr"
import { hi } from "../hi"
import { ja } from "../ja"
import { ko } from "../ko"
import { ptBR } from "../pt-br"
import { ru } from "../ru"
import { zhCN } from "../zh-cn"
import { registeredChromeLocales } from ".."

const DICTS: Record<string, ChromeDict> = { he, ar, de, es, fr, hi, ja, ko, "pt-BR": ptBR, ru, "zh-CN": zhCN }

const KEYS = (Object.keys(en) as MessageKey[]).filter((k) => /^creatorCard\.|^addCaptions\.captionPlanNote$|^present\.restrictFieldsCount$/.test(k))

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe("UGC canvas strings in every chrome locale", () => {
  it("covers every registered locale and the ten keys", () => {
    expect(new Set(registeredChromeLocales())).toEqual(new Set(["en", ...Object.keys(DICTS)]))
    expect(KEYS).toHaveLength(10)
  })

  for (const [locale, dict] of Object.entries(DICTS)) {
    it(`${locale} has every key, with the English placeholders`, () => {
      expect(KEYS.filter((k) => !dict[k]?.trim())).toEqual([])
      expect(KEYS.filter((k) => placeholders(dict[k] ?? "").join() !== placeholders(en[k]).join())).toEqual([])
    })
  }
})
