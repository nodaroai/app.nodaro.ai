import { describe, it, expect, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PersonDimensionGrid } from "../person-dimension-grid"
import { registerPersonPack, resetPersonPacks, resetCatalogPacks } from "@nodaro/prompts"

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

describe("person picker renders the registered set", () => {
  it("shows a pack-added entry's label", () => {
    registerPersonPack({
      id: "sai/x",
      dimensions: [{ dimension: "sector-attire", field: "sectorAttire", label: "Sector Attire" }],
      entries: [
        {
          id: "attire-modest-suit",
          label: "Modest Suit",
          group: "Attire",
          dimension: "sector-attire",
          description: "d",
          promptHint: "h",
        },
      ],
    })
    const { getByText } = render(
      <PersonDimensionGrid
        dimension={"sector-attire" as never}
        value={{} as never}
        onChange={() => {}}
        resolveLabel={(_i, l) => l}
        resolveDescription={(_i, d) => d}
        matches={() => true}
      />,
    )
    expect(getByText("Modest Suit")).toBeTruthy()
  })
})
