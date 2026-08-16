import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { render, screen, fireEvent } from "@testing-library/react"

// ── The node's collaborators, flattened (same approach as reduce-node.test) ──
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "N1"),
}))
vi.mock("../base-node", () => ({
  // BaseNode frames the body AND mounts the run strip (topToolbarContent) — both matter here.
  BaseNode: ({ children, isRunning, topToolbarContent }: { children?: ReactNode; isRunning?: boolean; topToolbarContent?: ReactNode }) => (
    <div data-testid="base-node" data-running={isRunning}>{children}<div data-testid="strip-slot">{topToolbarContent}</div></div>
  ),
}))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => <div data-testid="job-progress" /> }))
// The strip renders whatever the node hands it (here: the New run toggle).
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: ({ children }: { children?: ReactNode }) => <div data-testid="quick-strip">{children}</div> }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: ({ label }: { label?: string }) => <div>{label}</div> }))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: () => null,
  HANDLE_COLORS: { image: "#0", audio: "#0", video: "#0" },
  TEXT_HANDLE_COLOR: "#0",
}))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 150 }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: () => {} }),
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src }: { src: string }) => <img data-testid="cached-image" src={src} alt="" />,
}))
// The idle/failed interior is its own tested component — stand in and echo
// what the node hands it.
vi.mock("../ai-avatar/ai-avatar-setup-body", () => ({
  AiAvatarSetupBody: ({ failed, failureMessage }: { failed?: boolean; failureMessage?: string }) => (
    <div data-testid="setup-body" data-failed={failed ? "" : undefined} data-message={failureMessage ?? ""} />
  ),
}))

const runSingleNode = vi.fn()
const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        updateNodeData,
        runSingleNode,
        videoAutoplay: false,
        openFreeCut: vi.fn(),
        selectNode: vi.fn(),
        selectedNodeId: null,
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [], updateNodeData, runSingleNode }) },
  ),
}))

import { AiAvatarNode } from "../ai-avatar-node"

const VIDEO = "https://cdn/x/avatar.mp4"
type NodeProps = Parameters<typeof AiAvatarNode>[0]
function nodeProps(data: Record<string, unknown>): NodeProps {
  return {
    id: "N1",
    data: {
      label: "AI Avatar", provider: "heygen", avatarSource: "avatar", engine: "avatar-iv", avatarId: "a1",
      speechMode: "text", resolution: "720p", aspectRatio: "16:9", fieldMappings: {}, ...data,
    },
    selected: false,
  } as unknown as NodeProps
}
function renderNode(data: Record<string, unknown>) {
  return render(<AiAvatarNode {...nodeProps(data)} />)
}

beforeEach(() => { runSingleNode.mockClear(); updateNodeData.mockClear() })

describe("AiAvatarNode — every action lives in the strip", () => {
  const newRun = () => screen.getByTestId("ai-avatar-new-run")

  it("failed with nothing earlier to show → the editable card carries the failure; no New run (nothing to hide), no button in the card", () => {
    renderNode({ executionStatus: "failed", errorMessage: "Reconciliation could not recover this job. Please re-run." })
    const body = screen.getByTestId("setup-body")
    expect(body).toHaveAttribute("data-failed")
    expect(body).toHaveAttribute("data-message", "Reconciliation could not recover this job. Please re-run.")
    expect(document.querySelector("video")).toBeNull()
    expect(screen.queryByTestId("ai-avatar-new-run")).toBeNull()
    expect(screen.queryByRole("button", { name: /Run again|Retry/ })).toBeNull()
  })

  it("failed while an earlier version is on show → the video stays, a red banner names the failure (message only); New run in the strip hides the results", () => {
    renderNode({
      executionStatus: "failed", errorMessage: "HeyGen: look unavailable",
      generatedResults: [{ url: VIDEO, jobId: "j1" }, { url: VIDEO, jobId: "j0" }], activeResultIndex: 0, generatedVideoUrl: VIDEO,
    })
    expect(document.querySelector("video")).not.toBeNull()
    expect(screen.getByTestId("ai-avatar-failed-banner")).toHaveTextContent("Last run failed · HeyGen: look unavailable")
    expect(screen.getByTestId("ai-avatar-failed-banner").querySelector("button")).toBeNull()
    expect(screen.queryByRole("button", { name: /Run again|Retry/ })).toBeNull()
    fireEvent.click(newRun())
    expect(runSingleNode).not.toHaveBeenCalled()
    expect(document.querySelector("video")).toBeNull()
    expect(screen.getByTestId("setup-body")).toHaveAttribute("data-failed")
    expect(newRun()).toHaveAttribute("aria-pressed", "true")
  })

  it("completed → the video; New run (strip) hides the results and shows the setup card, a second click restores them — nothing runs", () => {
    renderNode({
      executionStatus: "completed",
      generatedResults: [{ url: VIDEO, jobId: "j1" }], activeResultIndex: 0, generatedVideoUrl: VIDEO,
    })
    expect(screen.queryByTestId("ai-avatar-failed-banner")).toBeNull()
    expect(screen.queryByRole("button", { name: /Run again|Retry/ })).toBeNull()
    expect(newRun()).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(newRun())
    expect(runSingleNode).not.toHaveBeenCalled()
    expect(updateNodeData).not.toHaveBeenCalled()
    expect(document.querySelector("video")).toBeNull()
    expect(screen.getByTestId("setup-body")).not.toHaveAttribute("data-failed")
    expect(newRun()).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(newRun())
    expect(document.querySelector("video")).not.toBeNull()
    expect(screen.queryByTestId("setup-body")).toBeNull()
    expect(newRun()).toHaveAttribute("aria-pressed", "false")
    expect(runSingleNode).not.toHaveBeenCalled()
  })

  it("a run starting while New run is active drops back to the result view (spinner, then the new version on top)", () => {
    const { rerender } = renderNode({
      executionStatus: "completed",
      generatedResults: [{ url: VIDEO, jobId: "j1" }], activeResultIndex: 0, generatedVideoUrl: VIDEO,
    })
    fireEvent.click(newRun())
    expect(screen.getByTestId("setup-body")).toBeInTheDocument()
    const running = nodeProps({
      executionStatus: "running", generatedResults: [{ url: VIDEO, jobId: "j1" }], activeResultIndex: 0,
    })
    rerender(<AiAvatarNode {...running} />)
    expect(screen.getByTestId("job-progress")).toBeInTheDocument()
    expect(screen.queryByTestId("setup-body")).toBeNull()
    expect(newRun()).toBeDisabled()
    const done = nodeProps({
      executionStatus: "completed", generatedResults: [{ url: VIDEO, jobId: "j2" }, { url: VIDEO, jobId: "j1" }], activeResultIndex: 0, generatedVideoUrl: VIDEO,
    })
    rerender(<AiAvatarNode {...done} />)
    expect(document.querySelector("video")).not.toBeNull()
    expect(screen.queryByTestId("setup-body")).toBeNull()
    expect(newRun()).toHaveAttribute("aria-pressed", "false")
  })

  it("running → progress, no card", () => {
    renderNode({ executionStatus: "running", currentJobProgress: 40 })
    expect(screen.getByTestId("job-progress")).toBeInTheDocument()
    expect(screen.queryByTestId("setup-body")).toBeNull()
  })

  it("idle (never ran) → the card, and no New run in the strip (nothing to hide)", () => {
    renderNode({})
    expect(screen.getByTestId("setup-body")).not.toHaveAttribute("data-failed")
    expect(screen.queryByTestId("ai-avatar-new-run")).toBeNull()
  })
})
