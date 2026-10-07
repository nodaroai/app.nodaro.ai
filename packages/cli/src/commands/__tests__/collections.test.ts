import { describe, it, expect } from "vitest"
import { collectionsCommand, itemFromJson, parseFormat } from "../collections.js"

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

  it("registers every subcommand the docs name", () => {
    const names = collectionsCommand()
      .commands.map((c) => c.name())
      .sort()
    expect(names).toEqual(["add", "create", "delete", "export", "list", "records", "remove", "show", "update"])
  })
})
