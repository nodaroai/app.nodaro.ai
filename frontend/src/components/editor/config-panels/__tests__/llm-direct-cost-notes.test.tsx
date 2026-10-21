/**
 * The Effort and Advanced notes (Task 13): under metered pricing a run on the
 * vendor's own API is not "one tier more" — the note says "about N× the cost",
 * N from the server's two lane estimates. Under the tier-pricing rollback no
 * estimate comes back and the notes keep their tier-era words.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
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
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { queryClient } from "@/lib/query-client"
import { fetchBatchModelCreditCosts } from "@/lib/api"
import { tx } from "@/lib/i18n"
import { forgetEstimateModels, forgetUnpricedModels } from "@/hooks/use-model-credit-cost"
import { AdvancedModeToggle } from "../advanced-mode-toggle"
import { ReasoningEffortSelect } from "../reasoning-effort-select"

const KEY = "llm-chat:claude-opus-5.5"
const DIRECT = `${KEY}:direct`

beforeEach(() => {
  vi.mocked(fetchBatchModelCreditCosts).mockClear()
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
})

describe("Advanced mode note", () => {
  it("metered: runs on the vendor's API — about N× the cost, N from the two lane estimates", async () => {
    api.answer = { data: { [KEY]: 6, [DIRECT]: 14 }, missing: [], estimates: [KEY, DIRECT] }
    render(<AdvancedModeToggle feature="llm-chat" modelId="claude-opus-5.5" onChange={() => {}} />)
    await waitFor(() => expect(screen.getByText(tx("cfgshared.advancedModeHintMetered", { n: 2.3 }))).toBeInTheDocument())
  })

  it("rollback: the tier-era note, exactly as before", async () => {
    api.answer = { data: { "llm-chat:premium": 3, "llm-chat:premium-direct": 5 }, missing: [KEY, DIRECT] }
    render(<AdvancedModeToggle feature="llm-chat" modelId="claude-opus-5.5" onChange={() => {}} />)
    // After the batch answered: still the tier-era words.
    await waitFor(() => expect(vi.mocked(fetchBatchModelCreditCosts)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText(tx("cfgshared.advancedModeHint"))).toBeInTheDocument()
  })
})

describe("Effort note on a Claude model", () => {
  it("metered: about N× the cost", async () => {
    api.answer = { data: { [KEY]: 6, [DIRECT]: 14 }, missing: [], estimates: [KEY, DIRECT] }
    render(<ReasoningEffortSelect feature="llm-chat" modelId="claude-opus-5.5" onChange={() => {}} />)
    await waitFor(() => expect(screen.getByText(tx("cfgshared.effortRunsDirectMetered", { n: 2.3 }))).toBeInTheDocument())
  })

  it("metered, lanes about the same: no multiple is claimed", async () => {
    api.answer = { data: { [KEY]: 6, [DIRECT]: 7 }, missing: [], estimates: [KEY, DIRECT] }
    render(<ReasoningEffortSelect feature="llm-chat" modelId="claude-opus-5.5" onChange={() => {}} />)
    await waitFor(() => expect(screen.getByText(tx("cfgshared.effortRunsDirectMeteredPlain"))).toBeInTheDocument())
  })

  it("rollback: the tier-era note", async () => {
    api.answer = { data: {}, missing: [KEY, DIRECT] }
    render(<ReasoningEffortSelect feature="llm-chat" modelId="claude-opus-5.5" onChange={() => {}} />)
    await waitFor(() => expect(vi.mocked(fetchBatchModelCreditCosts)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText(tx("cfgshared.effortRunsDirect"))).toBeInTheDocument()
  })
})
