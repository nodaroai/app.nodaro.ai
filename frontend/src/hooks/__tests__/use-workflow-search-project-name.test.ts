import { describe, it, expect } from "vitest"
import { projectNameMap } from "@/lib/project-display-name"
import { translate } from "@/lib/i18n"

// The dashboard's workflow search joins each hit to its project's name through
// an in-memory map; the map is built with the DISPLAY name so the default
// project reads in the user's language there too.
describe("projectNameMap", () => {
  it("maps ids to display names, localizing only the seeded default", () => {
    const m = projectNameMap([
      { id: "a", name: "My Recent Flows", isDefault: true },
      { id: "b", name: "My Recent Flows", isDefault: false },
      { id: "c", name: "Client", isDefault: true },
    ], "he")
    expect(m.get("a")).toBe(translate("he", "projects.defaultName"))
    expect(m.get("b")).toBe("My Recent Flows")
    expect(m.get("c")).toBe("Client")
  })
})
