import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ReferenceAudioNode } from "../reference-audio-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({
  useHandleConnections: () => [],
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Music: I, Volume2: I, Loader2: I, AlertCircle: I, CheckCircle2: I }
})

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Ref Audio", sourceType: "youtube" },
    selected: false,
    ...overrides,
  } as any
  return render(<ReferenceAudioNode {...defaultProps} />)
}

describe("ReferenceAudioNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes label as 'Ref Audio'", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Ref Audio")
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("passes correct credits", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows placeholder when no thumbnail", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows source type badge", () => {
    renderNode()
    expect(screen.getByText("YT")).toBeInTheDocument()
  })
})
