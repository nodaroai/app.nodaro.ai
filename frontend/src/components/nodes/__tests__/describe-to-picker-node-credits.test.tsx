import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import type { WorkflowNode } from "@/types/nodes"

/**
 * Decided 2026-10-09: an untouched Describe to Picker node runs Opus 5.5 at
 * effort high — on Anthropic's own API, so the run reserves the direct rung.
 * The node stores no effort, so its badge has to quote the default the run
 * uses, and quote the SAME row the panel and the run estimate do
 * (`getModelIdentifier`), or one node shows two prices.
 */

const quoted: string[] = []
vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: (creditId: string) => {
    quoted.push(creditId)
    return 0
  },
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) => selector({ updateNodeData: () => {}, nodes: [], edges: [] }),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: {} }))

const { DescribeToPickerNode } = await import("../describe-to-picker-node")
const { getModelIdentifier } = await import("@/components/editor/config-panels/helpers")

/** The row the node's badge asks for, checked against the panel's estimator. */
function badgeRow(data: Record<string, unknown>): string {
  const nodeData = { label: "Describe to Picker", ...data }
  quoted.length = 0
  const props = { id: "d1", type: "describe-to-picker", data: nodeData, selected: false } as unknown as NodeProps
  render(<DescribeToPickerNode {...props} />)
  const row = quoted.at(-1)!
  const node = { id: "d1", type: "describe-to-picker", position: { x: 0, y: 0 }, data: nodeData } as unknown as WorkflowNode
  expect(row, "the badge and the run estimate must quote one row").toBe(getModelIdentifier(node))
  return row
}

describe("Describe to Picker — the credit badge quotes the effort the run uses", () => {
  it("an untouched node quotes Opus 5.5 at high: the direct rung the run reserves", () => {
    expect(badgeRow({})).toBe("describe-to-picker:premium-direct")
  })

  it("another model with no effort quotes that model's Auto price", () => {
    expect(badgeRow({ llmModel: "gemini-3.8-flash" })).toBe("describe-to-picker:economy")
  })
})
