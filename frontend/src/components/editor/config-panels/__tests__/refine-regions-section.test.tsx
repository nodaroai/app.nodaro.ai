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
 *  - Selected/hovered segments with a server-recovered `bbox` render an
 *    on-image OUTLINE (alpha-masked silhouette positioned at the bbox);
 *    segments without a bbox degrade to a dashed chip with no outline.
 *  - Chips toggle grokSelectedSegments; Apply fires grok-2-edit with the
 *    sorted VERBATIM indexes — 0-based in production, so index 0 must
 *    survive — through pollImageRefineToNode so the edit lands as a new
 *    node result version.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { RefineRegionsSection } from "../refine-regions-section"
import { translate } from "@/lib/i18n"
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
  // 0-based, mirroring production (contra KIE's docs claiming ≥1). The
  // worker attaches a normalized bbox when template-matching succeeded, plus
  // `tile` — the content sub-rect inside the padded cutout tile.
  segments: [
    { index: 0, name: "sky", bbox: { x: 0.1, y: 0, w: 0.9, h: 0.4 }, tile: { x: 0, y: 0.3, w: 1, h: 0.4 } },
    { index: 1, name: "person" },
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
    expect(screen.getByText(translate("en", "cfgext.refineNoTaskId"))).toBeTruthy()
    expect(screen.queryByText(translate("en", "cfgext.refineDetectRegions"))).toBeNull()
  })

  it("detects regions (passing the source image for placement) and stores the zipped segment map with bboxes", async () => {
    vi.useFakeTimers()
    grokSegmentMapMock.mockResolvedValue({ jobId: "seg-job-1" })
    getJobStatusLeanMock.mockResolvedValue({ status: "completed", output_data: SEGMENT_OUTPUT })
    const onUpdate = vi.fn()
    render(<RefineRegionsSection nodeId="n1" data={baseData()} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByText(translate("en", "cfgext.refineDetectRegions")))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // The active result URL rides along so the worker can recover bboxes.
    expect(grokSegmentMapMock).toHaveBeenCalledWith("task_grok_123", "https://r2.test/result.png")
    expect(onUpdate).toHaveBeenCalledWith({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          {
            index: 0,
            name: "sky",
            maskUrl: "https://r2.test/mask-1.png",
            bbox: { x: 0.1, y: 0, w: 0.9, h: 0.4 },
            tile: { x: 0, y: 0.3, w: 1, h: 0.4 },
          },
          { index: 1, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [],
    })
  })

  it("treats a segment map stored for a DIFFERENT task id as stale and offers Detect", () => {
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_OLD",
        segments: [{ index: 0, name: "sky", maskUrl: "https://r2.test/old-mask.png" }],
      },
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)
    expect(screen.getByText(translate("en", "cfgext.refineDetectRegions"))).toBeTruthy()
    expect(screen.queryByText("sky")).toBeNull()
  })

  it("outlines a selected bbox-placed segment on the preview; bbox-less segments get a dashed chip and no outline", () => {
    const onUpdate = vi.fn()
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          {
            index: 0,
            name: "sky",
            maskUrl: "https://r2.test/mask-1.png",
            bbox: { x: 0.1, y: 0, w: 0.9, h: 0.4 },
            // Wide content in a square tile: vertically centered slab.
            tile: { x: 0, y: 0.3, w: 1, h: 0.4 },
          },
          { index: 1, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [0, 1],
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={onUpdate} />)

    // sky (has bbox) → outline positioned at the bbox percentages.
    const outline = screen.getByTestId("region-outline-0")
    expect(parseFloat(outline.style.left)).toBeCloseTo(10)
    expect(parseFloat(outline.style.width)).toBeCloseTo(90)
    // The mask surface maps the tile's CONTENT sub-rect onto the bbox: the
    // whole tile over-extends so its padding falls outside the box. Without
    // this the silhouette renders at 40% height, floating centered (the
    // "regions draw too small" bug).
    const frame = screen.getByTestId("region-tile-frame-0")
    expect(parseFloat(frame.style.width)).toBeCloseTo(100) // 1 / tile.w
    expect(parseFloat(frame.style.height)).toBeCloseTo(250) // 1 / tile.h
    expect(parseFloat(frame.style.top)).toBeCloseTo(-75) // -tile.y / tile.h
    expect(parseFloat(frame.style.left)).toBeCloseTo(0)
    // person (no bbox) → selectable but NO outline.
    expect(screen.queryByTestId("region-outline-1")).toBeNull()

    // Both chips render with the cutout thumbnail; selection toggles work.
    const skyChip = screen.getByRole("button", { name: /sky/ })
    expect(skyChip.getAttribute("aria-pressed")).toBe("true")
    expect(skyChip.querySelector("img")?.getAttribute("src")).toBe("https://r2.test/mask-1.png")
    fireEvent.click(skyChip)
    expect(onUpdate).toHaveBeenCalledWith({ grokSelectedSegments: [1] })
  })

  it("outlines a hovered (unselected) segment while hovered", () => {
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 0, name: "sky", maskUrl: "https://r2.test/mask-1.png", bbox: { x: 0.1, y: 0, w: 0.9, h: 0.4 } },
        ],
      },
      grokSelectedSegments: [],
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)

    expect(screen.queryByTestId("region-outline-0")).toBeNull()
    fireEvent.mouseEnter(screen.getByRole("button", { name: /sky/ }))
    expect(screen.getByTestId("region-outline-0")).toBeTruthy()
    // Maps stored before `tile` shipped: mask surface falls back to the
    // whole tile (inset 0) instead of the content mapping.
    const frame = screen.getByTestId("region-tile-frame-0")
    expect(frame.style.inset).toBe("0")
    fireEvent.mouseLeave(screen.getByRole("button", { name: /sky/ }))
    expect(screen.queryByTestId("region-outline-0")).toBeNull()
  })

  it("offers Re-detect even when the stored map HAS outlines (stored geometry only upgrades by re-detecting)", async () => {
    vi.useFakeTimers()
    grokSegmentMapMock.mockResolvedValue({ jobId: "seg-job-2" })
    getJobStatusLeanMock.mockResolvedValue({ status: "completed", output_data: SEGMENT_OUTPUT })
    const onUpdate = vi.fn()
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 0, name: "sky", maskUrl: "https://r2.test/mask-1.png", bbox: { x: 0.1, y: 0, w: 0.9, h: 0.4 } },
        ],
      },
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={onUpdate} />)

    // The regression: with located segments present, NO re-detect affordance
    // existed at all — old (wrong) placements were stranded forever.
    const redetect = screen.getByRole("button", { name: translate("en", "cfgext.refineRedetectRegions") })
    fireEvent.click(redetect)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(grokSegmentMapMock).toHaveBeenCalledWith("task_grok_123", "https://r2.test/result.png")
    expect(onUpdate).toHaveBeenCalled()
  })

  it("applies a region edit with the sorted VERBATIM indexes (0-based survives) via pollImageRefineToNode", async () => {
    const data = baseData({
      grokSegments: {
        taskId: "task_grok_123",
        segments: [
          { index: 0, name: "sky", maskUrl: "https://r2.test/mask-1.png" },
          { index: 1, name: "person", maskUrl: "https://r2.test/mask-2.png" },
        ],
      },
      grokSelectedSegments: [1, 0],
      grokRegionPrompt: "make the sky stormy",
    })
    render(<RefineRegionsSection nodeId="n1" data={data} onUpdate={vi.fn()} />)

    fireEvent.click(screen.getByText(translate("en", "cfgext.refineEditRegionMany", { n: 2 })))
    await waitFor(() => expect(pollImageRefineToNodeMock).toHaveBeenCalledTimes(1))
    const [nodeId, apiCall, label] = pollImageRefineToNodeMock.mock.calls[0]
    expect(nodeId).toBe("n1")
    expect(label).toBe("Region edit")

    grokRegionEditMock.mockResolvedValue({ jobId: "edit-job-1" })
    await apiCall()
    expect(grokRegionEditMock).toHaveBeenCalledWith("task_grok_123", "make the sky stormy", [0, 1])
  })

  it("applies a whole-image edit (no maskIndexes) when nothing is selected, and disables Apply without a prompt", async () => {
    const segments = {
      taskId: "task_grok_123",
      segments: [{ index: 0, name: "sky", maskUrl: "https://r2.test/mask-1.png" }],
    }
    const { rerender } = render(
      <RefineRegionsSection nodeId="n1" data={baseData({ grokSegments: segments })} onUpdate={vi.fn()} />,
    )
    const applyNoPrompt = screen.getByRole("button", { name: translate("en", "cfgext.refineEditWholeImage") })
    expect((applyNoPrompt as HTMLButtonElement).disabled).toBe(true)

    rerender(
      <RefineRegionsSection
        nodeId="n1"
        data={baseData({ grokSegments: segments, grokRegionPrompt: "warmer light" })}
        onUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: translate("en", "cfgext.refineEditWholeImage") }))
    await waitFor(() => expect(pollImageRefineToNodeMock).toHaveBeenCalledTimes(1))
    grokRegionEditMock.mockResolvedValue({ jobId: "edit-job-2" })
    await pollImageRefineToNodeMock.mock.calls[0][1]()
    expect(grokRegionEditMock).toHaveBeenCalledWith("task_grok_123", "warmer light", undefined)
  })
})
