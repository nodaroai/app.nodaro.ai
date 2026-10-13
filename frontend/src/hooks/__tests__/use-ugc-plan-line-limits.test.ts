/**
 * The plan's line limits as the server hands them with a UGC estimate, read
 * untrusted: all three — the opening line's, a beat line's, the closing line's,
 * each a whole number of characters — or none, so the script editor sets no
 * limit rather than a wrong one. The hook itself reads them off the estimate's
 * answer (`/v1/ugc/quote`), through the same query every surface prices with.
 * The numbers are placeholders.
 */
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({ estimate: vi.fn(), credits: true }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ugcEstimateApi: (...a: unknown[]) => h.estimate(...a),
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => h.credits,
}))

import { readUgcPlanLineLimits, useUgcPlanLineLimits } from "../use-ugc-plan-line-limits"

describe("the plan's line limits, as the server hands them", () => {
  it("all three whole numbers of characters are the limits", () => {
    expect(readUgcPlanLineLimits({ hook: 12, beatLine: 20, closerLine: 16 })).toEqual({ hook: 12, beatLine: 20, closerLine: 16 })
  })
  it("anything less — an older plugin's silence, a missing or a bad limit — is none", () => {
    for (const raw of [undefined, null, 12, "12", [], {}, { hook: 12, beatLine: 20 }, { hook: 0, beatLine: 20, closerLine: 16 }, { hook: 12.5, beatLine: 20, closerLine: 16 }, { hook: "12", beatLine: 20, closerLine: 16 }, { hook: -1, beatLine: 20, closerLine: 16 }]) {
      expect(readUgcPlanLineLimits(raw), JSON.stringify(raw)).toBeUndefined()
    }
  })
})

describe("useUgcPlanLineLimits: the limits the estimate's answer carries", () => {
  const PARTS = { script: 1, creator: 1, clip: 1, cards: 1, join: 1, overlay: 1, captions: 1 }
  const ANSWER = { lines: [], expected: 7, ceiling: 7, range: [7, 7], worstCase: 7, parts: PARTS, holdParts: PARTS }
  const LIMITS = { hook: 12, beatLine: 20, closerLine: 16 }
  const wrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  }

  beforeEach(() => {
    h.estimate.mockReset()
    h.credits = true
  })

  it("hands the script editor the server's limits", async () => {
    h.estimate.mockResolvedValue({ ...ANSWER, limits: LIMITS })
    const { result } = renderHook(() => useUgcPlanLineLimits(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toEqual(LIMITS))
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })

  it("an answer with no limits (an older plugin) sets none", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    const { result } = renderHook(() => useUgcPlanLineLimits(), { wrapper: wrapper() })
    await waitFor(() => expect(h.estimate).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toBeUndefined()
  })

  it("where no estimate is served (no credits), asks nothing and sets none", async () => {
    h.credits = false
    h.estimate.mockResolvedValue({ ...ANSWER, limits: LIMITS })
    const { result } = renderHook(() => useUgcPlanLineLimits(), { wrapper: wrapper() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.estimate).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })
})
