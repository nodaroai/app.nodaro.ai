import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useUpdateNodeInternals: vi.fn(() => vi.fn()),
    useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
    useReactFlow: vi.fn(() => ({
      getNodes: vi.fn(() => []),
      getEdges: vi.fn(() => []),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
    })),
  }
})

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles, topToolbarContent, rawToolbarContent, bottomToolbarContent }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={String(isRunning)}
    >
      {handles?.map((h: any) => (
        <div
          key={h.id}
          data-testid={`handle-config-${h.id}`}
          data-type={h.type}
          data-position={h.position}
          data-handle-top={h.customStyle?.top}
          data-external={String(!!h.external)}
        />
      ))}
      {topToolbarContent}
      {rawToolbarContent}
      {bottomToolbarContent}
      {children}
    </div>
  ),
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: (props: any) => (
    <div
      data-testid={`pip-${props.handleId}`}
      data-type={props.type}
      data-position={props.position}
      data-top={props.top}
      data-side={props.side}
      data-color={props.color}
      data-label={props.label}
      data-order-matters={String(!!props.orderMatters)}
    />
  ),
}))

// The real handle-with-popover (loaded via importOriginal above to keep
// HANDLE_COLORS/TEXT_HANDLE_COLOR real) statically imports MissingRefsChip,
// which transitively pulls config-panels/model-options (real @nodaro/shared
// registries this file deliberately mocks). Stub it — the chip is covered by
// its own test (missing-refs-chip.test.tsx) and this file stubs the
// HandleWithPopover component itself anyway, so the chip never renders here.
vi.mock("../missing-refs-chip", () => ({ MissingRefsChip: () => null }))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-label">{label}</div>,
}))

vi.mock("../generate-video-quick-toolbar", () => ({
  GenerateVideoQuickToolbar: (props: any) => (
    <div data-testid="quick-toolbar" data-credits={String(props.credits ?? "")} />
  ),
}))

vi.mock("../node-job-progress", () => ({
  NodeJobProgress: ({ progress }: any) => (
    <div data-testid="node-job-progress" data-progress={String(progress ?? "")} />
  ),
}))

// Stub the result-info pill: it transitively imports config-panels/model-options
// (which pulls real @nodaro/shared registries this file deliberately mocks),
// and it's covered by its own test (generate-video-result-info.test.tsx). The
// node test only cares that the node renders, not the pill internals.
vi.mock("../generate-video-result-info", () => ({
  GenerateVideoResultInfo: () => <div data-testid="result-info-pill" />,
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        selectNode: () => {},
        openFreeCut: () => {},
        nodes: [],
        edges: [],
        videoAutoplay: false,
        selectedNodeId: null,
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 25,
}))

vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))

vi.mock("@nodaro/shared", () => ({
  buildVideoCreditModelIdentifier: vi.fn(() => "kling"),
}))

// Short-circuit the handle-limits import chain — it transitively pulls
// @nodaro/shared catalog (REF_IMAGE_MAX_LIMITS, getModel, ...) and
// config-panels/model-options (creditRangesAll), none of which the
// generate-video-node test cares about. The component only reads
// `getHandleConnectionLimit(...)?.limit` to build the disabled-handles set;
// returning null skips all the disabled styling.
vi.mock("@/lib/handle-limits", () => ({
  getHandleConnectionLimit: () => null,
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => (
    <img data-testid="cached-image" src={props.src} alt={props.alt} />
  ),
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { GenerateVideoNode } from "../generate-video-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  return render(
    <GenerateVideoNode
      id="gv-1"
      data={{ label: "Generate Video", provider: "kling", ...overrides } as never}
      selected={false}
      {...({} as any)}
    />,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateVideoNode", () => {
  describe("smoke + basics", () => {
    it("renders without crashing in idle state", () => {
      const { container } = renderNode()
      expect(container.firstChild).toBeTruthy()
      expect(screen.getByTestId("base-node")).toBeInTheDocument()
    })

    it("passes i2v category to BaseNode", () => {
      renderNode()
      expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "i2v")
    })

    it("uses nodeData.label", () => {
      renderNode({ label: "My Custom Video" })
      expect(screen.getByTestId("editable-label")).toHaveTextContent("My Custom Video")
    })

    it("renders the quick toolbar", () => {
      renderNode()
      expect(screen.getByTestId("quick-toolbar")).toBeInTheDocument()
    })
  })

  describe("visual states", () => {
    it("shows spinner when running", () => {
      renderNode({ executionStatus: "running" })
      expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
      const baseNode = screen.getByTestId("base-node")
      expect(baseNode.querySelector(".animate-spin")).toBeInTheDocument()
    })

    it("shows error state when failed", () => {
      renderNode({ executionStatus: "failed", errorMessage: "Provider timeout" })
      expect(screen.getByText("Failed")).toBeInTheDocument()
      expect(screen.getByText("Provider timeout")).toBeInTheDocument()
    })

    it("shows video element when result exists", () => {
      renderNode({
        generatedVideoUrl: "https://cdn.example.com/video.mp4",
        generatedResults: [{ url: "https://cdn.example.com/video.mp4", jobId: "j1" }],
      })
      const video = document.querySelector("video")
      expect(video).toBeInTheDocument()
      expect(video!.getAttribute("src")).toBe("https://cdn.example.com/video.mp4")
    })
  })

  describe("handles — 11 inputs + 1 output", () => {
    it("has 11 input typed pips on the left + 1 output pip on the right", () => {
      renderNode()
      // 11 input pips
      const inputIds = [
        "prompt", "negative",
        "startFrame", "endFrame", "imageReferences", "videoReferences",
        "audio", "audioReferences",
        "assets", "elements", "look",
      ]
      for (const id of inputIds) {
        const pip = screen.getByTestId(`pip-${id}`)
        expect(pip).toHaveAttribute("data-type", "target")
        expect(pip).toHaveAttribute("data-position", "left")
      }
      // 1 output pip
      const videoPip = screen.getByTestId("pip-video")
      expect(videoPip).toHaveAttribute("data-type", "source")
      expect(videoPip).toHaveAttribute("data-position", "right")
    })

    it("has 11 target handle configs + 1 source on BaseNode (external true)", () => {
      renderNode()
      const inputIds = [
        "prompt", "negative",
        "startFrame", "endFrame", "imageReferences", "videoReferences",
        "audio", "audioReferences",
        "assets", "elements", "look",
      ]
      for (const id of inputIds) {
        const h = screen.getByTestId(`handle-config-${id}`)
        expect(h).toHaveAttribute("data-type", "target")
        expect(h).toHaveAttribute("data-position", "left")
        expect(h).toHaveAttribute("data-external", "true")
      }
      const out = screen.getByTestId("handle-config-video")
      expect(out).toHaveAttribute("data-type", "source")
      expect(out).toHaveAttribute("data-position", "right")
    })

    it("grouped vertical spacing — text cluster at 24/52, image at 92/120/148/176, audio at 216/244, pickers at 284/312/340", () => {
      renderNode()
      // Text cluster (28 between)
      expect(screen.getByTestId("pip-prompt")).toHaveAttribute("data-top", "calc(100% - 24px)")
      expect(screen.getByTestId("pip-negative")).toHaveAttribute("data-top", "calc(100% - 52px)")
      // Image cluster (40 gap → 92, then 28 between)
      expect(screen.getByTestId("pip-startFrame")).toHaveAttribute("data-top", "calc(100% - 92px)")
      expect(screen.getByTestId("pip-endFrame")).toHaveAttribute("data-top", "calc(100% - 120px)")
      expect(screen.getByTestId("pip-imageReferences")).toHaveAttribute("data-top", "calc(100% - 148px)")
      expect(screen.getByTestId("pip-videoReferences")).toHaveAttribute("data-top", "calc(100% - 176px)")
      // Audio cluster (40 gap → 216)
      expect(screen.getByTestId("pip-audio")).toHaveAttribute("data-top", "calc(100% - 216px)")
      expect(screen.getByTestId("pip-audioReferences")).toHaveAttribute("data-top", "calc(100% - 244px)")
      // Pickers cluster (40 gap → 284); look on top, elements in middle
      expect(screen.getByTestId("pip-assets")).toHaveAttribute("data-top", "calc(100% - 284px)")
      expect(screen.getByTestId("pip-elements")).toHaveAttribute("data-top", "calc(100% - 312px)")
      expect(screen.getByTestId("pip-look")).toHaveAttribute("data-top", "calc(100% - 340px)")
      // Output handle pinned to 24px from top — symmetric with bottom-most input
      expect(screen.getByTestId("pip-video")).toHaveAttribute("data-top", "24px")
    })

    it("orderMatters set on references-like handles (imageReferences, videoReferences, audioReferences, assets)", () => {
      renderNode()
      expect(screen.getByTestId("pip-imageReferences")).toHaveAttribute("data-order-matters", "true")
      expect(screen.getByTestId("pip-videoReferences")).toHaveAttribute("data-order-matters", "true")
      expect(screen.getByTestId("pip-audioReferences")).toHaveAttribute("data-order-matters", "true")
      expect(screen.getByTestId("pip-assets")).toHaveAttribute("data-order-matters", "true")
    })
  })
})
