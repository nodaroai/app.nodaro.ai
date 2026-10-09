import { describe, it, expect } from "vitest"
import { collectionsCommand, itemFromJson, parseCount, parseFormat, parseUsage } from "../collections.js"

describe("collections command helpers", () => {
  it("itemFromJson takes one object, or one of a list by index", () => {
    expect(itemFromJson({ text: "x" })).toEqual({ text: "x" })
    expect(itemFromJson([{ text: "a" }, { text: "b" }], 1)).toEqual({ text: "b" })
    expect(itemFromJson("just a line")).toBe("just a line")
    expect(() => itemFromJson([{ text: "a" }], 3)).toThrow(/no item 3/)
    expect(() => itemFromJson(null)).toThrow(/nothing to save/)
  })

  it("parseFormat takes csv (the default) or json", () => {
    expect(parseFormat(undefined)).toBe("csv")
    expect(parseFormat("csv")).toBe("csv")
    expect(parseFormat("json")).toBe("json")
    expect(() => parseFormat("xml")).toThrow(/csv or json/)
  })

  it("parseCount takes a whole number or nothing, never NaN", () => {
    expect(parseCount("--offset", undefined)).toBeUndefined()
    expect(parseCount("--offset", "12")).toBe(12)
    expect(() => parseCount("--offset", "abc")).toThrow(/--offset must be a whole number/)
    expect(() => parseCount("--limit", "-1")).toThrow(/--limit must be a whole number/)
  })

  it("parseUsage takes all (nothing sent), unused or used", () => {
    expect(parseUsage(undefined)).toBeUndefined()
    expect(parseUsage("all")).toBeUndefined()
    expect(parseUsage("unused")).toBe("unused")
    expect(parseUsage("used")).toBe("used")
    expect(() => parseUsage("later")).toThrow(/all, unused or used/)
  })

  it("registers every subcommand the docs name", () => {
    const names = collectionsCommand()
      .commands.map((c) => c.name())
      .sort()
    expect(names).toEqual(["add", "create", "delete", "export", "list", "mark-used", "records", "remove", "restore", "show", "update"])
  })
})
