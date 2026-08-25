import { describe, it, expect } from "vitest"
import { getRegisteredPickerCatalogs, getPickerCatalog, projectPickerCatalog } from "../picker-catalogs.js"

describe("every registered catalog is resolvable + projectable", () => {
  it.each(getRegisteredPickerCatalogs().map((c) => [c.catalogId] as const))("%s resolves and projects", (id) => {
    const c = getPickerCatalog(id)
    expect(c, `getPickerCatalog("${id}") returned undefined`).toBeTruthy()
    const projected = projectPickerCatalog(c!, { detail: "compact" })
    expect(projected.catalogId).toBe(id)
  })
})
