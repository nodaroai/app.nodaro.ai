import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Inline-prompt parity for Generate Video Pro (2026-09-16 "prompt drawer
// below the node is not shown"): with the canvas in inline-prompt mode
// BaseNode renders the editor as chrome BELOW the preview, so the node must
// (a) keep the result INSIDE the preview box instead of blanketing the whole
// card with the absolute overlay, (b) keep the card chrome (no transparent
// class), and (c) lift the bottom-anchored input pips by the measured chrome
// height — exactly what generate-video does.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ inline: false, chrome: 0 }))

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
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  }
})

vi.mock("../inline-node-prompt/use-inline-prompt-active", () => ({
  useInlinePromptActive: () => state.inline,
}))

// BaseNode stand-in: reports the (simulated) measured chrome height the way
// the real one does via `onChromeHeightChange`, and exposes the props under
// test as data attributes.
vi.mock("../base-node", async () => {
  const React = await import("react")
  return {
    BaseNode: (props: any) => {
      React.useEffect(() => {
        props.onChromeHeightChange?.(state.chrome)
      }, [props.onChromeHeightChange])
      return (
        <div data-testid="base-node" data-class={props.className ?? ""}>
          {props.handles?.map((h: any) => (
            <div key={h.id} data-testid={`handle-config-${h.id}`} data-handle-top={h.customStyle?.top} />
          ))}
          {props.topToolbarContent}
          {props.children}
        </div>
      )
    },
  }
})

vi.mock("../video-result-overlay", () => ({
  VideoResultOverlay: (p: any) => (
    <div data-testid="video-result-overlay" data-square-bottom={String(!!p.squareBottom)} />
  ),
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: (props: any) => (
    <div data-testid={`pip-${props.handleId}`} data-top={props.top} data-type={props.type} />
  ),
}))
vi.mock("../missing-refs-chip", () => ({ MissingRefsChip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: ({ label }: any) => <div>{label}</div> }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: ({ children }: any) => <div data-testid="quick-strip">{children}</div> }))
vi.mock("../gvp-continue-control", () => ({ GvpContinueControl: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/components/editor/workflow-editor/types", () => ({ estimateGenerateVideoProCredits: () => 82 }))
// Same short-circuit the generate-video node test uses: the real handle
// modules stay (target-handle-registry needs their full export surface); only
// the heavy handle-limits chain is stubbed.
vi.mock("@/lib/handle-limits", () => ({ getHandleConnectionLimit: () => null }))
vi.mock("@/lib/api", () => ({ getJobStatusLean: vi.fn() }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 25, useVideoProCredits: () => ({ data: undefined, isError: false }) }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))
vi.mock("@nodaro/shared/credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildVideoCreditModelIdentifier: vi.fn(() => "seedance-2"),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        openFreeCut: () => {},
        selectNode: () => {},
        selectedNodeId: null,
        videoAutoplay: false,
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

import { GenerateVideoProNode } from "../generate-video-pro-node"

const RESULT = {
  generatedVideoUrl: "https://cdn.example.com/pro.mp4",
  generatedResults: [{ url: "https://cdn.example.com/pro.mp4", jobId: "j1" }],
  executionStatus: "completed",
}

function renderNode(overrides: Record<string, unknown> = {}) {
  return render(
    <GenerateVideoProNode
      id="gvp-1"
      data={{ label: "Generate Video Pro", provider: "seedance-2", ...overrides } as never}
      selected={false}
      {...({} as any)}
    />,
  )
}

beforeEach(() => {
  state.inline = false
  state.chrome = 0
})

describe("GenerateVideoProNode — inline-prompt layout", () => {
  it("non-inline: the result overlay fills the transparent card (outside the body)", () => {
    renderNode(RESULT)
    const overlays = screen.getAllByTestId("video-result-overlay")
    expect(overlays).toHaveLength(1)
    expect(within(screen.getByTestId("base-node")).queryByTestId("video-result-overlay")).toBeNull()
    expect(overlays[0].getAttribute("data-square-bottom")).toBe("false")
    expect(screen.getByTestId("base-node").getAttribute("data-class")).toContain("!bg-transparent")
  })

  it("inline: the result stays inside the preview box, the card keeps its chrome, corners square", () => {
    state.inline = true
    state.chrome = 120
    renderNode(RESULT)
    const overlays = screen.getAllByTestId("video-result-overlay")
    expect(overlays).toHaveLength(1)
    expect(within(screen.getByTestId("base-node")).getByTestId("video-result-overlay")).toBe(overlays[0])
    expect(overlays[0].getAttribute("data-square-bottom")).toBe("true")
    expect(screen.getByTestId("base-node").getAttribute("data-class")).toBe("")
  })

  it("inline: every input pip lifts by the measured chrome height (both the pips and BaseNode's handle configs)", () => {
    state.inline = true
    state.chrome = 120
    renderNode()
    expect(screen.getByTestId("pip-prompt").getAttribute("data-top")).toBe("calc(100% - 120px - 24px)")
    expect(screen.getByTestId("pip-look").getAttribute("data-top")).toBe("calc(100% - 120px - 340px)")
    expect(screen.getByTestId("handle-config-prompt").getAttribute("data-handle-top")).toBe("calc(100% - 120px - 24px)")
    expect(screen.getByTestId("handle-config-look").getAttribute("data-handle-top")).toBe("calc(100% - 120px - 340px)")
    // The output pip is top-anchored and unaffected.
    expect(screen.getByTestId("pip-video").getAttribute("data-top")).toBe("24px")
  })

  it("non-inline: pips keep generate-video's static cluster offsets", () => {
    renderNode()
    expect(screen.getByTestId("pip-prompt").getAttribute("data-top")).toBe("calc(100% - 24px)")
    expect(screen.getByTestId("pip-negative").getAttribute("data-top")).toBe("calc(100% - 52px)")
    expect(screen.getByTestId("pip-look").getAttribute("data-top")).toBe("calc(100% - 340px)")
  })
})
