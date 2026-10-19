import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { isOfferedLocale } from "@/lib/i18n/offered-locales"
import { consentInterfaceLocale } from "../consent-locale"

/** A language the app lists but has not translated yet — its chrome falls back to English. */
const NOT_TRANSLATED: LocaleId | undefined = LANGUAGES.map((l) => l.id).find((id) => !isOfferedLocale(id))

beforeEach(() => useLocaleStore.setState({ locale: "en" }))
afterEach(() => useLocaleStore.setState({ locale: "en" }))

describe("consentInterfaceLocale", () => {
  it.each(["en", "he", "ja", "ko", "pt-BR"] as const)("is %s when that is the interface language and its chrome is translated", (locale) => {
    useLocaleStore.setState({ locale })
    expect(consentInterfaceLocale()).toBe(locale)
  })

  it.skipIf(!NOT_TRANSLATED)(
    "is English for a language whose chrome is not translated — the words on screen are English",
    () => {
      useLocaleStore.setState({ locale: NOT_TRANSLATED })
      expect(consentInterfaceLocale()).toBe("en")
    },
  )

  it("reads the live store at call time, not a value captured at import", () => {
    useLocaleStore.setState({ locale: "ja" })
    expect(consentInterfaceLocale()).toBe("ja")
    useLocaleStore.setState({ locale: "ko" })
    expect(consentInterfaceLocale()).toBe("ko")
  })
})
