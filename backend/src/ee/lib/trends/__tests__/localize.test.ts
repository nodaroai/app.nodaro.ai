import { describe, it, expect } from "vitest"
import { pickText } from "../localize.js"

describe("pickText", () => {
  const name = { en: "Dance off", he: "קרב ריקודים" }

  it("returns the asked locale when the text has it", () => {
    expect(pickText(name, "he")).toBe("קרב ריקודים")
  })

  it("falls back to en when the locale is missing", () => {
    expect(pickText(name, "fr")).toBe("Dance off")
  })

  it("falls back to en for an unknown or empty locale", () => {
    expect(pickText(name, "xx-XX")).toBe("Dance off")
    expect(pickText(name, "")).toBe("Dance off")
  })

  it("falls back to en when the locale's text is empty", () => {
    expect(pickText({ en: "Dance off", he: "" }, "he")).toBe("Dance off")
  })

  it("is undefined for no text", () => {
    expect(pickText(undefined, "he")).toBeUndefined()
  })
})
