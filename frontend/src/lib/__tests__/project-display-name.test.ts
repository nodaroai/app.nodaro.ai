import { describe, it, expect } from "vitest"
import { projectDisplayName } from "../project-display-name"
import { translate } from "@/lib/i18n"

// The per-user default project is CREATED with the English name "My Recent
// Flows" (migration 119) and persisted as such. Its name is chrome, not user
// data — it must read in the user's language wherever a project name renders.
describe("projectDisplayName", () => {
  it("localizes the default project's persisted name", () => {
    expect(projectDisplayName({ name: "My Recent Flows", isDefault: true }, "he")).toBe(translate("he", "projects.defaultName"))
    expect(projectDisplayName({ name: "My Recent Flows", isDefault: true }, "en")).toBe("My Recent Flows")
  })
  it("keeps a renamed default project's name verbatim", () => {
    expect(projectDisplayName({ name: "Client work", isDefault: true }, "he")).toBe("Client work")
  })
  it("never touches a regular project's name", () => {
    expect(projectDisplayName({ name: "My Recent Flows", isDefault: false }, "he")).toBe("My Recent Flows")
  })
})
