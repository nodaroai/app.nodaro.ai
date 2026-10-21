/**
 * A metered LLM node's Run button (Task 13, spec §8.5, D7): the server's
 * estimate for the node's model shows as `Run (~6 CR)`; under the tier-pricing
 * rollback the server answers the metered key `missing` and the button shows
 * today's tier price with no `~`, exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const api = vi.hoisted(() => ({
  answer: { data: {} as Record<string, number>, missing: [] as string[] } as {
    data: Record<string, number>
    missing: string[]
    estimates?: string[]
  },
}))
vi.mock("@/lib/api", () => ({
  fetchBatchModelCreditCosts: vi.fn(async () => api.answer),
  getBatchModelCreditCosts: vi.fn(),
  getModelCreditCost: vi.fn(),
  estimateSeedanceRefCredits: vi.fn(),
  cancelJob: vi.fn(),
  stopGenerateVideoPro: vi.fn(),
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/node-run-abort", () => ({ abortNodeRun: vi.fn() }))
vi.mock("../node-settings-button", () => ({ NodeSettingsButton: () => null }))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  getListInputForNode: () => null,
}))

const storeNode = vi.hoisted(() => ({ id: "n1", type: "llm-chat", data: { llmModel: "claude-opus-5.5" } as Record<string, unknown> }))
vi.mock("@/hooks/use-workflow-store", () => {
  const state = { nodes: [storeNode], edges: [], updateNodeData: vi.fn() }
  const useWorkflowStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return { useWorkflowStore }
})

import { queryClient } from "@/lib/query-client"
import { useLocaleStore } from "@/lib/locale-store"
import { forgetEstimateModels, forgetUnpricedModels } from "@/hooks/use-model-credit-cost"
import { useLlmNodeCredits } from "@/hooks/use-llm-price"
import { RunNodeButton } from "../run-node-button"

const KEY = "llm-chat:claude-opus-5.5"
const TIER = "llm-chat:premium"

/** What an LLM node renders: its price from `useLlmNodeCredits`, into the Run button. */
function LlmRun() {
  const { credits, estimate } = useLlmNodeCredits("llm-chat", storeNode.data, 3)
  return <RunNodeButton nodeId="n1" credits={credits} creditsEstimate={estimate} isRunning={false} onRun={() => {}} />
}

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
})
afterEach(() => {
  useLocaleStore.setState({ locale: "en" })
})

describe("Run button price for a metered LLM node", () => {
  it("Run button shows ~ for a metered node", async () => {
    api.answer = { data: { [KEY]: 6, [TIER]: 3 }, missing: [], estimates: [KEY] }
    render(<LlmRun />)
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Run(~6 CR)"))
  })

  it("Run button shows today's price without ~ under rollback (key missing)", async () => {
    api.answer = { data: { [TIER]: 3 }, missing: [KEY] }
    render(<LlmRun />)
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Run(3 CR)"))
    expect(screen.getByRole("button").textContent).not.toContain("~")
  })

  it("he locale renders the deployment unit, not 'CR'", async () => {
    useLocaleStore.setState({ locale: "he" })
    api.answer = { data: { [KEY]: 6, [TIER]: 3 }, missing: [], estimates: [KEY] }
    render(<LlmRun />)
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("~6"))
    expect(screen.getByRole("button").textContent).toContain("קר׳")
    expect(screen.getByRole("button").textContent).not.toContain("CR")
  })

  it("a fixed-price node's button is unchanged", () => {
    render(<RunNodeButton nodeId="n1" credits={44} isRunning={false} onRun={() => {}} />)
    expect(screen.getByRole("button")).toHaveTextContent("Run(44 CR)")
  })
})
