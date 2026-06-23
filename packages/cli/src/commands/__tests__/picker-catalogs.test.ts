import { describe, it, expect } from "vitest"
import { pickerCatalogsCommand } from "../picker-catalogs.js"

describe("pickerCatalogsCommand", () => {
  it("is named 'pickers' with list + get subcommands", () => {
    const cmd = pickerCatalogsCommand()
    expect(cmd.name()).toBe("pickers")
    const subs = cmd.commands.map((c) => c.name())
    expect(subs).toContain("list")
    expect(subs).toContain("get")
  })

  it("get takes a required <nodeType> argument", () => {
    const cmd = pickerCatalogsCommand()
    const get = cmd.commands.find((c) => c.name() === "get")!
    // commander registers one required arg
    expect(get.registeredArguments.map((a) => a.name())).toEqual(["nodeType"])
  })
})
