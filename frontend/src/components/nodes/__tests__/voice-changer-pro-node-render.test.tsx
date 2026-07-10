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
      data-is-running={String(isRunning)}
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

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

vi.mock("../node-quick-strip", () => ({
  NodeQuickStrip: () => <div data-testid="node-quick-strip" />,
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-label">{label}</div>,
}))

vi.mock("../node-job-progress", () => ({
  NodeJobProgress: ({ progress }: any) => (
    <div data-testid="node-job-progress" data-progress={String(progress ?? "")} />
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { ...actual, AudioWaveform: I, Loader2: I, AlertCircle: I, LayoutGrid: I, Film: I }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        selectNode: () => {},
        selectedNodeId: null,
        videoAutoplay: false,
        openFreeCut: () => {},
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/hooks/use-handle-connections", () => ({
  useHandleConnections: () => [],
}))

vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 4,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("../audio-result-overlay", () => ({
  AudioResultOverlay: ({ url }: any) => (
    <div data-testid="audio-overlay">
      <audio src={url} controls />
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { VoiceChangerProNode } from "../voice-changer-pro-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(dataOverrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "vcp-1",
    data: { label: "Voice Changer Pro", orderedVoices: [], ...dataOverrides },
    selected: false,
  } as any
  return render(<VoiceChangerProNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceChangerProNode", () => {
  it("renders without crashing when idle with no voices configured", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("shows the first voice's label when set", () => {
    renderNode({
      orderedVoices: [{ voiceId: "v1", voiceLabel: "Rachel", voiceType: "premade" }],
    })
    expect(screen.getByText("Rachel")).toBeInTheDocument()
  })

  // Keep-slot: a null entry means "keep this speaker's original voice"
  // (cloud-plugins orderedVoices contract). The tile label must render a
  // "Keep original" chip instead of crashing on `orderedVoices[0].voiceLabel`.
  it("renders 'Keep original' for a null first slot instead of crashing", () => {
    renderNode({
      orderedVoices: [null, { voiceId: "v2", voiceLabel: "Aria", voiceType: "premade" }],
    })
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
    expect(screen.getByText("Keep original")).toBeInTheDocument()
  })
})
