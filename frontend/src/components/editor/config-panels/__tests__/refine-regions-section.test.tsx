/**
 * RefineRegionsSection — grok-2 task-chained region editing in the Generate
 * Image panel.
 *
 * Contract under test:
 *  - Without a kieTaskId on the active result (or node), the section shows a
 *    re-run hint and never offers Detect (the edit endpoint can only
 *    reference a prior grok-2 generation's task id).
 *  - Detect runs a FREE grok-2-segment job for the ACTIVE result's task id
 *    and stores the zipped {index, name, maskUrl} list keyed by that task id.
 *  - A stored segment map whose taskId doesn't match the active result is
 *    STALE — the section offers a fresh Detect instead of rendering it.
 *  - Chips toggle grokSelectedSegments; Apply fires grok-2-edit with the
 *    sorted 1-based indexes (or none for a whole-image edit) through
 *    pollImageRefineToNode so the edit lands as a new node result version.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { RefineRegionsSection } from "../refine-regions-section"
import type { GenerateImageData } from "@/types/nodes"

const { grokSegmentMapMock, grokRegionEditMock, getJobStatusLeanMock, pollImageRefineToNodeMock } =
  vi.hoisted(() => ({
    grokSegmentMapMock: vi.fn(),
    grokRegionEditMock: vi.fn(),
    getJobStatusLeanMock: vi.fn(),
    pollImageRefineToNodeMock: vi.fn(),
  }))

vi.mock("@/lib/api", () => ({
  grokSegmentMap: grokSegmentMapMock,
  grokRegionEdit: grokRegionEditMock,
  getJobStatusLean: getJobStatusLeanMock,
}))

vi.mock("../../workflow-editor/poll-job", () => ({
  pollImageRefineToNode: pollImageRefineToNodeMock,
}))

function baseData(overrides: Partial<GenerateImageData> = {}): GenerateImageData {
  return {
    label: "Generate Image",
    prompt: "a robot",
    provider: "grok-2",
    model: "",
    style: "",
    aspectRatio: "16:9",
    negativePrompt: "",
    fieldMappings: {},
    generatedImageUrl: "https://r2.test/result.png",
    generatedResults: [
      {
        url: "https://r2.test/result.png",
        timestamp: "2026-08-18T00:00:00.000Z",
        jobId: "job-1",
        kieTaskId: "task_grok_123",
      },
    ],
    activeResultIndex: 0,
    ...overrides,
  } as GenerateImageData
}

const SEGMENT_OUTPUT = {
  imageUrl: "https://r2.test/mask-1.png",
  imageUrls: ["https://r2.test/mask-1.png", "https://r2.test/mask-2.png"],
  segments: [
    { index: 1, name: "sky" },
    { index: 2, name: "person" },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  pollImageRefineToNodeMock.mockResolvedValue("https://r2.test/edited.png")
})

afterEach(() => {
  vi.useRealTimers()
})

describe("RefineRegionsSection", () => {
  it("shows the re-run hint (no Detect) when neither the active result nor the node has a kieTaskId", () => {
    const data = baseData({
      generatedResults: [
        { url: "https://r2.test/result.png", timestamp: "2026-08-18T00:00:00.000Z", jobId: "job-1" },
      ],
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)
    expect(screen.getByText(/Run this node again to enable region editing/)).toBeTruthy()
    expect(screen.queryByText(/Detect regions/)).toBeNull()
  })

  it("detects regions for the active result's task id and stores the zipped segment map", async () => {
    vi.useFakeTimers()
    grokSegmentMapMock.mockResolvedValue({ jobId: "seg-job-1" })
    getJobStatusLeanMock.mockResolvedValue({ status: "completed", output_data: SEGMENT_OUTPUT })
    const onUpdate = vi.fn()
    render(<RefineRegionsSection nodeId="n1" data={baseData()} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByText(/Detect regions/))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(grokSegmentMapMock).toHaveBeenCalledWith("task_grok_123")
    expect(onUpdate).toHaveBeenCalledWith({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 1, name: "sky", maskUrl: "https://r2.test/mask-1.png" },
          { index: 2, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [],
    })
  })

  it("treats a segment map stored for a DIFFERENT task id as stale and offers Detect", () => {
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_OLD",
        segments: [{ index: 1, name: "sky", maskUrl: "https://r2.test/old-mask.png" }],
      },
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)
    expect(screen.getByText(/Detect regions/)).toBeTruthy()
    expect(screen.queryByText("sky")).toBeNull()
  })

  it("renders chips for a fresh segment map and toggles selection through onUpdate", () => {
    const onUpdate = vi.fn()
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 1, name: "sky", maskUrl: "https://r2.test/mask-1.png" },
          { index: 2, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [1],
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={onUpdate} />)

    // Selected chip renders pressed; a selected region paints its overlay.
    expect(screen.getByRole("button", { name: /sky/ }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("region-overlay-1")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /person/ }))
    expect(onUpdate).toHaveBeenCalledWith({ grokSelectedSegments: [1, 2] })

    fireEvent.click(screen.getByRole("button", { name: /sky/ }))
    expect(onUpdate).toHaveBeenCalledWith({ grokSelectedSegments: [] })
  })

  it("applies a region edit with the sorted selected indexes via pollImageRefineToNode", async () => {
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 1, name: "sky", maskUrl: "https://r2.test/mask-1.png" },
          { index: 2, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [2, 1],
      grokRegionPrompt: "make the sky stormy",
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByText(/Edit 2 regions/))
    await waitFor(() => expect(pollImageRefineToNodeMock).toHaveBeenCalledTimes(1))
    const [nodeId, apiCall, label] = pollImageRefineToNodeMock.mock.calls[0]
    expect(nodeId).toBe("n1")
    expect(label).toBe("Region edit")

    grokRegionEditMock.mockResolvedValue({ jobId: "edit-job-1" })
    await apiCall()
    expect(grokRegionEditMock).toHaveBeenCalledWith("task_grok_123", "make the sky stormy", [1, 2])
  })

  it("applies a whole-image edit (no maskIndexes) when nothing is selected, and disables Apply without a prompt", async () => {
    const segments = {
      taskId: "task_grok_123",
      segments: [{ index: 1, name: "sky", maskUrl: "https://r2.test/mask-1.png" }],
    }
    const { rerender } = render(
      <RefineRegionsSection nodeId="n1" data={baseData({ grokSegments: segments })} onUpdate={vi.fn()} />,
    )
    const applyNoPrompt = screen.getByRole("button", { name: /Edit whole image/ })
    expect((applyNoPrompt as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <RefineRegionsSection
        nodeId="n1"
        data={baseData({ grokSegments: segments, grokRegionPrompt: "warmer light" })}
        onUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Edit whole image/ }))
    await waitFor(() => expect(pollImageRefineToNodeMock).toHaveBeenCalledTimes(1))
    grokRegionEditMock.mockResolvedValue({ jobId: "edit-job-2" })
    await pollImageRefineToNodeMock.mock.calls[0][1]()
    expect(grokRegionEditMock).toHaveBeenCalledWith("task_grok_123", "warmer light", undefined)
  })
})
