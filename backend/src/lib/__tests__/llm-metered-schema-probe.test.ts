// @test-reads-none hands the probe a fake client; reads no repo file
/** The R33 probe answers yes only when 551's function, 552's column and 554's side-hold reserve all answer as present. */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { code?: string; message: string } | null },
  side: { data: null as unknown, error: null as { code?: string; message: string } | null },
  column: { data: [] as unknown, error: null as { code?: string; message: string } | null },
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  selects: [] as Array<{ table: string; cols: string; limit?: number }>,
}))

// The probe is handed its client (the gate gets it from lib/supabase.ts).
const client = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => (h.rpcCalls.push([fn, args]), fn === "reserve_llm_side_hold" ? h.side : h.rpc)),
  from: vi.fn((table: string) => ({
    select: (cols: string) => ({
      limit: async (n: number) => (h.selects.push({ table, cols, limit: n }), h.column),
    }),
  })),
} as never

const { probeLlmMeteredSchema: probe } = await import("../llm-metered-schema-probe.js")
const probeLlmMeteredSchema = () => probe(client)

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  h.rpc = { data: null, error: { message: "METERED_ACTUAL_REQUIRED: a metered settle needs a non-negative actual, got -1" } }
  h.side = { data: null, error: { message: "SIDE_HOLD_INVALID: positive credits, a job and a charge id are required" } }
  h.column = { data: [], error: null }
  h.rpcCalls.length = 0
  h.selects.length = 0
})

describe("probeLlmMeteredSchema", () => {
  it("both present → ready; the probe is side-effect free (negative actual, zero rows)", async () => {
    expect(await probeLlmMeteredSchema()).toBe(true)
    expect(h.rpcCalls).toEqual([
      ["commit_credits_metered", { p_usage_log_id: "00000000-0000-0000-0000-000000000000", p_actual_credits: -1 }],
      // 554: refused FIRST (SIDE_HOLD_INVALID, before any row is read or locked) — nothing reserved.
      ["reserve_llm_side_hold", { p_user_id: "00000000-0000-0000-0000-000000000000", p_credits: -1, p_job_id: "00000000-0000-0000-0000-000000000000", p_charge_id: "" }],
    ])
    expect(h.selects).toEqual([{ table: "jobs", cols: "llm_billing", limit: 0 }])
  })

  it("551 missing → not ready", async () => {
    h.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function public.commit_credits_metered" } }
    expect(await probeLlmMeteredSchema()).toBe(false)
  })

  it("552 missing → not ready", async () => {
    h.column = { data: null, error: { code: "42703", message: "column jobs.llm_billing does not exist" } }
    expect(await probeLlmMeteredSchema()).toBe(false)
  })

  it("554 missing → not ready (side holds ship with metered pricing)", async () => {
    h.side = { data: null, error: { code: "PGRST202", message: "Could not find the function public.reserve_llm_side_hold" } }
    expect(await probeLlmMeteredSchema()).toBe(false)
  })

  it("a side-hold reserve that did NOT refuse is not a yes", async () => {
    h.side = { data: { usageLogId: "x" }, error: null }
    expect(await probeLlmMeteredSchema()).toBe(false)
  })

  it("any other answer is not a yes (an RPC that succeeded, a network error)", async () => {
    h.rpc = { data: { charged: 0 }, error: null }
    expect(await probeLlmMeteredSchema()).toBe(false)
    h.rpc = { data: null, error: { message: "fetch failed" } }
    expect(await probeLlmMeteredSchema()).toBe(false)
  })
})
