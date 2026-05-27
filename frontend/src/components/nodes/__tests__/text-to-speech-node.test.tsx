import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
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
      {handles?.filter((h: any) => !h.external).map((h: any) => (
        <div
          key={`${h.type}-${h.id}`}
          data-testid={`handle-${h.type}-${h.id}`}
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
  return { Mic: I, Loader2: I, AlertCircle: I, X: I, Volume2: I, Type: I, LayoutGrid: I }
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

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@/lib/tts-voices", () => ({
  getVoiceName: vi.fn(() => "Rachel"),
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("../audio-result-overlay", () => ({
  AudioResultOverlay: ({ url }: any) => <div data-testid="audio-overlay"><audio src={url} controls /></div>,
}))

vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ nodeType, handleId, type, color, label }: any) => (
    <div
      data-testid={`handle-popover-${type}-${handleId}`}
      data-node-type={nodeType}
      data-handle-id={handleId}
      data-type={type}
      data-color={color}
      data-label={label}
    />
  ),
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { TextToSpeechNode } from "../text-to-speech-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "tts-1",
    data: { label: "Text to Speech" },
    selected: false,
    ...overrides,
  } as any
  return render(<TextToSpeechNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TextToSpeechNode", () => {
  it("renders with empty data and shows placeholder mic icon", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
    // Placeholder dashed border area is visible (idle, no audio)
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.querySelector(".border-dashed")).toBeInTheDocument()
  })

  it("renders audio element when generatedAudioUrl is present", () => {
    renderNode({
      data: {
        label: "Text to Speech",
        generatedAudioUrl: "https://example.com/speech.mp3",
        generatedResults: [{ url: "https://example.com/speech.mp3", jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    const audio = document.querySelector("audio")
    expect(audio).toBeTruthy()
    expect(audio!.getAttribute("src")).toBe("https://example.com/speech.mp3")
  })

  it("shows spinner when running", () => {
    renderNode({
      data: { label: "Text to Speech", executionStatus: "running" },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.querySelector(".animate-spin")).toBeInTheDocument()
  })

  it("shows error message when failed", () => {
    renderNode({
      data: {
        label: "Text to Speech",
        executionStatus: "failed",
        errorMessage: "Voice not found",
      },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("Voice not found")).toBeInTheDocument()
  })

  it("shows provider and voice name in footer", () => {
    renderNode({
      data: {
        label: "Text to Speech",
        provider: "elevenlabs-turbo",
        voiceId: "some-voice-id",
      },
    })
    expect(screen.getByText("elevenlabs-turbo")).toBeInTheDocument()
    expect(screen.getByText("Rachel")).toBeInTheDocument()
  })

  it("passes correct category to BaseNode", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "ai")
  })

  it("passes node id to BaseNode", () => {
    renderNode({ id: "tts-55" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "tts-55")
  })

  it("has correct typed handles (prompt target, audio source)", () => {
    renderNode()
    const prompt = screen.getByTestId("handle-popover-target-prompt")
    expect(prompt).toHaveAttribute("data-node-type", "text-to-speech")
    expect(prompt).toHaveAttribute("data-color", "#ff0073")
    const audio = screen.getByTestId("handle-popover-source-audio")
    expect(audio).toHaveAttribute("data-node-type", "text-to-speech")
    expect(audio).toHaveAttribute("data-color", "#F59E0B")
  })
})
