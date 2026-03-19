import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

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
  BaseNode: ({ children, label, category, credits, id, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
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

function MockIcon(props: any) {
  return <span data-testid="mock-icon" {...props} />
}

vi.mock("lucide-react", () => ({
  ImageIcon: MockIcon,
  Maximize2: MockIcon,
  Upload: MockIcon,
  Link: MockIcon,
  Loader2: MockIcon,
  AlertCircle: MockIcon,
  X: MockIcon,
  Video: MockIcon,
  Play: MockIcon,
  Music: MockIcon,
  Download: MockIcon,
  Expand: MockIcon,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      updateNodeData: () => {},
      videoAutoplay: false,
    }),
}))

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    upload: vi.fn(),
    isUploading: false,
    uploadError: null,
    clearError: vi.fn(),
    storageExceeded: { exceeded: false, usedBytes: 0, quotaBytes: 0, tier: "" },
    clearStorageExceeded: vi.fn(),
  }),
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

vi.mock("@/components/ui/image-lightbox", () => ({
  ImageLightbox: () => null,
}))

vi.mock("@/components/credits/StorageExceededModal", () => ({
  StorageExceededModal: () => null,
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: () => null,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
  copyToClipboard: vi.fn(),
}))

vi.mock("../audio-result-overlay", () => ({
  AudioResultOverlay: ({ url }: any) => <div data-testid="audio-overlay"><audio src={url} controls /></div>,
}))

import { UploadImageNode } from "../upload-image-node"
import { UploadVideoNode } from "../upload-video-node"
import { UploadAudioNode } from "../upload-audio-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderImageNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Upload Image" },
    selected: false,
    ...overrides,
  } as any
  return render(<UploadImageNode {...defaultProps} />)
}

function renderVideoNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Upload Video" },
    selected: false,
    ...overrides,
  } as any
  return render(<UploadVideoNode {...defaultProps} />)
}

function renderAudioNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Upload Audio" },
    selected: false,
    ...overrides,
  } as any
  return render(<UploadAudioNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// UploadImageNode
// ---------------------------------------------------------------------------

describe("UploadImageNode", () => {
  it("renders without crashing", () => {
    renderImageNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderImageNode({ data: { label: "Upload Image" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Upload Image")
  })

  it("has category input", () => {
    renderImageNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("has credits 0", () => {
    renderImageNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows empty upload placeholder when no file is present", () => {
    renderImageNode()
    expect(screen.getByText("Choose Image")).toBeInTheDocument()
  })

  it("shows 'or use URL' toggle text", () => {
    renderImageNode()
    expect(screen.getByText("or use URL")).toBeInTheDocument()
  })

  it("has correct source handle", () => {
    renderImageNode()
    const handle = screen.getByTestId("handle-image")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("shows filename when a file is present", () => {
    renderImageNode({
      data: {
        label: "Upload Image",
        r2Url: "https://example.com/img.png",
        url: "https://example.com/img.png",
        filename: "photo.jpg",
        fileSize: 1024,
      },
    })
    expect(screen.getByText("photo.jpg")).toBeInTheDocument()
  })

  it("passes node id to BaseNode", () => {
    renderImageNode({ id: "img-42" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "img-42")
  })
})

// ---------------------------------------------------------------------------
// UploadVideoNode
// ---------------------------------------------------------------------------

describe("UploadVideoNode", () => {
  it("renders without crashing", () => {
    renderVideoNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderVideoNode({ data: { label: "Upload Video" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Upload Video")
  })

  it("has category input", () => {
    renderVideoNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("has credits 0", () => {
    renderVideoNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows empty upload placeholder when no file is present", () => {
    renderVideoNode()
    expect(screen.getByText("Choose Video")).toBeInTheDocument()
  })

  it("shows 'or use URL' toggle text", () => {
    renderVideoNode()
    expect(screen.getByText("or use URL")).toBeInTheDocument()
  })

  it("has correct source handle", () => {
    renderVideoNode()
    const handle = screen.getByTestId("handle-video")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("shows filename when a file is present", () => {
    renderVideoNode({
      data: {
        label: "Upload Video",
        r2Url: "https://example.com/clip.mp4",
        url: "https://example.com/clip.mp4",
        filename: "clip.mp4",
        fileSize: 5242880,
      },
    })
    expect(screen.getByText("clip.mp4")).toBeInTheDocument()
  })

  it("passes node id to BaseNode", () => {
    renderVideoNode({ id: "vid-7" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "vid-7")
  })
})

// ---------------------------------------------------------------------------
// UploadAudioNode
// ---------------------------------------------------------------------------

describe("UploadAudioNode", () => {
  it("renders without crashing", () => {
    renderAudioNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderAudioNode({ data: { label: "Upload Audio" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Upload Audio")
  })

  it("has category input", () => {
    renderAudioNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "input")
  })

  it("has credits 0", () => {
    renderAudioNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  it("shows empty upload placeholder when no file is present", () => {
    renderAudioNode()
    expect(screen.getByText("Choose Audio")).toBeInTheDocument()
  })

  it("shows 'or use URL' toggle text", () => {
    renderAudioNode()
    expect(screen.getByText("or use URL")).toBeInTheDocument()
  })

  it("has correct source handle", () => {
    renderAudioNode()
    const handle = screen.getByTestId("handle-audio")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("shows filename when a file is present", () => {
    renderAudioNode({
      data: {
        label: "Upload Audio",
        r2Url: "https://example.com/track.mp3",
        url: "https://example.com/track.mp3",
        filename: "track.mp3",
        fileSize: 3145728,
      },
    })
    expect(screen.getByText("track.mp3")).toBeInTheDocument()
  })

  it("passes node id to BaseNode", () => {
    renderAudioNode({ id: "aud-99" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "aud-99")
  })
})
