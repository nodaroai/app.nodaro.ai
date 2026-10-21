/**
 * `useLlmPrice` — the price an LLM surface shows (Task 13, D7, spec §8.5).
 *
 * The hook asks the batch for BOTH the metered price key and today's tier id
 * in one request. Only the server decides which applies: a key it marks in
 * `estimates` is shown `~N`; a key it reports `missing` (the tier-pricing
 * rollback) leaves the tier price, shown exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

const api = vi.hoisted(() => ({
  calls: [] as string[][],
  answer: { data: {} as Record<string, number>, missing: [] as string[] } as {
    data: Record<string, number>
    missing: string[]
    estimates?: string[]
    errorCodes?: Record<string, { code: string; message: string }>
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

import { queryClient } from "@/lib/query-client"
import { useLocaleStore } from "@/lib/locale-store"
import { tx } from "@/lib/i18n"
import { forgetEstimateModels, forgetUnpricedModels } from "../use-model-credit-cost"
import { formatCreditsSuffix, llmPickerPriceLabel, useLlmNodePrice, useLlmPrice } from "../use-llm-price"
import { llmPriceKey, resolveScriptModelId } from "@nodaro/shared/llm-models"

const KEY = "llm-chat:claude-opus-5.5"
const TIER = "llm-chat:premium"

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

describe("useLlmPrice", () => {
  it("asks for the metered key and the tier id in ONE batch", async () => {
    api.answer = { data: { [KEY]: 6, [TIER]: 3 }, missing: [], estimates: [KEY] }
    renderHook(() => useLlmPrice("llm-chat", "claude-opus-5.5"))
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual([KEY, TIER])
  })

  it("a key the server marks in `estimates` is the price, as an estimate", async () => {
    api.answer = { data: { [KEY]: 6, [TIER]: 3 }, missing: [], estimates: [KEY] }
    const { result } = renderHook(() => useLlmPrice("llm-chat", "claude-opus-5.5"))
    await waitFor(() => expect(result.current.credits).toBe(6))
    expect(result.current).toEqual({ credits: 6, estimate: true, loading: false })
  })

  it("rollback: the key comes back `missing`, so the tier price shows with no ~", async () => {
    api.answer = { data: { [TIER]: 3 }, missing: [KEY] }
    const { result } = renderHook(() => useLlmPrice("llm-chat", "claude-opus-5.5"))
    await waitFor(() => expect(result.current.credits).toBe(3))
    expect(result.current).toEqual({ credits: 3, estimate: false, loading: false })
  })

  it("an unset model prices the feature's default model", async () => {
    api.answer = { data: {}, missing: [] }
    renderHook(() => useLlmPrice("llm-chat", undefined))
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]![0]).toBe("llm-chat:gemini-3.6-flash")
  })

  it("Advanced mode prices the direct key", async () => {
    api.answer = { data: { [`${KEY}:direct`]: 14 }, missing: [], estimates: [`${KEY}:direct`] }
    const { result } = renderHook(() => useLlmPrice("llm-chat", "claude-opus-5.5", undefined, true))
    await waitFor(() => expect(result.current.credits).toBe(14))
    expect(api.calls[0]).toEqual([`${KEY}:direct`, "llm-chat:premium-direct"])
    expect(result.current.estimate).toBe(true)
  })

  it("a model the server refuses to price shows no figure (never the tier's)", async () => {
    api.answer = {
      data: { [TIER]: 3 },
      missing: [],
      errors: [KEY],
      errorCodes: { [KEY]: { code: "llm_model_unpriced", message: "no price" } },
    } as typeof api.answer
    const { result } = renderHook(() => useLlmPrice("llm-chat", "claude-opus-5.5"))
    await waitFor(() => expect(result.current.refused).toBe(true))
    expect(result.current.credits).toBeUndefined()
  })
})

describe("formatCreditsSuffix", () => {
  const t = (key: Parameters<typeof tx>[0], vars?: Record<string, string | number>) => tx(key, vars)

  it("an estimate reads (~N CR), a fixed price (N CR)", () => {
    expect(formatCreditsSuffix(t, 6, true)).toBe("(~6 CR)")
    expect(formatCreditsSuffix(t, 6, false)).toBe("(6 CR)")
  })

  it("he locale renders the deployment unit, not 'CR'", () => {
    useLocaleStore.setState({ locale: "he" })
    const s = formatCreditsSuffix(t, 6, true)
    expect(s).toContain("~6")
    expect(s).toContain(tx("credits.unitShort"))
    expect(s).not.toContain("CR")
  })
})

describe("llmPickerPriceLabel", () => {
  it("labels an estimate `~N CR`", () => {
    expect(llmPickerPriceLabel({ credits: 6, estimate: true, loading: false }, "CR")).toBe("~6 CR")
  })

  it("shows nothing for a price that is not an estimate (rollback: no prices in the picker)", () => {
    expect(llmPickerPriceLabel({ credits: 3, estimate: false, loading: false }, "CR")).toBeUndefined()
    expect(llmPickerPriceLabel(undefined, "CR")).toBeUndefined()
  })
})

describe("useLlmNodePrice: a node's pill priced by the run's own rule", () => {
  it("Generate Script on a legacy script provider asks the key of the model its run resolves", async () => {
    const data = { provider: "claude" }
    const key = llmPriceKey("generate-script", resolveScriptModelId("claude", undefined))
    api.answer = { data: { [key]: 4 }, missing: [], estimates: [key] }
    const { result } = renderHook(() => useLlmNodePrice({ type: "generate-script", data }, 10))
    await waitFor(() => expect(result.current).toMatchObject({ credits: 4, estimate: true }))
    expect(api.calls[0]).toContain(key)
  })

  it("a deterministic Edit 3D Scene (operations) makes no call: no LLM figure, nothing asked", () => {
    const { result } = renderHook(() => useLlmNodePrice({ type: "edit-3d-scene", data: { operations: [] } }, 30))
    expect(result.current).toEqual({ credits: undefined, estimate: false, metered: false })
    expect(api.calls).toEqual([])
  })
})
