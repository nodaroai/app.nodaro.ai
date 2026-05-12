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
    NodeToolbar: ({ children }: any) => <div>{children}</div>,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useUpdateNodeInternals: vi.fn(() => vi.fn()),
    useReactFlow: vi.fn(() => ({
      getNodes: vi.fn(() => []),
      getEdges: vi.fn(() => []),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
    })),
  }
})

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
      {handles?.map((h: any) => (
        <div
          key={h.id}
          data-testid={`handle-config-${h.id}`}
          data-type={h.type}
          data-position={h.position}
          data-handle-top={h.customStyle?.top}
        />
      ))}
      {children}
    </div>
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} />
  ),
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: (props: any) => <div data-testid={`handle-icon-${props.color ?? "default"}`} />,
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-label">{label}</div>,
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/lib/lazy-with-retry", () => ({
  lazyWithRetry: (_fn: any) => {
    const LazyComponent = () => null
    return LazyComponent
  },
}))

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

vi.mock("@/hooks/use-full-resolution", () => ({
  useFullResolution: () => false,
}))

vi.mock("@nodaro/shared", () => ({
  isSeedance2Provider: (p: string) => p === "seedance-2-fast" || p === "seedance-2-pro",
  SEEDANCE_2_REF_LIMITS: {},
  buildVideoCreditModelIdentifier: vi.fn(() => "seedance-2-fast"),
  estimateLoopTrimAddonCredits: vi.fn(() => 0),
}))

vi.mock("@/components/editor/config-panels/model-options", () => ({
  PROVIDERS_WITH_REFERENCES: ["veo3", "veo3.1", "veo3_lite", "grok-i2v", "seedance-2-fast", "seedance-2-pro"],
  PROVIDERS_WITH_END_FRAME: ["veo3", "veo3.1", "seedance-2-fast", "seedance-2-pro"],
  VIDEO_PROVIDER_FALLBACKS: {},
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

import { ImageToVideoNode } from "../image-to-video-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  return render(
    <ImageToVideoNode
      id="i2v-1"
      data={{ label: "Image to Video", provider: "seedance-2-fast", ...overrides }}
      selected={false}
      {...({} as any)}
    />,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImageToVideoNode", () => {
  describe("visual states", () => {
    it("shows clapperboard idle state (no frame preview placeholders)", () => {
      renderNode()
      expect(screen.getByTestId("base-node")).toBeInTheDocument()
      expect(screen.queryByText("Connect image/audio nodes")).not.toBeInTheDocument()
    })

    it("shows spinner when running", () => {
      renderNode({ executionStatus: "running" })
      expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
      const node = screen.getByTestId("base-node")
      expect(node.querySelector(".animate-spin")).toBeInTheDocument()
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

    it("does NOT show Kling 3 badges or shots UI when provider is kling-3.0", () => {
      renderNode({
        provider: "kling-3.0",
        multiShot: true,
        shots: [{ prompt: "A dog runs", duration: 5 }],
      })
      expect(screen.queryByText("shots")).not.toBeInTheDocument()
      expect(screen.queryByText("Std")).not.toBeInTheDocument()
      expect(screen.queryByText("Pro")).not.toBeInTheDocument()
    })

    it("does NOT show Edit/Result toggle button", () => {
      renderNode({
        generatedVideoUrl: "https://cdn.example.com/video.mp4",
        generatedResults: [{ url: "https://cdn.example.com/video.mp4", jobId: "j1" }],
      })
      expect(screen.queryByText("Edit")).not.toBeInTheDocument()
      expect(screen.queryByText("Result")).not.toBeInTheDocument()
    })
  })

  describe("handle layout — bottom-up formula", () => {
    it("frames mode (kling-3.0): startFrame at slot 1, audio at slot 2, cinematography at slot 3 (no endFrame)", () => {
      renderNode({ provider: "kling-3.0" })
      expect(screen.getByTestId("handle-config-startFrame")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 20px)",
      )
      expect(screen.queryByTestId("handle-config-endFrame")).not.toBeInTheDocument()
      expect(screen.getByTestId("handle-config-audio")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 50px)",
      )
      expect(screen.getByTestId("handle-config-cinematography")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 80px)",
      )
    })

    it("frames mode with endFrame (veo3): startFrame→endFrame→audio→cinematography", () => {
      renderNode({ provider: "veo3", veoMode: "frames" })
      expect(screen.getByTestId("handle-config-startFrame")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 20px)",
      )
      expect(screen.getByTestId("handle-config-endFrame")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 50px)",
      )
      expect(screen.getByTestId("handle-config-audio")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 80px)",
      )
      expect(screen.getByTestId("handle-config-cinematography")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 110px)",
      )
      expect(screen.queryByTestId("handle-config-references")).not.toBeInTheDocument()
    })

    it("reference mode (veo3 ref): references at slot 1, no startFrame/endFrame", () => {
      renderNode({ provider: "veo3", veoMode: "reference" })
      expect(screen.getByTestId("handle-config-references")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 20px)",
      )
      expect(screen.queryByTestId("handle-config-startFrame")).not.toBeInTheDocument()
      expect(screen.queryByTestId("handle-config-endFrame")).not.toBeInTheDocument()
      expect(screen.getByTestId("handle-config-audio")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 50px)",
      )
      expect(screen.getByTestId("handle-config-cinematography")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 80px)",
      )
    })

    it("Seedance-2 ref mode: 5 input handles stacked correctly", () => {
      renderNode({ provider: "seedance-2-fast", seedance2InputMode: "references" })
      expect(screen.getByTestId("handle-config-references")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 20px)",
      )
      expect(screen.getByTestId("handle-config-reference-audio")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 50px)",
      )
      expect(screen.getByTestId("handle-config-reference-videos")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 80px)",
      )
      expect(screen.getByTestId("handle-config-audio")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 110px)",
      )
      expect(screen.getByTestId("handle-config-cinematography")).toHaveAttribute(
        "data-handle-top",
        "calc(100% - 140px)",
      )
      expect(screen.queryByTestId("handle-config-endFrame")).not.toBeInTheDocument()
      expect(screen.queryByTestId("handle-config-startFrame")).not.toBeInTheDocument()
    })

    it("video output handle is always source on right", () => {
      renderNode()
      const videoHandle = screen.getByTestId("handle-config-video")
      expect(videoHandle).toHaveAttribute("data-type", "source")
      expect(videoHandle).toHaveAttribute("data-position", "right")
    })
  })

  describe("category and label", () => {
    it("passes i2v category to BaseNode", () => {
      renderNode()
      expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "i2v")
    })

    it("uses nodeData.label (not Kling 3.0 Studio override) for all providers", () => {
      renderNode({ provider: "kling-3.0", label: "My Video" })
      expect(screen.getByTestId("editable-label")).toHaveTextContent("My Video")
    })
  })
})
