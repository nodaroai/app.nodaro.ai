/**
 * The Studio Sheet tab's cost readouts quote the live charged prices: each
 * missing panel at the panel model's price, plus the flat compose fee. They
 * used to read fixed constants (1 per panel, 4 to compose) that the credit
 * re-denomination left ten-fold stale.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { ALA_CARTE_BOARDS, SHEET_PRESETS, estimateSheetCost, type SheetFlavour } from "@nodaro/shared"
import { localizeOptionLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"

vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))

// Live charged price per credit id; 0 is "not loaded yet".
const prices = vi.hoisted(() => ({ byId: {} as Record<string, number> }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: (id: string | undefined) => (id ? prices.byId[id] ?? 0 : 0),
}))

vi.mock("@/lib/api", () => ({
  generateReferenceSheet: vi.fn(),
  getJobStatusLean: vi.fn(),
  generateCharacterAsset: vi.fn(),
  generateObjectAsset: vi.fn(),
  generateLocationAsset: vi.fn(),
}))
vi.mock("../sheet-gallery", () => ({ SheetGallery: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CharacterSheetPanel } from "../character-sheet-panel"
import { SHEET_TAB_ADAPTERS } from "../sheet-tab-adapter"

const staged = {
  name: "Kaia",
  sourceImageUrl: "https://img/kaia.png",
  angles: [], bodyAngles: [], expressions: [], poses: [],
  lightingVariations: [], detailCloseups: [], outfitVariations: [], sheets: [],
}

/** What the default preset (Studio·Main, no boards, nothing prepared) plans. */
function studioMainMissing(): number {
  const preset = SHEET_PRESETS.find((p) => p.id === "studio-main")!
  const sections = preset.baseSections.map((s) => ({ ...s }))
  const flavour: SheetFlavour = {
    outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey",
    presetId: "studio-main", sections,
  }
  return estimateSheetCost("character", sections, flavour, {}, "Kaia", 1, 0).missing.length
}

function renderPanel() {
  return render(
    <CharacterSheetPanel adapter={SHEET_TAB_ADAPTERS.character} studio={{ staged }} jobs={{}} accent="#ff0073" />,
  )
}

describe("CharacterSheetPanel cost readouts", () => {
  beforeEach(() => {
    prices.byId = { "gpt-image-2": 15, "reference-sheet:assembly": 40 }
  })

  it("prices each missing panel and the compose fee at their live prices", () => {
    const missing = studioMainMissing()
    expect(missing).toBeGreaterThan(0)

    renderPanel()

    expect(screen.getByText(`Reuses 0 existing · ${missing} missing → Prepare ~${missing * 15} cr · Compose 40 cr`)).toBeTruthy()
    expect(screen.getByText(`${missing} to generate → ~${missing * 15 + 40} cr`)).toBeTruthy()
  })

  it("shows no price until both live prices have loaded", () => {
    prices.byId = { "gpt-image-2": 15 } // the compose price is still loading

    renderPanel()

    expect(screen.queryByText(/Prepare ~/)).toBeNull()
    expect(screen.queryByText(/to generate →/)).toBeNull()
  })
})

describe("CharacterSheetPanel in another language", () => {
  afterEach(() => act(() => useLocaleStore.getState().setLocale("en")))

  it("names the presets, their descriptions and the boards in the interface language", () => {
    act(() => useLocaleStore.getState().setLocale("ja"))
    renderPanel()
    for (const p of SHEET_PRESETS) {
      expect(screen.getByText(localizeOptionLabel(p.label, "ja"))).toBeTruthy()
      expect(screen.getByText(localizeOptionLabel(p.description, "ja"))).toBeTruthy()
      expect(screen.queryByText(p.label)).toBeNull()
    }
    expect(screen.getByText("スタジオ · メイン")).toBeTruthy()
    expect(screen.getByRole("button", { name: "パレット" })).toBeTruthy()
    for (const b of ALA_CARTE_BOARDS) {
      expect(screen.queryByText(new RegExp(`^${b.label}( \\+\\d+)?$`))).toBeNull()
    }
  })
})
