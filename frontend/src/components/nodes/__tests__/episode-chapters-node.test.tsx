// The Chapters node's face: what it asks for when empty, the show notes it
// shows (and copies) when done, and Continue on a failed run.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const copied = vi.hoisted(() => ({ text: undefined as string | undefined }))
const store = vi.hoisted(() => ({ updateNodeData: vi.fn(), runSingleNode: vi.fn(), nodes: [{ id: "c1", type: "episode-chapters", data: {} }], edges: [] }))
const fanOut = vi.hoisted(() => ({ listDriven: false }))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "c1"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))
vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: ({ handleId, type, label }: any) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
  HANDLE_COLORS: { video: "#000", audio: "#111", text: "#222" },
}))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector(store),
}))
vi.mock("@/hooks/use-use-case-credits", () => ({ useUseCaseCredits: () => 10 }))
vi.mock("@/components/editor/workflow-editor/use-case-render-final-set", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usecaseListDriven: () => fanOut.listDriven,
}))

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyToClipboard: (text: string) => { copied.text = text },
}))

import { EpisodeChaptersNode } from "../episode-chapters-node"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)

function renderNode(data: Record<string, unknown>) {
  return render(<EpisodeChaptersNode {...({ id: "c1", data, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  store.updateNodeData.mockReset()
  store.runSingleNode.mockReset()
  fanOut.listDriven = false
  copied.text = undefined
})

describe("EpisodeChaptersNode", () => {
  it("empty: asks for a recording", () => {
    renderNode({ label: "Chapters", fieldMappings: {} })
    expect(screen.getByText(t("node.tightenConnectRecording"))).toBeInTheDocument()
  })

  it("its pips: Recording in (the label tables' key), the show notes and the chapter list out", () => {
    renderNode({ label: "Chapters", fieldMappings: {} })
    expect(screen.getByTestId("pip-target-media").textContent).toBe("Recording")
    expect(screen.getByTestId("pip-source-text").textContent).toBe(t("node.chaptersText"))
    expect(screen.getByTestId("pip-source-json").textContent).toBe(t("node.chaptersList"))
  })

  it("a finished run with no show notes says no chapters were found — it does not ask for a recording", () => {
    renderNode({ label: "Chapters", executionStatus: "completed", generatedText: "", fieldMappings: {} })
    expect(screen.getByText(t("node.chaptersNone"))).toBeInTheDocument()
    expect(screen.queryByText(t("node.tightenConnectRecording"))).toBeNull()
  })

  it("shows the show notes and copies them", async () => {
    renderNode({ label: "Chapters", executionStatus: "completed", generatedText: "0:00 Intro\n12:34 Main", fieldMappings: {} })
    expect(screen.getByText(/0:00 Intro/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: t("node.chaptersCopy") }))
    expect(copied.text).toBe("0:00 Intro\n12:34 Main")
  })

  it("a failed run offers Continue of its own run — that run's option, never node data", async () => {
    renderNode({ label: "Chapters", executionStatus: "failed", errorMessage: "Edit Plan: boom", useCaseJobId: "00000000-0000-4000-8000-000000000001", fieldMappings: {} })
    expect(screen.getByText("Edit Plan: boom")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: t("node.tightenContinue") }))
    expect(store.runSingleNode).toHaveBeenCalledWith("c1", { usecaseContinue: { mode: "from-failed", jobId: "00000000-0000-4000-8000-000000000001" } })
    expect(store.updateNodeData).not.toHaveBeenCalledWith("c1", expect.objectContaining({ useCaseContinue: expect.anything() }))
  })

  it("a failed run that never started its job offers no Continue", () => {
    renderNode({ label: "Chapters", executionStatus: "failed", errorMessage: "boom", fieldMappings: {} })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })

  it("a list-driven node (one run per item) offers no Continue", () => {
    fanOut.listDriven = true
    renderNode({ label: "Chapters", executionStatus: "failed", errorMessage: "boom", useCaseJobId: "job-0", fieldMappings: {} })
    expect(screen.queryByRole("button", { name: t("node.tightenContinue") })).toBeNull()
  })
})
