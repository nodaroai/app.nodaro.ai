import { describe, it, expect, afterEach } from "vitest"
import { createElement } from "react"
import { render } from "@testing-library/react"
import type { LocaleId } from "@nodaro/shared/i18n"
import { localeText, translate, tx, useT, type MessageKey } from ".."
import { DICTS } from "../dicts"
import { en } from "../en"
import { stringOverride } from "../overrides"
import { useLocaleStore } from "@/lib/locale-store"
import type { NodaroRuntimeConfig } from "@/lib/runtime-config"

/**
 * A deployment's UI-string overrides (`strings.flow` in the surface profile,
 * via /config.js) laid over the dictionaries. They are inert by default:
 * with none configured, every string resolves exactly as before.
 */

const KEY: MessageKey = "credits.allowanceExceeded"
const POSE: MessageKey = "motionReview.diagnostic.pose"
const HE_TEXT = "נגמרה לכם המכסה. פנו למנהל המערכת שלכם."
const EN_TEXT = "Your Example Studio allowance is used up. Ask your administrator for more."
const LOCALES = [...(Object.keys(DICTS) as LocaleId[]), "xx" as LocaleId]
const KEYS = Object.keys(en) as MessageKey[]

function setRuntime(cfg: NodaroRuntimeConfig | undefined): void {
  if (cfg === undefined) delete window.__NODARO_RUNTIME__
  else window.__NODARO_RUNTIME__ = cfg
}

afterEach(() => {
  setRuntime(undefined)
  useLocaleStore.setState({ locale: "en" })
})

/** The resolver as it was before overrides existed. */
const before = (locale: LocaleId, key: MessageKey): string => DICTS[locale]?.[key] ?? en[key] ?? key

describe("INERT: with no overrides, every string in every locale resolves exactly as before", () => {
  it.each<[string, NodaroRuntimeConfig | undefined]>([
    ["no /config.js object", undefined],
    ["a /config.js with no surface", { apiUrl: "/" }],
    ["a surface without strings", { surface: { nav: { hide: ["gallery"] } } }],
    ["an empty strings block", { surface: { strings: {} } }],
    ["an empty flow namespace", { surface: { strings: { flow: {} } } }],
    ["another product's overrides only", { surface: { strings: { voice: { en: { [KEY]: "x" } } } } }],
  ])("%s", (_label, cfg) => {
    setRuntime(cfg)
    let differ = 0
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        if (translate(locale, key) !== before(locale, key)) differ++
        if (localeText(locale, key) !== DICTS[locale]?.[key]) differ++
      }
    }
    expect(differ).toBe(0)
    expect(translate("he", POSE, { after: "A", before: "B", fromPose: "C", toPose: "D" })).toBe(
      before("he", POSE).replace("{after}", "A").replace("{before}", "B").replace("{fromPose}", "C").replace("{toPose}", "D"),
    )
  })
})

describe("an override replaces one string in one locale", () => {
  it("in that locale only; other locales keep their own text", () => {
    setRuntime({ surface: { strings: { flow: { he: { [KEY]: HE_TEXT } } } } })
    expect(translate("he", KEY)).toBe(HE_TEXT)
    expect(translate("en", KEY)).toBe(en[KEY])
    expect(translate("ja", KEY)).toBe(DICTS.ja?.[KEY])
    expect(translate("he", "common.cancel")).toBe(DICTS.he?.["common.cancel"])
  })

  it("is filled with the same placeholders as the string it replaces", () => {
    setRuntime({ surface: { strings: { flow: { en: { [POSE]: "{before} → {after} ({fromPose}/{toPose})" } } } } })
    expect(translate("en", POSE, { after: "Sit", before: "Stand", fromPose: "standing", toPose: "seated" })).toBe("Stand → Sit (standing/seated)")
  })

  it("an English override is the English everyone falls back to, but never replaces a translation", () => {
    setRuntime({ surface: { strings: { flow: { en: { [KEY]: EN_TEXT } } } } })
    expect(DICTS.de?.[KEY]).toBeUndefined() // a stub locale
    expect(translate("de", KEY)).toBe(EN_TEXT)
    expect(translate("he", KEY)).toBe(DICTS.he?.[KEY])
  })

  it("counts as the locale's own text wherever that is asked (localeText)", () => {
    setRuntime({ surface: { strings: { flow: { de: { [KEY]: "Ihr Kontingent ist aufgebraucht." } } } } })
    expect(localeText("de", KEY)).toBe("Ihr Kontingent ist aufgebraucht.")
    expect(localeText("de", "common.cancel")).toBe(DICTS.de?.["common.cancel"])
  })

  it("reaches the non-hook tx() in the live locale", () => {
    setRuntime({ surface: { strings: { flow: { he: { [KEY]: HE_TEXT }, en: { [KEY]: EN_TEXT } } } } })
    useLocaleStore.setState({ locale: "he" })
    expect(tx(KEY)).toBe(HE_TEXT)
    useLocaleStore.setState({ locale: "en" })
    expect(tx(KEY)).toBe(EN_TEXT)
  })

  it("the first render already shows it: /config.js runs before the app, so there is no flash of the platform's wording", () => {
    setRuntime({ surface: { strings: { flow: { en: { [KEY]: EN_TEXT } } } } })
    function Probe() {
      const t = useT()
      return createElement("p", null, t(KEY))
    }
    const { container } = render(createElement(Probe))
    expect(container.textContent).toBe(EN_TEXT)
  })

  it("is read at call time: a /config.js object set after import, or replaced, is what the next string sees", () => {
    expect(translate("en", KEY)).toBe(en[KEY])
    setRuntime({ surface: { strings: { flow: { en: { [KEY]: "First." } } } } })
    expect(translate("en", KEY)).toBe("First.")
    setRuntime({ surface: { strings: { flow: { en: { [KEY]: "Second." } } } } })
    expect(translate("en", KEY)).toBe("Second.")
    setRuntime(undefined)
    expect(translate("en", KEY)).toBe(en[KEY])
  })

  it("a malformed block is ignored rather than thrown on", () => {
    for (const strings of ["x", 7, [1], { flow: "x" }, { flow: { en: "x" } }, { flow: { en: { [KEY]: 7 } } }]) {
      setRuntime({ surface: { strings } } as unknown as NodaroRuntimeConfig)
      expect(() => translate("en", KEY)).not.toThrow()
      expect(translate("en", KEY)).toBe(en[KEY])
    }
  })

  it("never answers a key the overrides object inherits (and leaves the dictionary lookup as it was)", () => {
    setRuntime({ surface: { strings: { flow: { en: { [KEY]: EN_TEXT } } } } })
    expect(stringOverride("en", "toString")).toBeUndefined()
    expect(stringOverride("en", "__proto__")).toBeUndefined()
    expect(translate("en", "toString" as MessageKey)).toBe(before("en", "toString" as MessageKey))
  })
})
