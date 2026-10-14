import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before the component import. Harness mirrors
// generate-video-node.test.tsx (the closest sibling video-node test), adapted
// for generate-video-pro-node's own child set (NodeQuickStrip +
// GvpContinueControl instead of GenerateVideoQuickToolbar; VideoResultOverlay
// stubbed since that's what renders the populated video result here).
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
        <div key={h.id} data-testid={`handle-config-${h.id}`} data-type={h.type} data-position={h.position} />
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
  HandleWithPopover: (props: any) => <div data-testid={`pip-${props.handleId}`} data-type={props.type} />,
}))

// The real handle-with-popover (loaded via importOriginal above to keep
// HANDLE_COLORS/TEXT_HANDLE_COLOR real) statically imports MissingRefsChip,
// which transitively pulls config-panels/model-options (real @nodaro/shared
// registries this file deliberately mocks). Stub it — same rationale as
// generate-video-node.test.tsx.
vi.mock("../missing-refs-chip", () => ({ MissingRefsChip: () => null }))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-label">{label}</div>,
}))

vi.mock("../node-quick-strip", () => ({
  NodeQuickStrip: ({ children }: any) => <div data-testid="quick-strip">{children}</div>,
}))

vi.mock("../gvp-continue-control", () => ({
  GvpContinueControl: () => null,
}))

vi.mock("../node-job-progress", () => ({
  NodeJobProgress: ({ progress }: any) => <div data-testid="node-job-progress" data-progress={String(progress ?? "")} />,
}))

// Stubbed: only `url` matters for this test — the overlay's own controls
// (expand/download/copy/settings) aren't under test here.
vi.mock("../video-result-overlay", () => ({
  VideoResultOverlay: ({ url }: any) => <div data-testid="video-result-overlay" data-url={url} />,
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
  useVideoProCredits: () => ({ data: undefined, isError: false }),
  useModelCredits: () => 25,
}))

vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))

// estimateGenerateVideoProCredits pulls the whole (heavy) workflow-editor
// types module transitively via @nodaro/shared credit-id builders + the ee
// credits cache — irrelevant to this test, stub the one symbol used.
vi.mock("@/components/editor/workflow-editor/types", () => ({
  estimateGenerateVideoProCredits: () => 100,
}))

vi.mock("@nodaro/shared/credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildVideoCreditModelIdentifier: vi.fn(() => "seedance-2"),
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { GenerateVideoProNode } from "../generate-video-pro-node"

function renderNode(overrides: Record<string, unknown> = {}) {
  return render(
    <GenerateVideoProNode
      id="gvp-1"
      data={{ label: "Generate Video Pro", provider: "seedance-2", duration: 8, ...overrides } as never}
      selected={false}
      {...({} as any)}
    />,
  )
}

const BASE_RESULT = {
  url: "https://cdn.example.com/video.mp4",
  jobId: "job-1",
  timestamp: "2026-08-03T00:00:00.000Z",
}

describe("GenerateVideoProNode — content-policy rewrite disclosure", () => {
  it("shows an amber notice with the segment numbers when contentPolicyRewrites is populated", () => {
    renderNode({
      executionStatus: "completed",
      generatedVideoUrl: BASE_RESULT.url,
      activeResultIndex: 0,
      generatedResults: [
        {
          ...BASE_RESULT,
          contentPolicyRewrites: [{ segment: 2, original: "a", rewritten: "b" }],
        },
      ],
    })

    expect(
      screen.getByText(/Segment 2 prompt was adjusted to pass the provider's content screen\./),
    ).toBeInTheDocument()
  })

  it("pluralizes for multiple rewritten segments", () => {
    renderNode({
      executionStatus: "completed",
      generatedVideoUrl: BASE_RESULT.url,
      activeResultIndex: 0,
      generatedResults: [
        {
          ...BASE_RESULT,
          contentPolicyRewrites: [
            { segment: 2, original: "a", rewritten: "b" },
            { segment: 4, original: "c", rewritten: "d" },
          ],
        },
      ],
    })

    expect(
      screen.getByText(/Segment 2, 4 prompts were adjusted to pass the provider's content screen\./),
    ).toBeInTheDocument()
  })

  it("renders no notice when contentPolicyRewrites is absent", () => {
    renderNode({
      executionStatus: "completed",
      generatedVideoUrl: BASE_RESULT.url,
      activeResultIndex: 0,
      generatedResults: [{ ...BASE_RESULT }],
    })

    expect(screen.getByTestId("video-result-overlay")).toBeInTheDocument()
    expect(screen.queryByText(/adjusted to pass the provider's content screen/)).toBeNull()
  })
})
