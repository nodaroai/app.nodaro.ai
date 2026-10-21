/**
 * The quick strip's LLM model dropdown (Task 13, D7): each model's estimate
 * beside it while metered pricing is on, quoted at the node's own metered
 * feature in ONE batch; none under the tier-pricing rollback. A model switch
 * from the strip clears Advanced mode, so only the current model is quoted on
 * its direct lane.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { llmPriceKey, orderedLlmModels } from "@nodaro/shared/llm-models"

const api = vi.hoisted(() => ({
  calls: [] as string[][],
  answer: { data: {} as Record<string, number>, missing: [] as string[] } as {
    data: Record<string, number>
    missing: string[]
    estimates?: string[]
  },
}))
vi.mock("@/lib/api", () => ({
  fetchBatchModelCreditCosts: vi.fn(async (models: string[]) => {
    api.calls.push(models)
    return api.answer
  }),
  getBatchModelCreditCosts: vi.fn(),
  getModelCreditCost: vi.fn(),
  estimateSeedanceRefCredits: vi.fn(),
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) =>
    sel({ updateNodeData: () => {}, nodes: [{ id: "n1", type: "qa-check", data: {} }], edges: [] }),
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <div data-testid={`item-${value}`}>{children}</div>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { queryClient } from "@/lib/query-client"
import { forgetEstimateModels, forgetUnpricedModels } from "@/hooks/use-model-credit-cost"
import { QuickConfigSelect, getQuickConfigs } from "../node-quick-configs"
import { llmModelFor } from "@/lib/llm-price-ids"

const modelControl = getQuickConfigs("qa-check").find((c) => c.field === "llmModel")!
const OPUS = "claude-opus-5.5"
const GROK = "grok-4.6"

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
  api.calls = []
  api.answer = { data: {}, missing: [] }
})

describe("quick strip LLM model prices", () => {
  it("lists each model's ~estimate, priced at the node's own feature", async () => {
    const opusKey = llmPriceKey("qa-check", OPUS)
    api.answer = { data: { [opusKey]: 6 }, missing: [], estimates: [opusKey] }
    render(<QuickConfigSelect nodeId="n1" control={modelControl} value={GROK} data={{ llmModel: GROK }} />)
    await waitFor(() => expect(screen.getByTestId(`quick-llm-price-${OPUS}`)).toHaveTextContent("~6 CR"))
    expect(api.calls).toHaveLength(1)
    expect(screen.getByTestId(`item-${OPUS}`)).toHaveTextContent("~6 CR")
  })

  it("shows no prices when no estimate comes back (rollback)", async () => {
    api.answer = { data: { "qa-check:premium": 3 }, missing: [llmPriceKey("qa-check", OPUS)] }
    render(<QuickConfigSelect nodeId="n1" control={modelControl} value={GROK} data={{ llmModel: GROK }} />)
    await waitFor(() => expect(api.calls).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId(`quick-llm-price-${OPUS}`)).not.toBeInTheDocument()
  })

  it("Advanced mode is quoted for the current model only — a switch here clears it", async () => {
    render(<QuickConfigSelect nodeId="n1" control={modelControl} value={OPUS} data={{ llmModel: OPUS, advancedMode: true }} />)
    await waitFor(() => expect(api.calls).toHaveLength(1))
    const asked = api.calls[0]!
    expect(asked).toContain(llmPriceKey("qa-check", OPUS, undefined, true))
    // Every other model is quoted as it would run once picked: without Advanced.
    const others = orderedLlmModels().map((m) => m.id).filter((id) => id !== OPUS)
    const advOnly = others.filter((id) => llmPriceKey("qa-check", id, undefined, true) !== llmPriceKey("qa-check", id, undefined, false))
    expect(advOnly.length).toBeGreaterThan(0)
    for (const id of advOnly) {
      expect(asked).not.toContain(llmPriceKey("qa-check", id, undefined, true))
      expect(asked).toContain(llmPriceKey("qa-check", id, undefined, false))
    }
  })

  it("an unset model with Advanced on: only the feature's default model is quoted direct", async () => {
    const def = llmModelFor("qa-check", undefined)!
    render(<QuickConfigSelect nodeId="n1" control={modelControl} value="" data={{ advancedMode: true }} />)
    await waitFor(() => expect(api.calls).toHaveLength(1))
    const asked = api.calls[0]!
    expect(asked).toContain(llmPriceKey("qa-check", def, undefined, true))
    const others = orderedLlmModels().map((m) => m.id).filter((id) => id !== def)
    for (const id of others) {
      const adv = llmPriceKey("qa-check", id, undefined, true)
      if (adv !== llmPriceKey("qa-check", id, undefined, false)) expect(asked).not.toContain(adv)
    }
  })
})
