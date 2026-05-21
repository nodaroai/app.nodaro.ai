import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/api", () => ({
  generateObjectAsset: vi.fn(),
  getJobStatusBatch: vi.fn().mockResolvedValue({ jobs: [] }),
  ConcurrentModificationError: class ConcurrentModificationError extends Error {},
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

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  }),
}))

vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "user-1" }))

import { ObjectAssetTab } from "../object-asset-tab"
import { generateObjectAsset } from "@/lib/api"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectAssetItem, ObjectNodeData } from "@/types/nodes"

function makeStagedData(overrides: Partial<ObjectNodeData> = {}): ObjectNodeData {
  return {
    label: "Object",
    objectDbId: "obj-uuid-1",
    objectName: "Vintage Lamp",
    description: "Brass Edison lamp",
    category: "other",
    style: "realistic",
    sourceImageUrl: "https://example.com/main.png",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    materials: [],
    variations: [],
    anglesStatus: "idle",
    materialsStatus: "idle",
    variationsStatus: "idle",
    customVariations: [],
    motionClips: [],
    motionStatus: "idle",
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    ...overrides,
  } as unknown as ObjectNodeData
}

function makeStudio(overrides: Partial<ObjectStudioState> = {}): ObjectStudioState {
  return {
    stagedData: makeStagedData(),
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("obj-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("obj-uuid-1"),
    approveMainImage: vi.fn().mockResolvedValue({ sourceImageUrl: "", canonicalDescription: "" }),
    ...overrides,
  }
}

const ANGLES_PRESETS = ["front", "side", "top"] as const

function renderAngles(studio: ObjectStudioState, presets: readonly string[] = ANGLES_PRESETS) {
  return render(
    <ObjectAssetTab
      studio={studio}
      tabKind="angles"
      presets={presets}
      iconLabel="📐 Angles"
    />,
  )
}

describe("ObjectAssetTab", () => {
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
    renderAngles(makeStudio())
    expect(screen.getByRole("button", { name: "front" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "side" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "top" })).toBeInTheDocument()
  })

  it("clicking a preset chip fires generateObjectAsset with attach metadata", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValueOnce({ jobId: "job-front" })
    const studio = makeStudio()
    renderAngles(studio)
    await userEvent.click(screen.getByRole("button", { name: "front" }))
    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "angles",
        variant: "front",
        name: "Vintage Lamp",
        category: "other",
        style: "realistic",
        // styleLock: false (default) → sourceImageUrl is "" (object-specific)
        sourceImageUrl: "",
        attachToObjectId: "obj-uuid-1",
        attachToColumn: "angles",
        attachName: "front",
      }),
    )
  })

  it("passes sourceImageUrl only when styleLock is true", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValueOnce({ jobId: "job-front" })
    const studio = makeStudio({
      stagedData: makeStagedData({ styleLock: true }),
    })
    renderAngles(studio)
    await userEvent.click(screen.getByRole("button", { name: "front" }))
    expect(generateObjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({ sourceImageUrl: "https://example.com/main.png" }),
    )
  })

  it("disabled when isApprovingMainImage is true", () => {
    renderAngles(makeStudio({ isApprovingMainImage: true }))
    expect(screen.getByRole("button", { name: "front" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /generate all/i })).toBeDisabled()
    expect(screen.getByPlaceholderText(/custom prompt/i)).toBeDisabled()
  })

  it("Generate All queues only the missing presets", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValue({ jobId: "job-x" })
    const existingItems: ObjectAssetItem[] = [
      { name: "front", url: "https://example.com/front.png" },
      { name: "side", url: "https://example.com/side.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ angles: existingItems }),
    })
    renderAngles(studio)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(generateObjectAsset).toHaveBeenCalledTimes(1)
    expect(generateObjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "top" }),
    )
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it("Generate All toasts info when nothing is missing", async () => {
    const existingItems: ObjectAssetItem[] = [
      { name: "front", url: "u1" },
      { name: "side", url: "u2" },
      { name: "top", url: "u3" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ angles: existingItems }),
    })
    renderAngles(studio)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(generateObjectAsset).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledWith("All presets already generated")
  })

  it("Generate All asks for confirmation when 4+ presets are missing", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValue({ jobId: "job-x" })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const fivePresets = ["a", "b", "c", "d", "e"] as const
    renderAngles(makeStudio(), fivePresets)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toMatch(/5/)
    expect(generateObjectAsset).toHaveBeenCalledTimes(5)
  })

  it("custom prompt fires generateObjectAsset with assetType: 'custom' + userPrompt + attachToColumn", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValueOnce({ jobId: "job-custom" })
    const studio = makeStudio()
    renderAngles(studio)
    const input = screen.getByPlaceholderText(/custom prompt/i)
    await userEvent.type(input, "macro shot of filigree detail")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateObjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "custom",
        variant: "macro shot of filigree detail",
        userPrompt: "macro shot of filigree detail",
        attachToObjectId: "obj-uuid-1",
        attachToColumn: "angles",
        attachName: "macro shot of filigree detail",
      }),
    )
  })

  it("custom prompt rejects empty input", async () => {
    renderAngles(makeStudio())
    const button = screen.getByRole("button", { name: /^generate$/i })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(generateObjectAsset).not.toHaveBeenCalled()
  })

  it("custom prompt rejects > 2000 chars", async () => {
    renderAngles(makeStudio())
    const input = screen.getByPlaceholderText(/custom prompt/i)
    fireEvent.change(input, { target: { value: "a".repeat(2001) } })
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(toastError).toHaveBeenCalledWith("Custom prompt is too long (max 2000 chars)")
    expect(generateObjectAsset).not.toHaveBeenCalled()
  })

  it("asset cards render existing items from the bucket array", () => {
    const existingItems: ObjectAssetItem[] = [
      { name: "front", url: "https://example.com/front.png" },
      { name: "side", url: "https://example.com/side.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ angles: existingItems }),
    })
    renderAngles(studio)
    expect(screen.getByAltText("front")).toBeInTheDocument()
    expect(screen.getByAltText("side")).toBeInTheDocument()
  })

  it("clicking Remove on a card patches the staged bucket minus that item", async () => {
    const existingItems: ObjectAssetItem[] = [
      { name: "front", url: "https://example.com/front.png" },
      { name: "side", url: "https://example.com/side.png" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ angles: existingItems }),
    })
    renderAngles(studio)
    const removeButtons = screen.getAllByRole("button", { name: /remove/i })
    expect(removeButtons.length).toBe(2)
    await userEvent.click(removeButtons[0])
    expect(studio.patch).toHaveBeenCalledWith({
      angles: [{ name: "side", url: "https://example.com/side.png" }],
    })
  })

  it("shows empty-state copy when no items and no in-flight jobs", () => {
    renderAngles(makeStudio())
    expect(screen.getByText(/no angles variants yet/i)).toBeInTheDocument()
  })

  it("custom prompt clears after successful submit", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValueOnce({ jobId: "job-custom" })
    renderAngles(makeStudio())
    const input = screen.getByPlaceholderText(/custom prompt/i) as HTMLInputElement
    await userEvent.type(input, "macro filigree")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(input.value).toBe("")
  })
})

// Material catalog browser — UNIQUE Materials-tab affordance.
describe("ObjectAssetTab — Material catalog browser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderMaterials(studio: ObjectStudioState) {
    return render(
      <ObjectAssetTab
        studio={studio}
        tabKind="materials"
        presets={["wood", "metal"]}
        iconLabel="🧪 Materials"
      />,
    )
  }

  it("renders the material catalog browser when tabKind === 'materials'", () => {
    renderMaterials(makeStudio())
    expect(screen.getByTestId("material-catalog-browser")).toBeInTheDocument()
    expect(screen.getByText(/browse material catalog/i)).toBeInTheDocument()
  })

  it("does NOT render the material catalog browser when tabKind === 'angles'", () => {
    renderAngles(makeStudio())
    expect(screen.queryByTestId("material-catalog-browser")).not.toBeInTheDocument()
  })

  it("does NOT render the material catalog browser when tabKind === 'variations'", () => {
    render(
      <ObjectAssetTab
        studio={makeStudio()}
        tabKind="variations"
        presets={["clean"]}
        iconLabel="✨ Variations"
      />,
    )
    expect(screen.queryByTestId("material-catalog-browser")).not.toBeInTheDocument()
  })

  it("renders catalog material buttons grouped by category", () => {
    renderMaterials(makeStudio())
    // From the MATERIALS catalog: silk, gold, marble (different categories)
    expect(screen.getByRole("button", { name: "Silk" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Gold" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Marble" })).toBeInTheDocument()
    // Category headings
    expect(screen.getByText(/^Fabric$/)).toBeInTheDocument()
    expect(screen.getByText(/^Metal$/)).toBeInTheDocument()
    expect(screen.getByText(/^Stone$/)).toBeInTheDocument()
  })

  it("clicking a catalog material fires generateObjectAsset with custom + userPrompt + seedPromptHint", async () => {
    vi.mocked(generateObjectAsset).mockResolvedValueOnce({ jobId: "job-mat" })
    const studio = makeStudio()
    renderMaterials(studio)
    await userEvent.click(screen.getByRole("button", { name: "Gold" }))
    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "custom",
        variant: "Gold",
        userPrompt: "Gold",
        attachToObjectId: "obj-uuid-1",
        attachToColumn: "materials",
        attachName: "Gold",
        // seedPromptHint is the catalog entry's promptHint, NOT empty.
        seedPromptHint: expect.stringMatching(/polished gold/i),
      }),
    )
  })

  it("catalog material buttons are disabled when isApprovingMainImage is true", () => {
    renderMaterials(makeStudio({ isApprovingMainImage: true }))
    expect(screen.getByRole("button", { name: "Gold" })).toBeDisabled()
  })
})
