import { describe, it, expect } from "vitest"
import { entryMatchesQuery } from "../i18n/index.js"

const match = (query: string, locale: "en" | "he" = "en") =>
  entryMatchesQuery("style", "old-word-look", "New Name", "Some description", locale, query)

describe("entryMatchesQuery", () => {
  it("finds an entry by a query only its id contains", () => {
    expect(match("old-word")).toBe(true)
    expect(match("word")).toBe(true)
  })

  it("finds it by id in a translated locale too", () => {
    expect(match("old-word", "he")).toBe(true)
  })

  it("ignores case and surrounding space in an id match", () => {
    expect(match("  OLD-Word ")).toBe(true)
  })

  it("still finds an entry by its label and description", () => {
    expect(match("new name")).toBe(true)
    expect(match("description")).toBe(true)
  })

  it("does not find an entry nothing of which contains the query", () => {
    expect(match("absent")).toBe(false)
    expect(match("absent", "he")).toBe(false)
  })

  it("matches everything on an empty query", () => {
    expect(match("   ")).toBe(true)
  })
})
