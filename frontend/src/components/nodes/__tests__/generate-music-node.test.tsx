import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
    >
      {handles?.map((h: any) => (
        <div
          key={h.id}
          data-testid={`handle-${h.id}`}
          data-type={h.type}
          data-position={h.position}
        />
      ))}
      {children}
    </div>
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} data-node-id={props.nodeId} />
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Music: I, Loader2: I, AlertCircle: I, X: I, AudioLines: I, Volume2: I, Type: I, LayoutGrid: I }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        selectNode: () => {},
        duplicateNode: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("../audio-result-overlay", () => ({
  AudioResultOverlay: ({ url }: any) => <div data-testid="audio-overlay"><audio src={url} controls /></div>,
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { GenerateMusicNode } from "../generate-music-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "music-1",
    data: { label: "Generate Music" },
    selected: false,
    ...overrides,
  } as any
  return render(<GenerateMusicNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateMusicNode", () => {
  it("renders with empty data and shows placeholder music icon", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
    // Placeholder dashed border area is visible (idle, no audio)
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.querySelector(".border-dashed")).toBeInTheDocument()
  })

  it("renders audio element when generatedAudioUrl is present", () => {
    renderNode({
      data: {
        label: "Generate Music",
        generatedAudioUrl: "https://example.com/song.mp3",
        generatedResults: [{ url: "https://example.com/song.mp3", jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    const audio = document.querySelector("audio")
    expect(audio).toBeTruthy()
    expect(audio!.getAttribute("src")).toBe("https://example.com/song.mp3")
  })

  it("shows spinner when running", () => {
    renderNode({
      data: { label: "Generate Music", executionStatus: "running" },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.querySelector(".animate-spin")).toBeInTheDocument()
  })

  it("shows error message when failed", () => {
    renderNode({
      data: {
        label: "Generate Music",
        executionStatus: "failed",
        errorMessage: "Generation timeout",
      },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("Generation timeout")).toBeInTheDocument()
  })

  it("passes correct category to BaseNode", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "ai")
  })

  it("passes node id to BaseNode", () => {
    renderNode({ id: "music-99" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "music-99")
  })

  it("has correct handles", () => {
    renderNode()
    const inHandle = screen.getByTestId("handle-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refAudioHandle = screen.getByTestId("handle-ref-audio")
    expect(refAudioHandle).toHaveAttribute("data-type", "target")
    expect(refAudioHandle).toHaveAttribute("data-position", "left")

    const outHandle = screen.getByTestId("handle-audio-out")
    expect(outHandle).toHaveAttribute("data-type", "source")
    expect(outHandle).toHaveAttribute("data-position", "right")
  })
})
