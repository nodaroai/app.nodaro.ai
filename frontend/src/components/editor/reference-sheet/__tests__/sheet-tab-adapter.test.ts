import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveNormalizedImageGen } from "@nodaro/shared"

const generateCharacterAsset = vi.fn()
const generateObjectAsset = vi.fn()
const generateLocationAsset = vi.fn()
vi.mock("@/lib/api", () => ({
  generateCharacterAsset: (...a: unknown[]) => generateCharacterAsset(...a),
  generateObjectAsset: (...a: unknown[]) => generateObjectAsset(...a),
  generateLocationAsset: (...a: unknown[]) => generateLocationAsset(...a),
  getJobStatusLean: vi.fn(),
}))

import { SHEET_TAB_ADAPTERS, SHEET_PANEL_PROVIDER } from "../sheet-tab-adapter"

/**
 * The sheet quotes a panel at the live price of `SHEET_PANEL_PROVIDER`, so that
 * has to be both the model every panel request asks for and the id the panel
 * routes charge for it.
 */
describe("sheet panels are generated with the model their price is read for", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is the model workflow runs ask for and the docs price", () => {
    expect(
      SHEET_PANEL_PROVIDER,
      "the backend's SHEET_PANEL_PROVIDER (reference-sheet-stage-a.ts) and docs/nodes/ai-image/reference-sheet.md name this model too — change them together",
    ).toBe("gpt-image-2")
  })

  it("every entity kind's panel request names the model", async () => {
    const req = {
      assetType: "angles", variant: "front", attachToColumn: "angles", attachName: "front",
      name: "Hero – front", sourceImageUrl: "https://img/hero.png",
    }
    for (const adapter of Object.values(SHEET_TAB_ADAPTERS)) await adapter.generateAsset("db-1", req)

    for (const generate of [generateCharacterAsset, generateObjectAsset, generateLocationAsset]) {
      expect(generate).toHaveBeenCalledTimes(1)
      expect(generate.mock.calls[0]?.[0]).toMatchObject({ provider: SHEET_PANEL_PROVIDER })
    }
  })

  it("every panel route charges the model under its own id", () => {
    // The object route charges the requested model as named; the character and
    // location routes resolve it with the reference images they send (the
    // character route counts its whole identity set). Every count must land on
    // the id whose price the sheet reads.
    for (const refCount of [0, 1, 2, 5]) {
      expect(resolveNormalizedImageGen({ provider: SHEET_PANEL_PROVIDER, refCount, swapToI2i: false }).identifier)
        .toBe(SHEET_PANEL_PROVIDER)
    }
  })
})
