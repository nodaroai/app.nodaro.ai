// @test-reads-none mocks the supabase client; reads no repo file
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  read: { data: null as unknown, error: null as { code?: string; message: string } | null },
  batch: { data: null as unknown, error: null as { code?: string; message: string } | null },
  ins: [] as unknown[][],
  writeError: null as { code?: string; message: string } | null,
  updates: [] as Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  selects: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      let current: { values: Record<string, unknown>; filters: Array<[string, unknown]> } | null = null
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn((cols: string) => (h.selects.push(cols), chain))
      chain.update = vi.fn((values: Record<string, unknown>) => {
        current = { values, filters: [] }
        h.updates.push(current)
        return chain
      })
      chain.eq = vi.fn((col: string, val: unknown) => (current?.filters.push([col, val]), chain))
      chain.in = vi.fn((_col: string, ids: unknown[]) => (h.ins.push(ids), Promise.resolve(h.batch)))
      chain.maybeSingle = vi.fn(async () => h.read)
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: h.writeError }).then(resolve)
      return chain
    }),
  },
}))

const {
  isLlmBillingLedger,
  llmBillingLedgerBilled,
  readLlmBillingLedger,
  readLlmBillingLedgerAndCost,
  readLlmBillingLedgers,
  writeLlmBillingLedger,
  LLM_BILLING_LEDGER_COLUMN,
} = await import("../llm-billing-ledger.js")

const LEDGER = { costUsd: 0.048, source: "kie-stated" as const, calls: 1, lanes: ["kie" as const], chargeId: "llm-chat:gpt-5.5" }

beforeEach(() => {
  h.read = { data: null, error: null }
  h.batch = { data: null, error: null }
  h.ins.length = 0
  h.writeError = null
  h.updates.length = 0
  h.selects.length = 0
})

describe("the billing ledger helper (jobs.llm_billing)", () => {
  it("writes the ledger to the column by job id — nothing else", async () => {
    expect(await writeLlmBillingLedger("job-1", LEDGER)).toBe(true)
    expect(h.updates).toEqual([{ values: { llm_billing: LEDGER }, filters: [["id", "job-1"]] }])
    expect(LLM_BILLING_LEDGER_COLUMN).toBe("llm_billing")
  })

  it("a write can carry provider_cost in the SAME update (a worker's running spend)", async () => {
    expect(await writeLlmBillingLedger("job-1", LEDGER, { providerCost: 0.048 })).toBe(true)
    expect(h.updates).toEqual([{ values: { llm_billing: LEDGER, provider_cost: 0.048 }, filters: [["id", "job-1"]] }])
  })

  it("every ledger written names its charge id (a type error otherwise)", async () => {
    const { chargeId: _dropped, ...noChargeId } = LEDGER
    // @ts-expect-error — a ledger without its chargeId cannot be written
    await writeLlmBillingLedger("job-1", noChargeId)
  })

  it("reads the ledger with provider_cost in one select", async () => {
    h.read = { data: { provider_cost: 0.05, llm_billing: LEDGER }, error: null }
    expect(await readLlmBillingLedgerAndCost("job-1")).toEqual({ ok: true, ledger: LEDGER, providerCost: 0.05 })
    expect(h.selects).toEqual(["provider_cost, llm_billing"])
    h.read = { data: { provider_cost: null, llm_billing: null }, error: null }
    expect(await readLlmBillingLedgerAndCost("job-1")).toEqual({ ok: true, ledger: null })
    h.read = { data: null, error: { message: "timeout" } }
    expect(await readLlmBillingLedgerAndCost("job-1")).toEqual({ ok: false, error: "timeout" })
  })

  it("reads a batch's ledgers: only jobs that have one; a failed read is { ok: false }", async () => {
    h.batch = { data: [{ id: "a", llm_billing: LEDGER }, { id: "b", llm_billing: null }], error: null }
    const read = await readLlmBillingLedgers(["a", "b"])
    expect(read.ok && [...read.ledgers]).toEqual([["a", LEDGER]])
    expect(h.selects).toEqual(["id, llm_billing"])
    expect(h.ins).toEqual([["a", "b"]])
    h.batch = { data: null, error: { message: "timeout" } }
    expect(await readLlmBillingLedgers(["a"])).toEqual({ ok: false, error: "timeout" })
    // An empty batch reads nothing.
    h.ins.length = 0
    expect((await readLlmBillingLedgers([])).ok).toBe(true)
    expect(h.ins).toEqual([])
  })

  it("a failed write answers false and never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.writeError = { code: "PGRST204", message: "Could not find the 'llm_billing' column" }
    expect(await writeLlmBillingLedger("job-1", LEDGER)).toBe(false)
  })

  it("reads the column by job id: the ledger, or null when there is none", async () => {
    h.read = { data: { llm_billing: LEDGER }, error: null }
    expect(await readLlmBillingLedger("job-1")).toEqual({ ok: true, ledger: LEDGER })
    expect(h.selects).toEqual(["llm_billing"])
    h.read = { data: { llm_billing: null }, error: null }
    expect(await readLlmBillingLedger("job-1")).toEqual({ ok: true, ledger: null })
    // R33: no migration-window shortcut — a missing column is an error like any other.
    h.read = { data: null, error: { code: "42703", message: "column jobs.llm_billing does not exist" } }
    expect(await readLlmBillingLedger("job-1")).toEqual({ ok: false, error: "column jobs.llm_billing does not exist" })
  })

  it("a failed read is { ok: false } — unknown, never 'no ledger'", async () => {
    h.read = { data: null, error: { message: "timeout" } }
    expect(await readLlmBillingLedger("job-1")).toEqual({ ok: false, error: "timeout" })
  })

  it("isLlmBillingLedger / llmBillingLedgerBilled", () => {
    expect(isLlmBillingLedger(LEDGER)).toBe(true)
    expect(isLlmBillingLedger({ calls: "1" })).toBe(false)
    expect(isLlmBillingLedger(null)).toBe(false)
    expect(isLlmBillingLedger([])).toBe(false)
    expect(llmBillingLedgerBilled(LEDGER)).toBe(true)
    expect(llmBillingLedgerBilled({ ...LEDGER, calls: 0 })).toBe(false)
    expect(llmBillingLedgerBilled(undefined)).toBe(false)
  })
})
