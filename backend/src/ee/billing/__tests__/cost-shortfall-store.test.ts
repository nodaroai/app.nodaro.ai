// @test-watches backend/src/ee/billing/cleanup-cron.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** A PostgREST builder that records its calls and answers `result` when awaited. */
type Call = [string, ...unknown[]]
const calls: Array<{ table: string; chain: Call[] }> = []
let result: { data: unknown; error: unknown } = { data: [], error: null }

function builder(table: string) {
  const entry = { table, chain: [] as Call[] }
  calls.push(entry)
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
        return (...args: unknown[]) => {
          entry.chain.push([prop, ...args])
          return proxy
        }
      },
    },
  )
  return proxy
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (table: string) => builder(table) } }))
const invalidateModelPricingCache = vi.fn()
vi.mock("../credits.js", () => ({ invalidateModelPricingCache: () => invalidateModelPricingCache() }))
const noteModelSwitch = vi.fn()
vi.mock("../../../lib/model-switch.js", () => ({ noteModelSwitch: (...a: unknown[]) => noteModelSwitch(...a) }))

const { supabaseCostShortfallStore: store, switchIdOf } = await import("../cost-shortfall-store.js")

beforeEach(() => {
  calls.length = 0
  result = { data: [], error: null }
  invalidateModelPricingCache.mockClear()
  noteModelSwitch.mockClear()
})

describe("the Supabase cost-shortfall store", () => {
  it("switches a model off only while it is on or unset (compare-and-set), and refreshes this process's caches", async () => {
    result = { data: [{ model_identifier: "model-a" }], error: null }
    expect(await store.switchOff("model-a")).toBe(true)
    const { table, chain } = calls[0]!
    expect(table).toBe("model_pricing")
    expect(chain).toContainEqual(["update", expect.objectContaining({ is_enabled: false })])
    expect(chain).toContainEqual(["eq", "model_identifier", "model-a"])
    expect(chain).toContainEqual(["not", "is_enabled", "is", false])
    expect(invalidateModelPricingCache).toHaveBeenCalledTimes(1)
    expect(noteModelSwitch).toHaveBeenCalledWith("model-a", false)
  })

  it("reports a lost compare-and-set (already off) as not switched, touching no cache", async () => {
    result = { data: [], error: null }
    expect(await store.switchOff("model-a")).toBe(false)
    expect(noteModelSwitch).not.toHaveBeenCalled()
  })

  it("maps a duplicate insert (23505) to 'duplicate' and any other error to 'failed'", async () => {
    const row = {
      job_id: "j1", user_id: "u1", usage_log_id: "l1", model_identifier: "m", model_switch_id: "m", provider: null,
      credits_estimated: 80, credits_actual: 8, diff: 72, provider_cost_usd: 0.159, job_completed_at: "2026-11-18T10:00:00Z",
    }
    result = { data: null, error: { code: "23505", message: "duplicate" } }
    expect(await store.insertAnomaly(row)).toBe("duplicate")
    result = { data: null, error: { code: "23514", message: "check constraint" } }
    expect(await store.insertAnomaly(row)).toBe("failed")
    result = { data: null, error: null }
    expect(await store.insertAnomaly(row)).toBe("inserted")
    expect(calls[2]!.chain[0]).toEqual(["insert", expect.objectContaining({ anomaly_type: "cost_shortfall", status: "pending" })])
  })

  it("answers null for a failed read, never a guess", async () => {
    result = { data: null, error: { message: "down" } }
    expect(await store.recordedJobIds(["j1"])).toBeNull()
    expect(await store.usageLogs(["l1"])).toBeNull()
    expect(await store.sharedUsageLogIds(["l1"])).toBeNull()
    expect(await store.readSwitch("m")).toEqual({ kind: "unreadable" })
  })

  it("reads a missing pricing row as missing", async () => {
    result = { data: null, error: null }
    expect(await store.readSwitch("m")).toEqual({ kind: "missing" })
  })

  it("groups a plain model id under its own pricing row", () => {
    expect(switchIdOf("some-model")).toBe("some-model")
  })
})

describe("wiring", () => {
  it("the billing cron runs the sweep", () => {
    const cron = readFileSync(join(__dirname, "..", "cleanup-cron.ts"), "utf8")
    expect(cron).toMatch(/cron\.schedule\(`\*\/\$\{COST_SHORTFALL_SWEEP\.everyMinutes\} \* \* \* \*`[\s\S]{0,200}runCostShortfallSweep\(\)/)
  })
})
