import { describe, it, expect, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PersonDimensionGrid } from "../person-dimension-grid"
import { registerCatalogPack, resetCatalogPacks, resetPersonPacks } from "@nodaro/prompts"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

describe("person picker enforces deny curation", () => {
  it("does not render a base entry that a deny pack removed", () => {
    // Baseline: "Woman" renders in the Type dimension.
    const before = render(
      <PersonDimensionGrid
        dimension={"type" as never}
        value={{} as never}
        onChange={() => {}}
        resolveLabel={(_i, l) => l}
        resolveDescription={(_i, d) => d}
        matches={() => true}
      />,
    )
    expect(before.queryByText("Woman")).toBeTruthy()
    before.unmount()

    registerCatalogPack({ id: "deploy/person-deny", catalogId: "person", mode: "deny", denyIds: ["woman", "beautiful-woman"] })

    const after = render(
      <PersonDimensionGrid
        dimension={"type" as never}
        value={{} as never}
        onChange={() => {}}
        resolveLabel={(_i, l) => l}
        resolveDescription={(_i, d) => d}
        matches={() => true}
      />,
    )
    expect(after.queryByText("Woman")).toBeNull()
    expect(after.queryByText("Beautiful Woman")).toBeNull()
    // an un-denied base entry still renders
    expect(after.queryByText("Not Defined")).toBeTruthy()
  })
})
