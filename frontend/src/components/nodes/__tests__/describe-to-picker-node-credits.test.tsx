import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import type { WorkflowNode } from "@/types/nodes"

/**
 * Decided 2026-10-20: an untouched Describe to Picker node runs Gemini 3.8
 * Flash at Auto on the aggregator, the economy rung. Opus 5.5, when chosen,
 * keeps its 2026-10-09 recipe — effort high on Anthropic's own API, the direct
 * rung. The node stores neither the default model nor the recipe effort, so
 * its badge has to quote what the run uses, and quote the SAME row the panel
 * and the run estimate do (`getModelIdentifier`), or one node shows two prices.
 */

// The ids the node's price asks the batch for: its metered key and its tier
// id, in ONE request (`useLlmPrice`, Task 13).
const asked: string[][] = []
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-model-credit-cost")>()),
  prefetchModelCreditCosts: async (ids: readonly string[]) => {
    asked.push([...ids])
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
const { forgetEstimateModels, rememberEstimateModels } = await import("@/hooks/use-model-credit-cost")

/**
 * The tier row the node's badge asks for, checked against the panel's
 * estimator: with a cold cache (and under the tier-pricing rollback) both
 * quote that row; once the server marks the metered key an estimate, both
 * quote the key.
 */
function badgeRow(data: Record<string, unknown>): { key: string; tier: string } {
  const nodeData = { label: "Describe to Picker", ...data }
  asked.length = 0
  forgetEstimateModels()
  const props = { id: "d1", type: "describe-to-picker", data: nodeData, selected: false } as unknown as NodeProps
  render(<DescribeToPickerNode {...props} />)
  const [key, tier] = asked.at(-1)!
  const node = { id: "d1", type: "describe-to-picker", position: { x: 0, y: 0 }, data: nodeData } as unknown as WorkflowNode
  expect(tier, "the badge and the run estimate must quote one row").toBe(getModelIdentifier(node))
  rememberEstimateModels([key!])
  expect(getModelIdentifier(node), "metered: both quote the key").toBe(key)
  forgetEstimateModels()
  return { key: key!, tier: tier! }
}

describe("Describe to Picker — the credit badge quotes the effort the run uses", () => {
  it("an untouched node quotes Gemini 3.8 Flash at Auto: the economy rung the run reserves", () => {
    expect(badgeRow({})).toEqual({ key: "describe-to-picker:gemini-3.8-flash", tier: "describe-to-picker:economy" })
  })

  it("Opus 5.5 with no effort quotes its recipe, high: the direct rung the run reserves", () => {
    expect(badgeRow({ llmModel: "claude-opus-5.5" })).toEqual({ key: "describe-to-picker:claude-opus-5.5:direct", tier: "describe-to-picker:premium-direct" })
  })

  it("another model with no effort quotes that model's Auto price", () => {
    expect(badgeRow({ llmModel: "claude-opus-5" })).toEqual({ key: "describe-to-picker:claude-opus-5", tier: "describe-to-picker:premium" })
  })
})
