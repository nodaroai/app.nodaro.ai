import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Hoisted API + sonner mocks.
vi.mock("@/lib/api", () => ({
  generateLocationAsset: vi.fn(),
  getJobStatusBatch: vi.fn().mockResolvedValue({ jobs: [] }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastInfo = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}))

import { EnvironmentalAssetTab } from "../environmental-asset-tab"
import { generateLocationAsset } from "@/lib/api"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationNodeData, LocationAssetItem } from "@/types/nodes"

function makeStagedData(overrides: Partial<LocationNodeData> = {}): LocationNodeData {
  return {
    label: "Location",
    locationDbId: "loc-uuid-1",
    locationName: "Cafe Roma",
    description: "Cozy interior",
    category: "indoor",
    style: "realistic",
    sourceImageUrl: "https://example.com/main.png",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    timeOfDay: [],
    weather: [],
    angles: [],
    lighting: [],
    lightingStatus: "idle",
    seasons: [],
    seasonsStatus: "idle",
    atmosphereMotions: [],
    atmosphereStatus: "idle",
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    timeOfDayStatus: "idle",
    weatherStatus: "idle",
    anglesStatus: "idle",
    customVariations: [],
    ...overrides,
  } as unknown as LocationNodeData
}

function makeStudio(overrides: Partial<LocationStudioState> = {}): LocationStudioState {
  return {
    stagedData: makeStagedData(),
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("loc-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("loc-uuid-1"),
    ...overrides,
  }
}

const LIGHTING_PRESETS = ["neon", "candlelit", "cinematic"] as const

function renderTab(studio: LocationStudioState, presets: readonly string[] = LIGHTING_PRESETS) {
  return render(
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="lighting"
      presets={presets}
      iconLabel="Lighting"
    />,
  )
}

describe("EnvironmentalAssetTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders preset chips for the configured bucket", () => {
    renderTab(makeStudio())
    expect(screen.getByRole("button", { name: "neon" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "candlelit" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "cinematic" })).toBeInTheDocument()
  })

  it("clicking a preset chip fires generateLocationAsset with attach metadata", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValueOnce({ jobId: "job-neon" })
    const studio = makeStudio()
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: "neon" }))
    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateLocationAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "lighting",
        variant: "neon",
        name: "Cafe Roma",
        category: "indoor",
        style: "realistic",
        // styleLock: false (default) → sourceImageUrl is omitted so the worker
        // falls back to text-only generation.
        sourceImageUrl: undefined,
        attachToLocationId: "loc-uuid-1",
        attachToColumn: "lighting",
        attachName: "neon",
      }),
    )
  })

  it("passes sourceImageUrl only when styleLock is true", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValueOnce({ jobId: "job-neon" })
    const studio = makeStudio({
      stagedData: makeStagedData({ styleLock: true }),
    })
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: "neon" }))
    expect(generateLocationAsset).toHaveBeenCalledWith(
      expect.objectContaining({ sourceImageUrl: "https://example.com/main.png" }),
    )
  })

  it("disabled when isApprovingMainImage is true", () => {
    renderTab(makeStudio({ isApprovingMainImage: true }))
    expect(screen.getByRole("button", { name: "neon" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /generate all/i })).toBeDisabled()
    expect(screen.getByPlaceholderText(/custom prompt/i)).toBeDisabled()
  })

  it("Generate All queues only the missing presets", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValue({ jobId: "job-x" })
    const existingItems: LocationAssetItem[] = [
      { name: "neon", url: "https://example.com/neon.png" },
      { name: "candlelit", url: "https://example.com/candle.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ lighting: existingItems }),
    })
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    // Only "cinematic" is missing → exactly 1 call fired
    expect(generateLocationAsset).toHaveBeenCalledTimes(1)
    expect(generateLocationAsset).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "cinematic" }),
    )
    // <4 missing → no window.confirm prompt
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it("Generate All toasts info when nothing is missing", async () => {
    const existingItems: LocationAssetItem[] = [
      { name: "neon", url: "u1" },
      { name: "candlelit", url: "u2" },
      { name: "cinematic", url: "u3" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ lighting: existingItems }),
    })
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(generateLocationAsset).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledWith("All presets already generated")
  })

  it("Generate All asks for confirmation when 4+ presets are missing", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValue({ jobId: "job-x" })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const fivePresets = ["a", "b", "c", "d", "e"] as const
    renderTab(makeStudio(), fivePresets)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toMatch(/5/)
    expect(generateLocationAsset).toHaveBeenCalledTimes(5)
  })

  it("Generate All respects confirmation cancel", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValue({ jobId: "job-x" })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    const fivePresets = ["a", "b", "c", "d", "e"] as const
    renderTab(makeStudio(), fivePresets)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(generateLocationAsset).not.toHaveBeenCalled()
  })

  it("custom prompt fires generateLocationAsset with assetType: 'custom' + userPrompt + attachToColumn", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValueOnce({ jobId: "job-custom" })
    const studio = makeStudio()
    renderTab(studio)
    const input = screen.getByPlaceholderText(/custom prompt/i)
    await userEvent.type(input, "warehouse with disco ball")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateLocationAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "custom",
        variant: "warehouse with disco ball",
        userPrompt: "warehouse with disco ball",
        attachToLocationId: "loc-uuid-1",
        attachToColumn: "lighting",
        attachName: "warehouse with disco ball",
      }),
    )
  })

  it("custom prompt rejects empty input", async () => {
    const studio = makeStudio()
    renderTab(studio)
    const button = screen.getByRole("button", { name: /^generate$/i })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(generateLocationAsset).not.toHaveBeenCalled()
  })

  it("custom prompt rejects > 2000 chars", async () => {
    const studio = makeStudio()
    renderTab(studio)
    const input = screen.getByPlaceholderText(/custom prompt/i)
    // userEvent.type is slow on huge strings; populate via fireEvent.change
    fireEvent.change(input, { target: { value: "a".repeat(2001) } })
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(toastError).toHaveBeenCalledWith("Custom prompt is too long (max 2000 chars)")
    expect(generateLocationAsset).not.toHaveBeenCalled()
  })

  it("asset cards render existing items from the bucket array", () => {
    const existingItems: LocationAssetItem[] = [
      { name: "neon", url: "https://example.com/neon.png" },
      { name: "candlelit", url: "https://example.com/candle.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ lighting: existingItems }),
    })
    renderTab(studio)
    expect(screen.getByAltText("neon")).toBeInTheDocument()
    expect(screen.getByAltText("candlelit")).toBeInTheDocument()
  })

  it("clicking ✕ on a card patches the staged bucket minus that item", async () => {
    const existingItems: LocationAssetItem[] = [
      { name: "neon", url: "https://example.com/neon.png" },
      { name: "candlelit", url: "https://example.com/candle.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ lighting: existingItems }),
    })
    renderTab(studio)
    const removeButtons = screen.getAllByRole("button", { name: /remove/i })
    expect(removeButtons.length).toBe(2)
    await userEvent.click(removeButtons[0])
    expect(studio.patch).toHaveBeenCalledWith({
      lighting: [{ name: "candlelit", url: "https://example.com/candle.png" }],
    })
  })

  it("auto-saves before gen when locationDbId is empty (ensureSavedBeforeGen returns fresh id)", async () => {
    const ensureSavedBeforeGen = vi.fn().mockResolvedValue("fresh-uuid")
    vi.mocked(generateLocationAsset).mockResolvedValueOnce({ jobId: "job-1" })
    const studio = makeStudio({
      ensureSavedBeforeGen,
      stagedData: makeStagedData({ locationDbId: "" }),
    })
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: "neon" }))
    expect(ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    // ensureSavedBeforeGen resolves BEFORE generateLocationAsset is invoked,
    // and its returned id is forwarded as attachToLocationId.
    expect(generateLocationAsset).toHaveBeenCalledWith(
      expect.objectContaining({ attachToLocationId: "fresh-uuid" }),
    )
    // Ordering: ensureSavedBeforeGen must be called first.
    const ensureOrder = ensureSavedBeforeGen.mock.invocationCallOrder[0]
    const genOrder = vi.mocked(generateLocationAsset).mock.invocationCallOrder[0]
    expect(ensureOrder).toBeLessThan(genOrder)
  })

  it("shows empty-state copy when no items and no in-flight jobs", () => {
    renderTab(makeStudio())
    expect(screen.getByText(/no lighting variants yet/i)).toBeInTheDocument()
  })

  it("custom prompt clears after successful submit", async () => {
    vi.mocked(generateLocationAsset).mockResolvedValueOnce({ jobId: "job-custom" })
    renderTab(makeStudio())
    const input = screen.getByPlaceholderText(/custom prompt/i) as HTMLInputElement
    await userEvent.type(input, "moody back-alley")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(input.value).toBe("")
  })
})

// Locale smoke test — separate suite so we can swap the useLocalizedCatalog
// mock without polluting the default-locale suite above. We import the
// component lazily after registering the mock to ensure the patched hook is
// the one the module captures.
describe("EnvironmentalAssetTab (i18n)", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.doUnmock("@/hooks/use-localized-entry")
    vi.restoreAllMocks()
  })

  it("renders localized preset chip labels from the canonical lighting catalog", async () => {
    // Mock the hook to return a French-style translation map for the lighting
    // bucket. Catalog entry ids come from the LOCATION_PRESET_TO_CATALOG
    // adapter: neon → neon-night, candlelit → candlelight, cinematic →
    // three-point. The English preset strings remain the load-bearing values
    // forwarded to generateLocationAsset (`variant` + `attachName`).
    const TRANSLATIONS: Record<string, string> = {
      "neon-night": "Néon",
      "candlelight": "Bougies",
      "three-point": "Cinématique",
    }
    vi.doMock("@/hooks/use-localized-entry", () => ({
      useLocalizedCatalog: () => ({
        locale: "fr",
        resolveLabel: (id: string, englishLabel: string) =>
          TRANSLATIONS[id] ?? englishLabel,
        resolveDescription: (_id: string, englishDescription: string) =>
          englishDescription,
        matches: () => true,
      }),
    }))

    const { EnvironmentalAssetTab: LocalizedTab } = await import(
      "../environmental-asset-tab"
    )
    const { generateLocationAsset: localizedApi } = await import("@/lib/api")
    const studio = makeStudio()
    render(
      <LocalizedTab
        studio={studio}
        bucketName="lighting"
        presets={["neon", "candlelit", "cinematic"]}
        iconLabel="Lighting"
      />,
    )

    // Localized labels are rendered.
    expect(screen.getByRole("button", { name: "Néon" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bougies" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Cinématique" }),
    ).toBeInTheDocument()
    // Plain English chip names should NOT appear.
    expect(screen.queryByRole("button", { name: "neon" })).not.toBeInTheDocument()

    // Click the localized chip — the variant + attachName sent to backend
    // MUST still be the canonical English preset string, since that's what
    // backend VARIANTS validates and what gets stored in `attach_name`.
    vi.mocked(localizedApi).mockResolvedValueOnce({ jobId: "job-localized" })
    await userEvent.click(screen.getByRole("button", { name: "Néon" }))
    expect(localizedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "neon",
        attachName: "neon",
        assetType: "lighting",
      }),
    )
  })

  it("falls back to English preset string when no translation exists", async () => {
    // Translation map covers only one key; the other two should fall back.
    vi.doMock("@/hooks/use-localized-entry", () => ({
      useLocalizedCatalog: () => ({
        locale: "fr",
        resolveLabel: (id: string, englishLabel: string) =>
          id === "neon-night" ? "Néon" : englishLabel,
        resolveDescription: (_id: string, englishDescription: string) =>
          englishDescription,
        matches: () => true,
      }),
    }))

    const { EnvironmentalAssetTab: LocalizedTab } = await import(
      "../environmental-asset-tab"
    )
    render(
      <LocalizedTab
        studio={makeStudio()}
        bucketName="lighting"
        presets={["neon", "candlelit", "cinematic"]}
        iconLabel="Lighting"
      />,
    )

    expect(screen.getByRole("button", { name: "Néon" })).toBeInTheDocument()
    // Fallback: English preset strings still render for unmapped keys.
    expect(
      screen.getByRole("button", { name: "candlelit" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "cinematic" }),
    ).toBeInTheDocument()
  })
})
