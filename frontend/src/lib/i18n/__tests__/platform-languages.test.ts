import { describe, expect, it } from "vitest"
import { offeredLanguages } from "../offered-locales"
import { PLATFORM_LANGUAGES } from "../platform-languages"

const RULE =
  "Nodaro offers the same interface languages in every product: a new language is added to every product together " +
  "(this app, Studio, the creative tools and the shared header) and to PLATFORM_LANGUAGES " +
  "(frontend/src/lib/i18n/platform-languages.ts) in the same release — never to one product first, and none is " +
  "dropped from one alone."

describe("the same languages in every product", () => {
  it("the app offers exactly the platform's languages", () => {
    const offered = offeredLanguages().map((language) => language.id).sort()
    expect(offered, RULE).toEqual([...PLATFORM_LANGUAGES].sort())
  })
})
