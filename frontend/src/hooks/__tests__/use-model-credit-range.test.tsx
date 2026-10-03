/**
 * A model picker quotes a variable-priced model as "min-max CR". That range
 * used to be read off the catalog's BASE prices, so it sat below what the Run
 * button charged. `useModelCreditRange` reads the CHARGED price of every
 * variant (in batches the route accepts) and seeds the per-identifier cache
 * the Run buttons read, so the picker and the button quote one number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import { MODEL_CATALOG } from "@nodaro/shared"

const { edition, batchCalls } = vi.hoisted(() => ({
  edition: { credits: true },
  batchCalls: [] as string[][],
}))

vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => edition.credits,
}))

/** Every identifier is charged 10% over its catalog base, rounded up. */
const charged = (identifier: string): number | undefined => {
  for (const m of Object.values(MODEL_CATALOG)) {
    const row = m.pricing.find((p) => p.identifier === identifier)
    if (row) return Math.ceil((row.credits * 110) / 100)
  }
  return undefined
}

vi.mock("@/lib/api", () => ({
  getBatchModelCreditCosts: vi.fn(async (models: string[]) => {
    batchCalls.push(models)
    return Object.fromEntries(models.flatMap((id) => (charged(id) === undefined ? [] : [[id, charged(id)]])))
  }),
}))

import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { useModelCreditRange } from "../use-model-credit-range"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

beforeEach(() => {
  queryClient.clear()
  batchCalls.length = 0
  edition.credits = true
})

describe("useModelCreditRange", () => {
  it("quotes the charged range of a variable-priced model, not the catalog's base range", async () => {
    // nano-banana-2 lists 20 / 50 / 50 in the catalog.
    const { result } = renderHook(() => useModelCreditRange("nano-banana-2"), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ min: 22, max: 55 }))
  })

  it("asks for every variant in batches the route accepts, once, and seeds the Run buttons' cache", async () => {
    const { result } = renderHook(() => useModelCreditRange("nano-banana-2"), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())

    const requested = batchCalls.flat()
    expect(batchCalls.every((batch) => batch.length <= 50)).toBe(true)
    expect(new Set(requested).size).toBe(requested.length)
    expect(queryClient.getQueryData(queryKeys.credits.modelCost("nano-banana-2:2K"))).toBe(55)
  })

  it("answers nothing and asks for nothing for a fixed-price model", () => {
    const fixed = Object.values(MODEL_CATALOG).find((m) => m.pricing.length === 1)!
    const { result } = renderHook(() => useModelCreditRange(fixed.id), { wrapper })
    expect(result.current).toBeUndefined()
    expect(batchCalls).toEqual([])
  })

  it("answers nothing and asks for nothing without a credit system", () => {
    edition.credits = false
    const { result } = renderHook(() => useModelCreditRange("nano-banana-2"), { wrapper })
    expect(result.current).toBeUndefined()
    expect(batchCalls).toEqual([])
  })
})
