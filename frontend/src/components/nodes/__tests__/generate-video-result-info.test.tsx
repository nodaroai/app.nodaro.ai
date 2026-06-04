import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — declared before the component import
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData }),
}))

// Stub the React-Query fetch so the pill renders the job's recorded settings
// without a network call / QueryClientProvider. The pure patch-builder keeps
// its real implementation (tested in use-result-generation-settings.test.ts).
const DEFAULT_SETTINGS = {
  provider: "kling-3.0",
  aspectRatio: "16:9",
  resolution: "1080p",
  duration: 5,
  generateAudio: true,
  prompt: "a fox",
  finalPrompt: "a fox, cinematic",
  negativePrompt: "blurry",
}
// Mutable so individual tests can vary what the "job" recorded. The mock factory
// reads it at call time (render), so reassigning before render takes effect.
let mockSettings: Record<string, unknown> = { ...DEFAULT_SETTINGS }
beforeEach(() => {
  mockSettings = { ...DEFAULT_SETTINGS }
})
vi.mock("@/hooks/use-result-generation-settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-result-generation-settings")>()
  return {
    ...actual,
    useResultGenerationSettings: () => ({ data: mockSettings, isLoading: false }),
  }
})

import {
  GenerateVideoResultInfo,
  videoModelLabelFor,
} from "../generate-video-result-info"

// ---------------------------------------------------------------------------
// videoModelLabelFor — robust label lookup across the i2v ∪ t2v union
// ---------------------------------------------------------------------------

describe("videoModelLabelFor", () => {
  it("resolves a normal provider id to its label", () => {
    expect(videoModelLabelFor("kling-3.0")).toBe("Kling 3.0")
  })

  it("resolves a collapsed t2v twin id (not in VIDEO_GEN_MODELS) via the union", () => {
    // "grok" is the t2v split-id that is collapsed out of the picker list, but
    // a job may still have recorded it — it must resolve to a human label.
    expect(videoModelLabelFor("grok")).toBe("Grok Imagine 1")
  })

  it("falls back to the raw id for an unknown provider", () => {
    expect(videoModelLabelFor("totally-unknown")).toBe("totally-unknown")
  })
})

// ---------------------------------------------------------------------------
// GenerateVideoResultInfo — pill + apply dialog
// ---------------------------------------------------------------------------

describe("GenerateVideoResultInfo", () => {
  function renderPill() {
    return render(
      <GenerateVideoResultInfo
        nodeId="gv-1"
        result={{ jobId: "job-1", url: "https://x/v.mp4" } as any}
        data={{ label: "Generate Video", provider: "kling-3.0" } as any}
      />,
    )
  }

  it("shows a summary pill: model · aspect · resolution · duration", () => {
    renderPill()
    expect(
      screen.getByText("Kling 3.0 · 16:9 · 1080p · 5s"),
    ).toBeInTheDocument()
  })

  it("opens a dialog with the settings rows (incl. Duration + Audio) and two apply buttons", () => {
    renderPill()
    fireEvent.click(
      screen.getByRole("button", { name: /Settings used for this output/i }),
    )
    expect(screen.getByText("Duration")).toBeInTheDocument()
    expect(screen.getByText("Audio")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Configuration \+ Prompt/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Configuration only/i }),
    ).toBeInTheDocument()
  })

  it("hides the Audio row when the job didn't record generateAudio (no audio lever)", () => {
    // A provider with no audio lever records no generateAudio. The pill must NOT
    // invent an on/off from the node's current config (would be misleading).
    mockSettings = { ...DEFAULT_SETTINGS, generateAudio: undefined }
    renderPill()
    fireEvent.click(
      screen.getByRole("button", { name: /Settings used for this output/i }),
    )
    expect(screen.queryByText("Audio")).toBeNull()
    // The other rows still render.
    expect(screen.getByText("Duration")).toBeInTheDocument()
  })

  it("applies the video config (provider/duration/generateAudio) to the node", () => {
    renderPill()
    fireEvent.click(
      screen.getByRole("button", { name: /Settings used for this output/i }),
    )
    fireEvent.click(screen.getByRole("button", { name: /Configuration only/i }))
    expect(updateNodeData).toHaveBeenCalledWith(
      "gv-1",
      expect.objectContaining({
        provider: "kling-3.0",
        duration: 5,
        generateAudio: true,
      }),
    )
  })
})
