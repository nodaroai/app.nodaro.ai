/**
 * Replace Audio's canvas node: its two input pips and its video output, the
 * price its settings quote, its idle summary, and — once a take has landed —
 * the video with a Tracks panel that plays the speech, the music and the mix
 * the take carries (a replace-all take has no speech).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import type { GeneratedResult, ReplaceAudioNodeData } from "@/types/nodes"

const seen = vi.hoisted(() => ({ creditIds: [] as string[] }))

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children, credits, handles }: { children?: React.ReactNode; credits?: number; handles: Array<{ id: string; type: string }> }) => (
    <div data-testid="base-node" data-credits={credits} data-handles={handles.map((h) => `${h.type}:${h.id}`).join(",")}>{children}</div>
  ),
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label }: { handleId: string; type: string; label: string }) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("../results-thumbnails-panel", () => ({ ResultsThumbnailsPanel: () => null }))
vi.mock("../video-result-overlay", () => ({ VideoResultOverlay: ({ url }: { url: string }) => <div data-testid="video-overlay" data-url={url} /> }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: ({ url }: { url: string }) => <div data-testid="track-player" data-url={url} /> }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: (id: string) => {
    seen.creditIds.push(id)
    return 25
  },
}))
vi.mock("../use-unit-node-kit", () => ({
  useUnitNodeKit: () => ({ isSettingsOpen: false, videoAutoplay: false, updateNodeData: () => {}, run: () => {}, toggleSettings: () => {}, openFreeCut: () => {} }),
}))

import { ReplaceAudioNode } from "../replace-audio-node"

const data = (over: Partial<ReplaceAudioNodeData> = {}): ReplaceAudioNodeData => ({
  label: "Replace Audio",
  musicSource: "input",
  musicPrompt: "",
  mode: "keep-speech",
  musicVolume: 80,
  speechVolume: 100,
  duckAmount: 70,
  fieldMappings: {},
  ...over,
})

const renderNode = (d: ReplaceAudioNodeData) =>
  render(<ReplaceAudioNode {...({ id: "ra", data: d, selected: false, type: "replace-audio" } as unknown as NodeProps)} />)

const take = (over: Partial<GeneratedResult> = {}): GeneratedResult => ({ url: "https://cdn/out.mp4", timestamp: "t", jobId: "j1", ...over })

beforeEach(() => {
  seen.creditIds = []
})

describe("ReplaceAudioNode", () => {
  it("draws the `in` and `music` inputs and the `video-out` output, as declared", () => {
    renderNode(data())
    expect(screen.getByTestId("base-node").getAttribute("data-handles")).toBe("target:in,target:music,source:video-out")
    expect(screen.getByTestId("pip-target-in").textContent).toBe("Video")
    expect(screen.getByTestId("pip-target-music").textContent).toBe("Music")
    expect(screen.getByTestId("pip-source-video-out")).toBeTruthy()
  })

  it("quotes the row its settings name", () => {
    renderNode(data({ mode: "replace-all", musicSource: "prompt" }))
    expect(seen.creditIds).toContain("replace-audio:replace-all:prompt")
    expect(screen.getByTestId("base-node").getAttribute("data-credits")).toBe("25")
  })

  it("an idle node says its mode and where its music comes from", () => {
    renderNode(data({ mode: "replace-all", musicSource: "prompt" }))
    expect(screen.getByText("Replace all the sound")).toBeTruthy()
    expect(screen.getByText("Make it from a prompt")).toBeTruthy()
    expect(screen.queryByTestId("video-overlay")).toBeNull()
  })

  it("a failed node shows the server's words", () => {
    renderNode(data({ executionStatus: "failed", errorMessage: "Replace Audio runs on Nodaro Cloud and is not served on this deployment." }))
    expect(screen.getByText("Replace Audio runs on Nodaro Cloud and is not served on this deployment.")).toBeTruthy()
  })

  it("a take plays its video, and its speech, music and mix from the Tracks panel", () => {
    renderNode(data({
      executionStatus: "completed",
      generatedResults: [take({ speechUrl: "https://cdn/speech.m4a", musicUrl: "https://cdn/music.m4a", mixUrl: "https://cdn/mix.m4a" })],
      activeResultIndex: 0,
    }))
    expect(screen.getByTestId("video-overlay").getAttribute("data-url")).toBe("https://cdn/out.mp4")
    expect(screen.queryByTestId("replace-audio-tracks")).toBeNull()
    fireEvent.click(screen.getByTestId("replace-audio-tracks-toggle"))
    const panel = screen.getByTestId("replace-audio-tracks")
    expect(panel.textContent).toContain("Speech")
    expect(panel.textContent).toContain("Music")
    expect(panel.textContent).toContain("Mix")
    expect(screen.getAllByTestId("track-player").map((p) => p.getAttribute("data-url"))).toEqual([
      "https://cdn/speech.m4a",
      "https://cdn/music.m4a",
      "https://cdn/mix.m4a",
    ])
  })

  it("a replace-all take has no speech track", () => {
    renderNode(data({ executionStatus: "completed", generatedResults: [take({ musicUrl: "https://cdn/music.m4a", mixUrl: "https://cdn/mix.m4a" })] }))
    fireEvent.click(screen.getByTestId("replace-audio-tracks-toggle"))
    expect(screen.getAllByTestId("track-player").map((p) => p.getAttribute("data-url"))).toEqual(["https://cdn/music.m4a", "https://cdn/mix.m4a"])
    expect(screen.getByTestId("replace-audio-tracks").textContent).not.toContain("Speech")
  })

  it("a take with no tracks (landed before they were kept) offers no Tracks panel", () => {
    renderNode(data({ executionStatus: "completed", generatedResults: [take()] }))
    expect(screen.getByTestId("video-overlay")).toBeTruthy()
    expect(screen.queryByTestId("replace-audio-tracks-toggle")).toBeNull()
  })
})
