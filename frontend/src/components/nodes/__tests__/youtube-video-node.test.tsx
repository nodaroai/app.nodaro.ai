import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { YouTubeVideoNode } from "../youtube-video-node"

const setVideoLinkUrl = vi.fn()
const clearVideoLink = vi.fn()
const ingestVideoLink = vi.fn().mockResolvedValue({ status: "skipped" })
vi.mock("@/lib/video-link-ingest", () => ({
  setVideoLinkUrl: (...a: unknown[]) => setVideoLinkUrl(...a),
  clearVideoLink: (...a: unknown[]) => clearVideoLink(...a),
  ingestVideoLink: (...a: unknown[]) => ingestVideoLink(...a),
  retryVideoLinkIngest: vi.fn(),
  resumeVideoLinkIngest: vi.fn(),
  confirmVideoLink: vi.fn(),
  setVideoLinkConfirmed: vi.fn(),
  // The content rights box, ticked: the card's buttons are live as before.
  useVideoLinkConfirmed: () => true,
}))

vi.mock("@/lib/content-rights", () => ({
  useRightsDeclaration: () => ({ status: "ready", declaration: { version: 1, text: "I hold the rights to this content." } }),
  reloadDeclaration: vi.fn(),
}))

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
    // The content rights box's checkbox.
    CheckIcon: I,
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

beforeEach(() => {
  vi.clearAllMocks()
})

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
    const input = screen.getByPlaceholderText(/a link to where your video is/)
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

  it("hands every edit of the link to the controller — the card owns no download", () => {
    renderNode()
    fireEvent.change(screen.getByPlaceholderText(/a link to where your video is/), {
      target: { value: "https://www.tiktok.com/@someone/video/123" },
    })
    expect(setVideoLinkUrl).toHaveBeenCalledWith("node-1", "https://www.tiktok.com/@someone/video/123")
  })

  it("offers the download on a YOUTUBE link that was never fetched — it used to say 'streams directly' and hand a web page downstream", () => {
    renderNode({
      data: {
        label: "YouTube Video",
        youtubeUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        videoId: "aqz-KE-bpKQ",
        thumbnailUrl: "https://img.youtube.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: /Download Video/ }))
    expect(ingestVideoLink).toHaveBeenCalledWith("node-1", { mode: "auto" })
  })

  it("shows nothing to download once the file is there", () => {
    renderNode({
      data: {
        label: "YouTube Video",
        youtubeUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        videoId: "aqz-KE-bpKQ",
        thumbnailUrl: "t.jpg",
        downloadedVideoUrl: "https://cdn.nodaro.ai/videos/yt-1.mp4",
        downloadedFromUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      },
    })
    expect(screen.queryByRole("button", { name: /Download Video/ })).toBeNull()
    expect(screen.getByText("Downloaded and ready")).toBeInTheDocument()
  })

  it("plays the DOWNLOADED file once there is one — for YouTube too, where it may be one part of the video", () => {
    renderNode({
      data: {
        label: "x",
        youtubeUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        videoId: "aqz-KE-bpKQ",
        thumbnailUrl: "t.jpg",
        downloadedVideoUrl: "https://cdn.nodaro.ai/videos/yt-1.mp4",
        downloadedFromUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      },
    })
    fireEvent.click(screen.getByTestId("cached-image"))
    expect(document.querySelector("video")).toHaveAttribute("src", "https://cdn.nodaro.ai/videos/yt-1.mp4")
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("falls back to the YouTube embed while nothing is downloaded", () => {
    renderNode({
      data: {
        label: "x",
        youtubeUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        videoId: "aqz-KE-bpKQ",
        thumbnailUrl: "t.jpg",
      },
    })
    fireEvent.click(screen.getByTestId("cached-image"))
    expect(document.querySelector("iframe")).toHaveAttribute("src", expect.stringContaining("/embed/aqz-KE-bpKQ"))
    expect(document.querySelector("video")).toBeNull()
  })

  it("the remove button clears through the controller, so a running download is dropped with it", () => {
    renderNode({
      data: { label: "x", youtubeUrl: "https://www.tiktok.com/@someone/video/123", videoId: "123", title: "clip" },
    })
    fireEvent.click(screen.getByTitle("Remove"))
    expect(clearVideoLink).toHaveBeenCalledWith("node-1")
  })

  it("does not badge a foreign host as a platform — 'x.com' is inside 'netflix.com'", () => {
    renderNode({
      data: { label: "x", youtubeUrl: "https://www.netflix.com/watch/1", videoId: "", thumbnailUrl: "" },
    })
    expect(screen.queryByText("Twitter/X")).toBeNull()
    expect(document.querySelector(".border-dashed")).toBeInTheDocument()
  })
})
