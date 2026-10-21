/**
 * The cancel rule for a FIXED-price hold carrying billed metered calls (D10 /
 * R22): a Meta Ads / Instagram scrape keeps ONE usage log under its fixed
 * scrape id (not a metered id) and records its analyses' spend in its
 * server-only ledger (`jobs.llm_billing`, R32 — never `output_data`). A cancel mid-run commits what was billed — the
 * spend recorded so far at the ledger's charge id, or the hold whole when the
 * ledger cannot be priced — and never refunds it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  logs: [] as Array<{ id: string; credits_used: number | null }>,
  /** The job's server-only ledger column. */
  ledger: null as Record<string, unknown> | null,
  /** The jobs read errors (supabase's returned-error shape). */
  jobError: false,
  jobSelects: [] as string[],
  logsError: false,
  commit: vi.fn(async (..._a: unknown[]) => ({ charged: 28, shortfall: 0 }) as { charged: number; shortfall: number } | undefined),
  jobWrites: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === "usage_logs") {
          return { eq: () => ({ eq: async () => (h.logsError ? { data: null, error: { message: "boom" } } : { data: h.logs, error: null }) }) }
        }
        h.jobSelects.push(cols)
        return { eq: () => ({ maybeSingle: async () => (h.jobError ? { data: null, error: { message: "timeout" } } : { data: { llm_billing: h.ledger }, error: null }) }) }
      },
      update: (row: Record<string, unknown>) => {
        h.jobWrites.push(row)
        return { eq: async () => ({ error: null }) }
      },
    }),
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 10 })) }))
vi.mock("../credits.js", () => ({ CreditsService: { commitCredits: h.commit } }))

import { ledgerBilled, settleBilledLedgerBeforeCancelImpl } from "../llm-cancel-settle.js"

const SCRAPE_LEDGER = { costUsd: 0.05, source: "kie-stated", calls: 3, lanes: ["kie", "kie", "kie"], chargeId: "meta-ads-analysis:claude-sonnet-5.5" }

beforeEach(() => {
  vi.clearAllMocks()
  h.logs = [{ id: "scrape-log", credits_used: 150 }]
  h.ledger = SCRAPE_LEDGER
  h.jobError = false
  h.jobSelects.length = 0
  h.logsError = false
  h.jobWrites.length = 0
  h.commit.mockResolvedValue({ charged: 28, shortfall: 0 })
})

describe("a cancelled scrape commits its billed analyses (D10)", () => {
  it("commits the spend recorded so far at the ledger's charge id — 0.05 USD → 25 base → 28 charged — never refunds it", async () => {
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("settled")
    // The metered commit: the fixed scrape part (not delivered) is returned by the commit itself.
    expect(h.commit).toHaveBeenCalledWith("scrape-log", 28, { collectOverHold: true })
    expect(h.jobWrites).toContainEqual({ credits_actual: 28 })
  })

  it("a ledger that cannot be priced (an uncomputable cost) commits the hold WHOLE", async () => {
    h.ledger = { costUsd: null, source: "uncomputable", calls: 2, lanes: ["kie", "kie"] }
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("settled")
    expect(h.commit).toHaveBeenCalledWith("scrape-log", 150, { collectOverHold: true })
  })

  it("no billed ledger (nothing analysed yet) → not-metered: the cancel refunds as before", async () => {
    h.ledger = null
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("not-metered")
    expect(h.commit).not.toHaveBeenCalled()
  })

  it("N1 for the scrapes: an analysis call in flight (the call-start marker) → kept (retry) — never committed or refunded under it", async () => {
    h.ledger = { ...SCRAPE_LEDGER, inFlight: 2 }
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("retry")
    // …even before anything billed: the call in flight may bill.
    h.ledger = { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId: SCRAPE_LEDGER.chargeId, inFlight: 1 }
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("retry")
    expect(h.commit).not.toHaveBeenCalled()
  })

  it("the sweep past the grace ignores a marker whose process died: what the ledger billed is charged; nothing billed → not-metered (refunded)", async () => {
    h.ledger = { ...SCRAPE_LEDGER, inFlight: 2 }
    expect(await settleBilledLedgerBeforeCancelImpl("job-1", { ignoreInFlight: true })).toBe("settled")
    expect(h.commit).toHaveBeenCalledWith("scrape-log", 28, { collectOverHold: true })
    h.ledger = { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId: SCRAPE_LEDGER.chargeId, inFlight: 1 }
    expect(await settleBilledLedgerBeforeCancelImpl("job-1", { ignoreInFlight: true })).toBe("not-metered")
  })

  it("no reserved hold → not-metered", async () => {
    h.logs = []
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("not-metered")
  })

  it("an unconfirmed commit, or an unreadable hold row, → retry: nothing refunded", async () => {
    h.commit.mockResolvedValue(undefined)
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("retry")
    h.logsError = true
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("retry")
  })

  it("reads the ledger from its server-only column (R32), never output_data; an unreadable ledger → retry", async () => {
    await settleBilledLedgerBeforeCancelImpl("job-1")
    expect(h.jobSelects).toEqual(["llm_billing"])
    h.jobError = true
    h.commit.mockClear()
    expect(await settleBilledLedgerBeforeCancelImpl("job-1")).toBe("retry")
    expect(h.commit).not.toHaveBeenCalled()
  })

  it("ledgerBilled: calls or a positive cost mark a ledger billed; an empty one is not", () => {
    expect(ledgerBilled(SCRAPE_LEDGER)).toBe(true)
    expect(ledgerBilled({ costUsd: 0, calls: 0, lanes: [] })).toBe(false)
    expect(ledgerBilled(undefined)).toBe(false)
  })
})
