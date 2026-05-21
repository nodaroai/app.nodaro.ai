import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/api", () => ({
  generateObjectMotion: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  }),
}))

vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "user-1" }))

import { MotionTab } from "../motion-tab"
import { generateObjectMotion } from "@/lib/api"
import { OBJECT_MOTION_PROVIDERS } from "@nodaro/shared"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectNodeData, ObjectAssetItem } from "@/types/nodes"

const MOTION_PRESETS = [
  "rotate-360",
  "hover",
  "spin-slow",
  "parallax",
  "pulse",
  "drift",
  "dolly-around",
  "push-in",
  "drone-orbit",
] as const

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

function renderTab(studio: ObjectStudioState) {
  return render(<MotionTab studio={studio} />)
}

describe("Object MotionTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders all 9 motion preset chips", () => {
    renderTab(makeStudio())
    for (const p of MOTION_PRESETS) {
      expect(screen.getByRole("button", { name: p })).toBeInTheDocument()
    }
  })

  it("provider picker offers all 8 OBJECT_MOTION_PROVIDERS (default kling-turbo)", () => {
    renderTab(makeStudio())
    const select = screen.getByLabelText(/^provider:/i) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe("kling-turbo")
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual([...OBJECT_MOTION_PROVIDERS])
    expect(optionValues.length).toBe(8)
  })

  it("aspect-ratio picker offers 4 values and defaults to 1:1 (product-showcase)", () => {
    renderTab(makeStudio())
    const select = screen.getByLabelText(/^aspect ratio:/i) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe("1:1")
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(["1:1", "3:4", "16:9", "9:16"])
  })

  it("preset chips disabled when sourceImageUrl is empty + shows banner", () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    expect(screen.getByText(/approve a main image first/i)).toBeInTheDocument()
    for (const p of MOTION_PRESETS) {
      expect(screen.getByRole("button", { name: p })).toBeDisabled()
    }
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
    expect(screen.getByLabelText(/^provider:/i)).toBeDisabled()
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

  it("fires generateObjectMotion with selected provider + motionPrompt + attach metadata", async () => {
    vi.mocked(generateObjectMotion).mockResolvedValueOnce({ jobId: "job-mot-1" })
    const studio = makeStudio()
    renderTab(studio)

    const select = screen.getByLabelText(/^provider:/i) as HTMLSelectElement
    await userEvent.selectOptions(select, "minimax")
    expect(select.value).toBe("minimax")

    await userEvent.click(screen.getByRole("button", { name: "rotate-360" }))

    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObjectMotion).toHaveBeenCalledTimes(1)
    expect(generateObjectMotion).toHaveBeenCalledWith(
      expect.objectContaining({
        motionPrompt: "rotate-360",
        sourceImageUrl: "https://example.com/main.png",
        provider: "minimax",
        aspectRatio: "1:1",
        name: "Vintage Lamp",
        category: "other",
        style: "realistic",
        attachToObjectId: "obj-uuid-1",
        attachName: "rotate-360",
      }),
    )
  })

  it("custom prompt fires generateObjectMotion with the typed text", async () => {
    vi.mocked(generateObjectMotion).mockResolvedValueOnce({ jobId: "job-mot-c" })
    renderTab(makeStudio())
    const input = screen.getByPlaceholderText(/custom motion prompt/i)
    await userEvent.type(input, "smoke swirling around the silhouette")
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateObjectMotion).toHaveBeenCalledWith(
      expect.objectContaining({
        motionPrompt: "smoke swirling around the silhouette",
        attachName: "smoke swirling around the silhouette",
      }),
    )
  })

  it("custom prompt clears after successful submit", async () => {
    vi.mocked(generateObjectMotion).mockResolvedValueOnce({ jobId: "job-mot-c" })
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
    const items: ObjectAssetItem[] = [
      { name: "rotate-360", url: "https://example.com/clip.mp4" },
    ]
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ motionClips: items }),
      }),
    )
    const card = screen.getByTestId("object-motion-card-0")
    const video = card.querySelector("video") as HTMLVideoElement
    expect(video).toBeInTheDocument()
    expect(video.getAttribute("preload")).toBe("metadata")
    expect(video.getAttribute("src")).toBe("https://example.com/clip.mp4")
    expect(card.textContent).toContain("rotate-360")
  })

  it("disabled when isApprovingMainImage is true", () => {
    renderTab(makeStudio({ isApprovingMainImage: true }))
    expect(screen.getByRole("button", { name: "rotate-360" })).toBeDisabled()
    expect(screen.getByLabelText(/^provider:/i)).toBeDisabled()
    expect(screen.getByPlaceholderText(/custom motion prompt/i)).toBeDisabled()
  })

  it("preset chips have 'approve a main image first' tooltip when sourceImageUrl is empty", () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    const chip = screen.getByRole("button", { name: "rotate-360" })
    expect(chip).toHaveAttribute("title", "Approve a main image first")
  })

  it("does not fire generateObjectMotion when sourceImageUrl is empty (defense-in-depth)", async () => {
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ sourceImageUrl: "" }),
      }),
    )
    const chip = screen.getByRole("button", { name: "rotate-360" })
    await userEvent.click(chip).catch(() => undefined)
    expect(generateObjectMotion).not.toHaveBeenCalled()
  })

  it("clicking Remove on a card patches motionClips minus that item", async () => {
    const items: ObjectAssetItem[] = [
      { name: "rotate-360", url: "https://example.com/a.mp4" },
      { name: "hover", url: "https://example.com/b.mp4" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ motionClips: items }),
    })
    renderTab(studio)
    const removeButtons = screen.getAllByRole("button", { name: /remove/i })
    expect(removeButtons.length).toBe(2)
    await userEvent.click(removeButtons[0])
    expect(studio.patch).toHaveBeenCalledWith({
      motionClips: [{ name: "hover", url: "https://example.com/b.mp4" }],
    })
  })

  it("Generate All queues missing presets (sequentially)", async () => {
    vi.mocked(generateObjectMotion).mockResolvedValue({ jobId: "job-x" })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const items: ObjectAssetItem[] = [
      { name: "rotate-360", url: "u1" },
    ]
    const studio = makeStudio({
      stagedData: makeStagedData({ motionClips: items }),
    })
    renderTab(studio)
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    // 9 presets - 1 existing = 8 missing → confirm fires + 8 gens.
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(generateObjectMotion).toHaveBeenCalledTimes(8)
  })

  it("Generate All toasts info when all presets are already generated", async () => {
    const items: ObjectAssetItem[] = MOTION_PRESETS.map((name) => ({
      name,
      url: `https://example.com/${name}.mp4`,
    }))
    renderTab(
      makeStudio({
        stagedData: makeStagedData({ motionClips: items }),
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: /generate all/i }))
    expect(generateObjectMotion).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledWith("All presets already generated")
  })
})
