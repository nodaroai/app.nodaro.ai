/**
 * Per-model prices in the LLM model picker (Task 13, D7): while metered pricing
 * is on, each model row shows its `≈price` beside its tier badge, quoted from
 * ONE batch for every row; when no estimate comes back (the tier-pricing
 * rollback answers every metered key `missing`) the picker shows no prices and
 * looks exactly as before. Tier badges stay either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LLM_MODELS, llmPriceKey } from "@nodaro/shared/llm-models"
import { TIER_BILLED_LLM_FEATURES } from "@nodaro/render-rules"

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
vi.mock("../model-description-hint", () => ({ ModelDescriptionHint: () => null }))

import { queryClient } from "@/lib/query-client"
import { useLocaleStore } from "@/lib/locale-store"
import { forgetEstimateModels, forgetUnpricedModels } from "@/hooks/use-model-credit-cost"
import { LlmModelSelect } from "../llm-model-select"

const OPUS = "claude-opus-5.5"
const GROK = "grok-4.6"

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
  api.calls = []
  api.answer = { data: {}, missing: [] }
})
afterEach(() => {
  useLocaleStore.setState({ locale: "en" })
})

describe("LlmModelSelect prices", () => {
  it("picker lists ≈price beside each model's tier badge", async () => {
    const opusKey = llmPriceKey("llm-chat", OPUS)
    const grokKey = llmPriceKey("llm-chat", GROK)
    api.answer = { data: { [opusKey]: 6, [grokKey]: 2 }, missing: [], estimates: [opusKey, grokKey] }
    render(<LlmModelSelect feature="llm-chat" value={GROK} onChange={() => {}} />)
    // ONE batch for every row: each model's key and its tier id.
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual(expect.arrayContaining(LLM_MODELS.map((m) => llmPriceKey("llm-chat", m.id))))
    // The trigger shows the selected model's price beside its tier.
    await waitFor(() => expect(screen.getByTestId("llm-model-price")).toHaveTextContent("≈2 CR"))
    const trigger = screen.getByRole("combobox", { name: "AI Model" })
    expect(trigger).toHaveTextContent("Standard")
    fireEvent.click(trigger)
    expect(screen.getByTestId(`llm-model-price-${OPUS}`)).toHaveTextContent("≈6 CR")
    expect(screen.getByTestId(`llm-model-price-${GROK}`)).toHaveTextContent("≈2 CR")
  })

  it("picker hides prices when no estimate comes back", async () => {
    // Rollback: every metered key is `missing`; only the tier ids are priced.
    api.answer = {
      data: { "llm-chat:premium": 3, "llm-chat": 1, "llm-chat:economy": 1 },
      missing: LLM_MODELS.map((m) => llmPriceKey("llm-chat", m.id)),
    }
    render(<LlmModelSelect feature="llm-chat" value={GROK} onChange={() => {}} />)
    await waitFor(() => expect(api.calls).toHaveLength(1))
    fireEvent.click(screen.getByRole("combobox", { name: "AI Model" }))
    expect(screen.queryByTestId("llm-model-price")).not.toBeInTheDocument()
    expect(screen.queryByTestId(`llm-model-price-${OPUS}`)).not.toBeInTheDocument()
    // The tier badges stay.
    expect(screen.getAllByText("Premium").length).toBeGreaterThan(0)
  })

  it("he locale renders the deployment unit, not 'CR'", async () => {
    useLocaleStore.setState({ locale: "he" })
    const grokKey = llmPriceKey("llm-chat", GROK)
    api.answer = { data: { [grokKey]: 2 }, missing: [], estimates: [grokKey] }
    render(<LlmModelSelect feature="llm-chat" value={GROK} onChange={() => {}} />)
    await waitFor(() => expect(screen.getByTestId("llm-model-price")).toHaveTextContent("≈2"))
    expect(screen.getByTestId("llm-model-price").textContent).toContain("קר׳")
    expect(screen.getByTestId("llm-model-price").textContent).not.toContain("CR")
  })

  it("a tier-billed feature (Content Recipe / Ideas) never asks or shows a per-model ≈price, even when metered pricing is on", async () => {
    // Metered pricing on: llm-chat keys are estimates. Content Recipe bills its tier row (its plugin
    // does not meter): the picker must not quote a per-model figure the run is not charged.
    const leak = Object.fromEntries(LLM_MODELS.map((m) => [`content-recipe:${m.id}`, 4]))
    api.answer = { data: { ...leak, "content-recipe": 20 }, missing: [], estimates: Object.keys(leak) }
    for (const feature of TIER_BILLED_LLM_FEATURES) {
      if (feature === "workflow-copilot") continue // no node picker
      api.calls = []
      const { unmount } = render(<LlmModelSelect feature={feature} value={GROK} onChange={() => {}} />)
      await waitFor(() => expect(api.calls).toHaveLength(1))
      // Only tier ids are asked: no `<feature>:<model>` key.
      expect(api.calls[0]!.some((id) => LLM_MODELS.some((m) => id.startsWith(`${feature}:${m.id}`))), feature).toBe(false)
      fireEvent.click(screen.getByRole("combobox", { name: "AI Model" }))
      expect(screen.queryByTestId("llm-model-price")).not.toBeInTheDocument()
      expect(screen.queryByTestId(`llm-model-price-${OPUS}`)).not.toBeInTheDocument()
      unmount()
    }
  })
})
