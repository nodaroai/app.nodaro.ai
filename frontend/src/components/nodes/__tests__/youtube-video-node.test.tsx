import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { YouTubeVideoNode } from "../youtube-video-node"

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
  return {
    Link: I, X: I, Play: I, Video: I, Film: I, Music2: I, Camera: I,
    Hash: I, Download: I, AlertCircle: I, CheckCircle2: I, Loader2: I,
  }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
  }),
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

vi.mock("@/lib/api", () => ({
  fetchYouTubeOEmbed: vi.fn(),
  startVideoDownload: vi.fn(),
  subscribeToDownloadProgress: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "YouTube Video", youtubeUrl: "", videoId: "" },
    selected: false,
    ...overrides,
  } as any
  return render(<YouTubeVideoNode {...defaultProps} />)
}

describe("YouTubeVideoNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "YouTube Video")
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("has correct credits", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows URL input placeholder", () => {
    renderNode()
    const input = screen.getByPlaceholderText(/YouTube/)
    expect(input).toBeInTheDocument()
  })

  it("shows empty state when no URL", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows thumbnail when video resolved", () => {
    renderNode({
      data: {
        label: "YouTube Video",
        youtubeUrl: "https://youtube.com/watch?v=abc123",
        videoId: "abc123",
        thumbnailUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
      },
    })
    expect(screen.getByTestId("cached-image")).toBeInTheDocument()
  })
})
