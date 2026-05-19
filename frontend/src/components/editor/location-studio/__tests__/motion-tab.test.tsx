import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Hoisted API + sonner mocks.
vi.mock("@/lib/api", () => ({
  generateLocationMotion: vi.fn(),
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

import { MotionTab } from "../motion-tab"
import { generateLocationMotion } from "@/lib/api"
import { LOCATION_ATMOSPHERE_PROVIDERS } from "@nodaro/shared"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationNodeData, LocationAssetItem } from "@/types/nodes"

const MOTION_PRESETS = [
  "slow dolly-in",
  "slow pan-left",
  "slow pan-right",
  "push up",
  "drone fly-over",
  "gentle drift",
  "parallax",
  "static atmospheric",
] as const

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
    approveMainImage: vi.fn().mockResolvedValue({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "",
    }),
    ...overrides,
  }
}

function renderTab(studio: LocationStudioState) {
  return render(<MotionTab studio={studio} />)
}

describe("MotionTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders all 8 motion presets as chips", () => {
    renderTab(makeStudio())
    for (const p of MOTION_PRESETS) {
      expect(screen.getByRole("button", { name: p })).toBeInTheDocument()
    }
  })

  it("provider picker offers all 6 LOCATION_ATMOSPHERE_PROVIDERS", () => {
    renderTab(makeStudio())
    const select = screen.getByLabelText(/provider/i) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual([...LOCATION_ATMOSPHERE_PROVIDERS])
    expect(optionValues.length).toBe(6)
  })

  it("preset chips disabled when sourceImageUrl is empty + shows banner", () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    // Banner copy from the plan
    expect(
      screen.getByText(/approve a main image first/i),
    ).toBeInTheDocument()
    // All preset chips disabled
    for (const p of MOTION_PRESETS) {
      expect(screen.getByRole("button", { name: p })).toBeDisabled()
    }
    // Generate (custom prompt submit) disabled
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
    // Provider picker disabled
    expect(screen.getByLabelText(/provider/i)).toBeDisabled()
  })

  it("Generate (custom prompt) disabled when sourceImageUrl is empty", () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    const generate = screen.getByRole("button", { name: /^generate$/i })
    expect(generate).toBeDisabled()
  })

  it("fires generateLocationMotion with selected provider + motionPrompt + attach metadata", async () => {
    vi.mocked(generateLocationMotion).mockResolvedValueOnce({ jobId: "job-mot-1" })
    const studio = makeStudio()
    renderTab(studio)

    // Pick a non-default provider
    const select = screen.getByLabelText(/provider/i) as HTMLSelectElement
    await userEvent.selectOptions(select, "wan-2.7-i2v")
    expect(select.value).toBe("wan-2.7-i2v")

    await userEvent.click(screen.getByRole("button", { name: "drone fly-over" }))

    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateLocationMotion).toHaveBeenCalledTimes(1)
    expect(generateLocationMotion).toHaveBeenCalledWith(
      expect.objectContaining({
        motionPrompt: "drone fly-over",
        sourceImageUrl: "https://example.com/main.png",
        provider: "wan-2.7-i2v",
        name: "Cafe Roma",
        category: "indoor",
        style: "realistic",
        attachToLocationId: "loc-uuid-1",
        attachToColumn: "atmosphere_motions",
        attachName: "drone fly-over",
      }),
    )
  })

  it("custom prompt fires generateLocationMotion with the typed text", async () => {
    vi.mocked(generateLocationMotion).mockResolvedValueOnce({ jobId: "job-mot-c" })
    const studio = makeStudio()
    renderTab(studio)
    const input = screen.getByPlaceholderText(/custom motion prompt/i)
    await userEvent.type(input, "rain swirling around a streetlight")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateLocationMotion).toHaveBeenCalledWith(
      expect.objectContaining({
        motionPrompt: "rain swirling around a streetlight",
        attachName: "rain swirling around a streetlight",
        attachToColumn: "atmosphere_motions",
      }),
    )
  })

  it("custom prompt clears after successful submit", async () => {
    vi.mocked(generateLocationMotion).mockResolvedValueOnce({ jobId: "job-mot-c" })
    renderTab(makeStudio())
    const input = screen.getByPlaceholderText(/custom motion prompt/i) as HTMLInputElement
    await userEvent.type(input, "ambient mist")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(input.value).toBe("")
  })

  it("video cards render with preload=metadata and asset name overlay", () => {
    const items: LocationAssetItem[] = [
      { name: "drone fly-over", url: "https://example.com/clip.mp4" },
    ]
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ atmosphereMotions: items }),
      }),
    )
    const card = screen.getByTestId("motion-card-0")
    const video = card.querySelector("video") as HTMLVideoElement
    expect(video).toBeInTheDocument()
    expect(video.getAttribute("preload")).toBe("metadata")
    expect(video.getAttribute("src")).toBe("https://example.com/clip.mp4")
    // Overlay caption lives inside the card so we scope the query to it —
    // the same string is also the preset chip's button text outside the card.
    expect(card.textContent).toContain("drone fly-over")
  })

  it("disabled when isApprovingMainImage is true", () => {
    renderTab(makeStudio({ isApprovingMainImage: true }))
    expect(screen.getByRole("button", { name: "drone fly-over" })).toBeDisabled()
    expect(screen.getByLabelText(/provider/i)).toBeDisabled()
    expect(screen.getByPlaceholderText(/custom motion prompt/i)).toBeDisabled()
  })

  it("preset chips have 'approve a main image first' tooltip when sourceImageUrl is empty", () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    const chip = screen.getByRole("button", { name: "drone fly-over" })
    expect(chip).toHaveAttribute("title", "Approve a main image first")
  })

  it("does not fire generateLocationMotion when sourceImageUrl is empty (defense-in-depth)", async () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    // Try to click anyway (button is disabled so userEvent should no-op, but
    // even with a forced click no call should fire).
    const chip = screen.getByRole("button", { name: "drone fly-over" })
    await userEvent.click(chip).catch(() => undefined)
    expect(generateLocationMotion).not.toHaveBeenCalled()
  })
})

// Phase 2 #11 — Search/filter inside Location Studio asset grids (motion).
describe("MotionTab — search/filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("hides the search input when total count <= 10", () => {
    // 0 items + 0 tracked + 8 presets = 8 → search hidden.
    renderTab(makeStudio())
    expect(
      screen.queryByPlaceholderText(/search atmosphere motions/i),
    ).not.toBeInTheDocument()
  })

  it("shows the search input when total count > 10", () => {
    // Push the items list past the threshold: 4 items + 8 presets = 12 > 10.
    const fourItems: LocationAssetItem[] = [
      { name: "clip-a", url: "https://example.com/a.mp4" },
      { name: "clip-b", url: "https://example.com/b.mp4" },
      { name: "clip-c", url: "https://example.com/c.mp4" },
      { name: "clip-d", url: "https://example.com/d.mp4" },
    ]
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ atmosphereMotions: fourItems }),
      }),
    )
    expect(
      screen.getByPlaceholderText(/search atmosphere motions/i),
    ).toBeInTheDocument()
  })

  it("typing in search filters preset chips by name (case-insensitive)", async () => {
    // Cross the threshold by passing in 4 items.
    const fourItems: LocationAssetItem[] = [
      { name: "clip-a", url: "https://example.com/a.mp4" },
      { name: "clip-b", url: "https://example.com/b.mp4" },
      { name: "clip-c", url: "https://example.com/c.mp4" },
      { name: "clip-d", url: "https://example.com/d.mp4" },
    ]
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ atmosphereMotions: fourItems }),
      }),
    )
    const search = screen.getByPlaceholderText(/search atmosphere motions/i)
    await userEvent.type(search, "PAN")
    // "slow pan-left" + "slow pan-right" contain "pan".
    expect(screen.getByRole("button", { name: "slow pan-left" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "slow pan-right" })).toBeInTheDocument()
    // Others should be filtered out.
    expect(screen.queryByRole("button", { name: "drone fly-over" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "static atmospheric" })).not.toBeInTheDocument()
  })

  it("zero-results message renders with a Clear button", async () => {
    const fourItems: LocationAssetItem[] = [
      { name: "clip-a", url: "https://example.com/a.mp4" },
      { name: "clip-b", url: "https://example.com/b.mp4" },
      { name: "clip-c", url: "https://example.com/c.mp4" },
      { name: "clip-d", url: "https://example.com/d.mp4" },
    ]
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ atmosphereMotions: fourItems }),
      }),
    )
    const search = screen.getByPlaceholderText(/search atmosphere motions/i)
    await userEvent.type(search, "zzznope")
    expect(screen.getByText(/no matches for "zzznope"/i)).toBeInTheDocument()
    // Clear button inside the zero-results banner.
    const clearButtons = screen.getAllByRole("button", { name: /clear/i })
    expect(clearButtons.length).toBeGreaterThanOrEqual(1)
  })
})

// Locale smoke test — separate suite so we can swap the useLocalizedCatalog
// mock without polluting the default-locale suite above. We import the
// component lazily after registering the mock to ensure the patched hook is
// the one the module captures.
describe("MotionTab (i18n)", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.doUnmock("@/hooks/use-localized-entry")
    vi.restoreAllMocks()
  })

  it("renders localized motion preset chip labels", async () => {
    // Catalog ids come from the LOCATION_PRESET_TO_CATALOG adapter, mapping
    // each backend motion preset to the canonical `camera-motions` entry id.
    const TRANSLATIONS: Record<string, string> = {
      "dolly-in":     "Travelling avant lent",
      "pan-left":     "Pano gauche lent",
      "pan-right":    "Pano droite lent",
      "pedestal-up":  "Poussée vers le haut",
      "fly-over":     "Survol drone",
      "gentle-drift": "Dérive douce",
      "parallax":     "Parallaxe",
      "static":       "Atmosphère statique",
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

    const { MotionTab: LocalizedMotionTab } = await import("../motion-tab")
    const { generateLocationMotion: localizedApi } = await import("@/lib/api")
    const studio = makeStudio()
    render(<LocalizedMotionTab studio={studio} />)

    // All 8 localized labels render.
    for (const localized of Object.values(TRANSLATIONS)) {
      expect(screen.getByRole("button", { name: localized })).toBeInTheDocument()
    }
    // No raw English preset names should leak through.
    expect(
      screen.queryByRole("button", { name: "drone fly-over" }),
    ).not.toBeInTheDocument()

    // Clicking a localized chip must still send the canonical English motion
    // preset to backend — that's the value the route stores and what every
    // downstream consumer expects.
    vi.mocked(localizedApi).mockResolvedValueOnce({ jobId: "job-mot-loc" })
    await userEvent.click(screen.getByRole("button", { name: "Survol drone" }))
    expect(localizedApi).toHaveBeenCalledWith(
      expect.objectContaining({
        motionPrompt: "drone fly-over",
        attachName: "drone fly-over",
        attachToColumn: "atmosphere_motions",
      }),
    )
  })

  it("falls back to English preset string when no translation exists", async () => {
    // Only 1 of 8 motion keys is mapped — the rest fall back.
    vi.doMock("@/hooks/use-localized-entry", () => ({
      useLocalizedCatalog: () => ({
        locale: "fr",
        resolveLabel: (id: string, englishLabel: string) =>
          id === "parallax" ? "Parallaxe" : englishLabel,
        resolveDescription: (_id: string, englishDescription: string) =>
          englishDescription,
        matches: () => true,
      }),
    }))

    const { MotionTab: LocalizedMotionTab } = await import("../motion-tab")
    render(<LocalizedMotionTab studio={makeStudio()} />)

    expect(screen.getByRole("button", { name: "Parallaxe" })).toBeInTheDocument()
    // English fallbacks for unmapped keys.
    expect(
      screen.getByRole("button", { name: "drone fly-over" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "slow dolly-in" }),
    ).toBeInTheDocument()
  })
})
