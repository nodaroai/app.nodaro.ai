import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => {
  const I = (p: Record<string, unknown>) => <span data-testid="mock-icon" {...p} />
  return { RotateCw: I, ChevronDown: I }
})

// Radix DropdownMenu → plain DOM (jsdom lacks the pointer machinery), same
// shells as run-node-button.test.tsx. asChild renders the trigger directly.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

const updateNodeData = vi.fn()
const runSingleNode = vi.fn()
let storeNode: { id: string; type: string; data: Record<string, unknown> }
function makeStore() {
  const state = { nodes: [storeNode], edges: [], updateNodeData, runSingleNode }
  return Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state })
}
vi.mock("@/hooks/use-workflow-store", () => ({
  get useWorkflowStore() {
    return makeStore()
  },
}))

import { GvpContinueControl } from "../gvp-continue-control"

function setNode(data: Record<string, unknown>) {
  storeNode = { id: "n1", type: "generate-video-pro", data }
}

// A stopped 3-of-5 delivery: results carry the stopped job's id.
const STOPPED_PARTIAL = {
  executionStatus: "completed",
  gvpStopped: true,
  gvpDeliveredSegments: 3,
  gvpSegmentCount: 5,
  generatedResults: [{ url: "https://r2/partial.mp4", jobId: "job-stopped", timestamp: 1 }],
  activeResultIndex: 0,
}

beforeEach(() => vi.clearAllMocks())

describe("GvpContinueControl", () => {
  it("renders 'Continue' after a stopped/partial completion, with the segment fraction", () => {
    setNode(STOPPED_PARTIAL)
    render(<GvpContinueControl nodeId="n1" />)
    expect(screen.getByText("Continue")).toBeInTheDocument()
    expect(screen.getByText(/rendered 3 of 5 segments/i)).toBeInTheDocument()
  })

  it("Resume continues from the first missing segment (delivered+1), setting the intent then running", () => {
    setNode(STOPPED_PARTIAL)
    render(<GvpContinueControl nodeId="n1" />)
    fireEvent.click(screen.getByText(/resume — from segment 4/i))

    expect(updateNodeData).toHaveBeenCalledWith("n1", { gvpContinueFromJobId: "job-stopped", gvpContinueFromSegment: 4 })
    expect(runSingleNode).toHaveBeenCalledWith("n1")
    // Ordering: the intent is written BEFORE the run fires.
    expect(updateNodeData.mock.invocationCallOrder[0]).toBeLessThan(runSingleNode.mock.invocationCallOrder[0])
  })

  it("offers redo-from-earlier options (1..delivered), each continuing from that segment", () => {
    setNode(STOPPED_PARTIAL)
    render(<GvpContinueControl nodeId="n1" />)
    // 1..3 redo options plus the resume (4)
    fireEvent.click(screen.getByText(/redo from segment 2/i))
    expect(updateNodeData).toHaveBeenCalledWith("n1", { gvpContinueFromJobId: "job-stopped", gvpContinueFromSegment: 2 })
    expect(runSingleNode).toHaveBeenCalledWith("n1")
  })

  it("detects a failure-rescued partial (deliveredSegments < segmentCount, no stopped flag)", () => {
    setNode({ ...STOPPED_PARTIAL, gvpStopped: undefined })
    render(<GvpContinueControl nodeId="n1" />)
    expect(screen.getByText("Continue")).toBeInTheDocument()
  })

  it("renders nothing for a FULL completion (delivered === segmentCount)", () => {
    setNode({ ...STOPPED_PARTIAL, gvpStopped: undefined, gvpDeliveredSegments: 5, gvpSegmentCount: 5 })
    const { container } = render(<GvpContinueControl nodeId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing while the node is still running", () => {
    setNode({ ...STOPPED_PARTIAL, executionStatus: "running" })
    const { container } = render(<GvpContinueControl nodeId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing for a single-segment run (no segment accounting on output_data.pro)", () => {
    setNode({ executionStatus: "completed", generatedResults: [{ url: "https://r2/x.mp4", jobId: "j", timestamp: 1 }], activeResultIndex: 0 })
    const { container } = render(<GvpContinueControl nodeId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })
})
