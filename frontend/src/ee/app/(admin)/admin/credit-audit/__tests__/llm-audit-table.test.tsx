/**
 * The credit audit's LLM mode: no provider session token (every figure is our
 * own), `days` sent to `POST /v1/admin/credit-audit/llm`, and one row per
 * (feature, model) with its UNDERPRICED / OVERPRICED / OK status, the
 * absorbed shortfall and the unsettled holds beside it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })),
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))

import AdminCreditAudit from "../page"
import { LlmAuditTable, type LlmAuditResult, type LlmAuditRow } from "../llm-audit-table"

function row(over: Partial<LlmAuditRow>): LlmAuditRow {
  return {
    feature: "llm-chat",
    model: "claude-fable-5",
    tasks: 2,
    providerCostUsd: 1.71307,
    providerCostInCredits: 856.535,
    markupPercent: 10,
    expectedCredits: 943,
    chargedCredits: 495,
    shortfallCredits: 449,
    estimatedShare: 0.5,
    diff: -448,
    diffPercent: -47.51,
    status: "UNDERPRICED",
    uncollectedOverruns: 1,
    unsettledHolds: 0,
    uncomputableTasks: 0,
    fixedCreditsExcluded: 0,
    ...over,
  }
}

const RESULT: LlmAuditResult = {
  mode: "llm",
  lookbackMinutes: 7 * 1440,
  markupPercent: 10,
  mismatches: 2,
  totalJobs: 13,
  refundedBilled: { tasks: 2, costUsd: 0.4, uncomputableTasks: 1 },
  missingLedgers: 1,
  truncated: false,
  models: [
    row({ refundedBilledTasks: 2, refundedBilledCostUsd: 0.4, refundedBilledUncomputableTasks: 1, missingLedgers: 1 }),
    row({
      feature: "llm-structured", model: "gemini-3.8-flash", tasks: 10, providerCostUsd: 0.002, providerCostInCredits: 1,
      expectedCredits: 2, chargedCredits: 20, shortfallCredits: 0, estimatedShare: 0, diff: 18, diffPercent: 900,
      status: "OVERPRICED", uncollectedOverruns: 0, markupPercent: 30, mixedMarkup: true,
    }),
    row({
      feature: "meta-ads-analysis", model: "gemini-3.8-flash", tasks: 1, providerCostUsd: 0.01, providerCostInCredits: 5,
      expectedCredits: 6, chargedCredits: 6, shortfallCredits: 0, estimatedShare: 0, diff: 0, diffPercent: 0,
      status: "OK", uncollectedOverruns: 0, unsettledHolds: 2,
    }),
  ],
}

beforeEach(() => {
  h.getAuthHeaders.mockClear()
  try { localStorage.clear() } catch { /* ignore */ }
  vi.unstubAllGlobals()
})

describe("LlmAuditTable", () => {
  it("renders one row per feature and model with its status", () => {
    render(<LlmAuditTable result={RESULT} />)
    const fable = screen.getByRole("row", { name: /llm-chat.*claude-fable-5/ })
    expect(within(fable).getByText("Underpriced")).toBeTruthy()
    expect(within(fable).getByText("943")).toBeTruthy()
    expect(within(fable).getByText("495")).toBeTruthy()
    expect(within(fable).getByText("449")).toBeTruthy()
    expect(within(fable).getByText("-448")).toBeTruthy()
    expect(within(fable).getByText("50%")).toBeTruthy()

    const tiny = screen.getByRole("row", { name: /llm-structured.*gemini-3\.8-flash/ })
    expect(within(tiny).getByText("Overpriced")).toBeTruthy()
    expect(within(tiny).getByText("+18")).toBeTruthy()
    expect(within(tiny).getByText("+900%")).toBeTruthy()

    const scrape = screen.getByRole("row", { name: /meta-ads-analysis/ })
    expect(within(scrape).getByText("OK")).toBeTruthy()
    expect(within(scrape).getByText(/2 unsettled/)).toBeTruthy()
    expect(within(scrape).getByText(/2 unsettled/).getAttribute("title")).toMatch(/reconcile sweep/)
    expect(within(fable).getByText("2 refunded billed (1 cost unknown)")).toBeTruthy()
    expect(within(fable).getByText(/1 no ledger/)).toBeTruthy()
    expect(within(tiny).getByText("~30%")).toBeTruthy()

    expect(screen.getByText("Refunded but Billed")).toBeTruthy()
    expect(screen.getByText("$0.4000 provider cost + 1 uncomputable")).toBeTruthy()
    expect(screen.getByText("Missing Ledgers")).toBeTruthy()
  })

  it("a result saved before the later fields renders without them", () => {
    const old = {
      ...RESULT,
      refundedBilled: undefined,
      missingLedgers: undefined,
      models: RESULT.models.map(({ refundedBilledTasks: _a, refundedBilledCostUsd: _b, refundedBilledUncomputableTasks: _f, missingLedgers: _c, mixedMarkup: _d, negativeRemainderTasks: _e, ...m }) => m),
    }
    render(<LlmAuditTable result={old} />)
    expect(screen.getByText("Refunded but Billed").parentElement!.textContent).toContain("0")
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it("filters to the mismatches", async () => {
    render(<LlmAuditTable result={RESULT} />)
    await userEvent.click(screen.getByRole("button", { name: /Mismatches \(2\)/ }))
    expect(screen.queryByRole("row", { name: /meta-ads-analysis/ })).toBeNull()
    expect(screen.getByRole("row", { name: /claude-fable-5/ })).toBeTruthy()
  })
})

describe("the credit audit page's LLM mode", () => {
  it("the page's llm mode needs no KIE token and renders statuses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200, headers: { "Content-Type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<AdminCreditAudit />)

    await userEvent.click(screen.getByRole("button", { name: /^LLM Metered$/ }))
    // No token field in this mode, and the emergency-lever note is shown.
    expect(screen.queryByPlaceholderText(/authorization header/i)).toBeNull()
    expect(screen.getByText(/emergency lever/i)).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText(/Lookback/i), "30")
    await userEvent.click(screen.getByRole("button", { name: /Run Audit/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/v1/admin/credit-audit/llm")
    expect(JSON.parse(init.body as string)).toEqual({ days: 30 })

    expect(await screen.findByText("Underpriced")).toBeTruthy()
    expect(screen.getByText("Overpriced")).toBeTruthy()
  })

  it("a saved LLM result renders on load", () => {
    localStorage.setItem("nodaro-credit-audit-result", JSON.stringify({ ...RESULT, timestamp: "2026-10-20T10:00:00.000Z" }))
    render(<AdminCreditAudit />)
    expect(screen.getByRole("row", { name: /claude-fable-5/ })).toBeTruthy()
  })
})
