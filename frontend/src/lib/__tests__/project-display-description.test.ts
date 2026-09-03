import { describe, it, expect } from "vitest"
import { projectDisplayDescription } from "../project-display-name"
import { translate } from "@/lib/i18n"

// The default project is seeded with an English DESCRIPTION too ("Auto-created
// workspace for new workflows", migration 119). Same rule as the name: chrome
// while it still equals the seed, verbatim once edited, never for a regular
// project.
describe("projectDisplayDescription", () => {
  it("localizes the seeded default description", () => {
    expect(projectDisplayDescription({ description: "Auto-created workspace for new workflows", isDefault: true }, "he")).toBe(translate("he", "projects.defaultDescription"))
  })
  it("keeps an edited description and a regular project's description verbatim", () => {
    expect(projectDisplayDescription({ description: "Client work", isDefault: true }, "he")).toBe("Client work")
    expect(projectDisplayDescription({ description: "Auto-created workspace for new workflows", isDefault: false }, "he")).toBe("Auto-created workspace for new workflows")
    expect(projectDisplayDescription({ description: "", isDefault: true }, "he")).toBe("")
  })
})
