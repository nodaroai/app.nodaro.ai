import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ComponentType, ReactNode } from "react"
import { render, screen, fireEvent } from "@testing-library/react"

/**
 * The "Edit video" action (the scissors on a video result) on the canvas.
 *
 * An install with an editor (the default: nothing set, or `FREECUT_URL` naming
 * one) shows it on every video result and opens the editor on click. These
 * cases cover each way a node draws it today: the shared result overlay
 * (a legacy node and a node unit), a hand-written button, the one without a
 * tooltip, and the Component node's own wording.
 *
 * An install with the editor switched off (`FREECUT_URL=off`) offers it
 * nowhere: no button and no tooltip, on any of those surfaces. Every other
 * node draws the action through the same shared button
 * (`edit-video-action-funnel.test.ts`).
 */

// ── The nodes' collaborators, flattened (as in ai-avatar-node.test) ──
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "N1"),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children, topToolbarContent }: { children?: ReactNode; topToolbarContent?: ReactNode }) => (
    <div data-testid="base-node">{children}<div>{topToolbarContent}</div></div>
  ),
}))
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../handle-with-popover")>()),
  HandleWithPopover: () => null,
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("@/ee/components/credits/StorageExceededModal", () => ({ StorageExceededModal: () => null }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))
vi.mock("@/hooks/use-llm-price", () => ({ useLlmPrice: () => ({ estimate: false }) }))
vi.mock("@/hooks/use-estimated-credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-estimated-credits")>()),
  useVideoUtilityCredits: () => 0,
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

const openFreeCut = vi.fn()
const storeState = {
  updateNodeData: vi.fn(),
  runSingleNode: vi.fn(),
  selectNode: vi.fn(),
  selectedNodeId: null,
  videoAutoplay: false,
  openFreeCut,
  openImageEdit: vi.fn(),
  nodes: [],
  edges: [],
}
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))

import { VideoResultOverlay } from "../video-result-overlay"
import { EditVideoButton } from "../edit-video-button"
import { TrimVideoNode } from "../trim-video-node"
import { UploadVideoNode } from "../upload-video-node"
import { FaceSwapNode } from "../face-swap-node"
import { ComponentNode } from "../component-node"
import { NodeComponent as GifToVideoNode } from "@/nodes/gif-to-video/node"

const VIDEO = "https://cdn.example/out/clip.mp4"
const PROJECT = "https://cdn.example/out/clip.freecut.json"
const RESULT = { url: VIDEO, jobId: "j1", freecutProjectUrl: PROJECT }

type AnyNode = ComponentType<Record<string, unknown>>
function renderNode(Node: unknown, data: Record<string, unknown>) {
  const C = Node as AnyNode
  return render(<C id="N1" data={{ label: "Node", ...data }} selected={false} />)
}

const editButton = (name: RegExp = /edit in nodarocut/i) => screen.queryByRole("button", { name })

function setEditor(freecutUrl: string | undefined) {
  window.__NODARO_RUNTIME__ = freecutUrl === undefined ? {} : { freecutUrl }
}

beforeEach(() => openFreeCut.mockClear())
afterEach(() => { delete window.__NODARO_RUNTIME__ })

describe.each([
  ["nothing configured (the hosted editor)", undefined],
  ["an operator's own editor", "https://freecut.example.internal"],
])("Edit video with %s", (_label, freecutUrl) => {
  beforeEach(() => setEditor(freecutUrl))

  it("the shared result overlay draws it, with its tooltip, and runs what the node hands it", () => {
    const onEdit = vi.fn()
    render(
      <VideoResultOverlay url={VIDEO} videoAutoplay={false} label="Clip" hasResults onExpand={() => {}} onDelete={() => {}} onEdit={onEdit} />,
    )
    const button = editButton()
    expect(button).not.toBeNull()
    expect(button).toHaveAttribute("title", "Edit in NodaroCut")
    fireEvent.click(button!)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it("a legacy node on the overlay (Trim Video) opens its active result with its saved project", () => {
    renderNode(TrimVideoNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    fireEvent.click(editButton()!)
    expect(openFreeCut).toHaveBeenCalledWith("N1", VIDEO, PROJECT)
  })

  it("a node unit on the overlay (GIF to Video) opens its active result", () => {
    renderNode(GifToVideoNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    fireEvent.click(editButton()!)
    expect(openFreeCut).toHaveBeenCalledWith("N1", VIDEO, PROJECT)
  })

  it("a hand-written button (Upload Video) opens the uploaded video, with its tooltip", () => {
    renderNode(UploadVideoNode, { url: VIDEO, r2Url: VIDEO })
    const button = editButton()
    expect(button).toHaveAttribute("title", "Edit in NodaroCut")
    fireEvent.click(button!)
    expect(openFreeCut).toHaveBeenCalledWith("N1", VIDEO, undefined)
  })

  it("Face Swap's button carries no tooltip", () => {
    renderNode(FaceSwapNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    const button = editButton()
    expect(button).not.toBeNull()
    expect(button).not.toHaveAttribute("title")
    fireEvent.click(button!)
    expect(openFreeCut).toHaveBeenCalledWith("N1", VIDEO, PROJECT)
  })

  it("the Component node's video preview says Edit video, without a tooltip", () => {
    renderNode(ComponentNode, {
      appSlug: "my-app",
      executionStatus: "completed",
      componentMetadata: { inputs: [], outputs: [{ id: "out", name: "Video", type: "video", mediaPreview: true }], exposedSettings: [] },
      outputResults: { out: VIDEO },
    })
    const button = editButton(/^edit video$/i)
    expect(button).not.toBeNull()
    expect(button).not.toHaveAttribute("title")
    fireEvent.click(button!)
    expect(openFreeCut).toHaveBeenCalledWith("N1", VIDEO)
  })
})

describe.each(["off", "OFF", " none ", "false", "disabled"])("Edit video with FREECUT_URL=%j", (value) => {
  beforeEach(() => setEditor(value))

  const assertAbsent = () => {
    expect(editButton()).toBeNull()
    expect(editButton(/^edit video$/i)).toBeNull()
    expect(screen.queryByTitle("Edit in NodaroCut")).toBeNull()
  }

  it("the shared result overlay draws no button, though the node hands it one", () => {
    render(
      <VideoResultOverlay url={VIDEO} videoAutoplay={false} label="Clip" hasResults onExpand={() => {}} onDelete={() => {}} onEdit={() => openFreeCut()} />,
    )
    assertAbsent()
    // The rest of the result's buttons stay.
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy()
  })

  it("a legacy node on the overlay (Trim Video) offers none", () => {
    renderNode(TrimVideoNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    expect(document.querySelector("video")).not.toBeNull()
    assertAbsent()
  })

  it("a node unit on the overlay (GIF to Video) offers none", () => {
    renderNode(GifToVideoNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    expect(document.querySelector("video")).not.toBeNull()
    assertAbsent()
  })

  it("a node with its own result buttons (Upload Video) offers none", () => {
    renderNode(UploadVideoNode, { url: VIDEO, r2Url: VIDEO })
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy()
    assertAbsent()
  })

  it("Face Swap offers none", () => {
    renderNode(FaceSwapNode, { executionStatus: "completed", generatedResults: [RESULT], activeResultIndex: 0, generatedVideoUrl: VIDEO })
    assertAbsent()
  })

  it("the Component node's video preview offers none", () => {
    renderNode(ComponentNode, {
      appSlug: "my-app",
      executionStatus: "completed",
      componentMetadata: { inputs: [], outputs: [{ id: "out", name: "Video", type: "video", mediaPreview: true }], exposedSettings: [] },
      outputResults: { out: VIDEO },
    })
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy()
    assertAbsent()
  })
})

describe("EditVideoButton", () => {
  it("is named and titled Edit in NodaroCut by default, and opens without reaching the node beneath", () => {
    setEditor(undefined)
    const onEdit = vi.fn()
    const onNodeClick = vi.fn()
    render(<div onClick={onNodeClick}><EditVideoButton onEdit={onEdit} /></div>)
    const button = editButton()!
    expect(button).toHaveAttribute("title", "Edit in NodaroCut")
    fireEvent.click(button)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onNodeClick).not.toHaveBeenCalled()
  })

  it("carries the Edit video wording and no tooltip where a node asks for them", () => {
    setEditor(undefined)
    render(<EditVideoButton onEdit={() => {}} wording="action" tooltip={false} />)
    expect(editButton(/^edit video$/i)).not.toHaveAttribute("title")
  })

  it("renders nothing at all with the editor off", () => {
    setEditor("off")
    const { container } = render(<EditVideoButton onEdit={() => {}} />)
    expect(container.innerHTML).toBe("")
  })
})
