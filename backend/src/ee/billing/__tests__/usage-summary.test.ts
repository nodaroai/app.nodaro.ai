import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerActive: vi.fn(() => false), deploymentPayerId: vi.fn(() => null) }))

import { supabase } from "../../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../../lib/deployment-payer.js"
import { USAGE_SUMMARY_ROW_CAP, bucketOf, bucketsBetween, usageSummaryFor } from "../usage-summary.js"

type Result = { data: unknown; error: { message: string } | null }

/**
 * A fluent chain that records every call. Awaiting it, or `.range()`,
 * resolves to the result; `.range(from, to)` answers the slice of `data`
 * (at most PostgREST's 1000), so paging is exercised for real.
 */
function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const self: Record<string, unknown> = {}
  for (const name of ["select", "eq", "neq", "in", "is", "order", "limit", "gte", "lte"]) {
    self[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return self
    })
  }
  self.range = vi.fn((from: number, to: number) => {
    calls.push(["range", [from, to]])
    const data = Array.isArray(result.data) ? result.data.slice(from, Math.min(to + 1, from + 1000)) : result.data
    return Promise.resolve({ data, error: result.error })
  })
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { self, calls }
}

const USER = "00000000-0000-4000-8000-000000000001"
const PAYER = "00000000-0000-4000-8000-0000000009e1"
const PERIOD = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-27T00:00:00.000Z", bucket: "day" as const }

const RUNS = [
  { job_id: "j1", created_at: "2026-10-26T16:07:00.000Z", action: "nano-banana", provider: "kie", status: "committed", credits_used: 15, credits_charged: 12, reservation_mode: null },
  { job_id: "j2", created_at: "2026-10-25T22:33:00.000Z", action: "nano-banana", provider: "kie", status: "reserved", credits_used: 15, credits_charged: null, reservation_mode: null },
  { job_id: "j3", created_at: "2026-10-13T13:42:00.000Z", action: "kling-3:video", provider: "kie", status: "committed", credits_used: 80, credits_charged: 80, reservation_mode: null },
  { job_id: null, created_at: "2026-10-13T13:40:00.000Z", action: "elevenlabs-tts", provider: "elevenlabs", status: "committed", credits_used: 3, credits_charged: 3, reservation_mode: null },
  // An LLM side hold beside j3: its credits count, it is not a run of its own.
  { job_id: "j3", created_at: "2026-10-13T13:41:00.000Z", action: "llm:gpt", provider: "openai", status: "committed", credits_used: 2, credits_charged: 2, reservation_mode: "side" },
]
const LEDGER = [
  { created_at: "2026-10-25T22:02:00.000Z", amount: 3000, source: "one_time_purchase", description: "Credit pack" },
  { created_at: "2026-10-26T16:08:00.000Z", amount: 3, source: "refund", description: "Unused job reservation" }, // j1 settled below its hold: not a refund
  { created_at: "2026-10-15T11:51:00.000Z", amount: 100, source: "signup_grant", description: null },
  { created_at: "2026-10-14T11:51:00.000Z", amount: 7, source: "refund", description: "Refund for job j9" },
  { created_at: "2026-10-14T11:52:00.000Z", amount: -50, source: "admin_adjustment", description: "Free credits removed" },
]
const JOBS = [
  { id: "j1", job_type: "generate-image", session_id: "s1", workflow_id: null },
  { id: "j2", job_type: "generate-image", session_id: "s1", workflow_id: null },
  { id: "j3", job_type: "image-to-video", session_id: null, workflow_id: "w1" },
]

function tables(over: Partial<Record<string, Result>> = {}) {
  const made: Record<string, ReturnType<typeof chain>[]> = {}
  const results: Record<string, Result> = {
    usage_logs: { data: RUNS, error: null },
    credit_transactions: { data: LEDGER, error: null },
    jobs: { data: JOBS, error: null },
    generation_sessions: { data: [{ id: "s1", title: "Rapper portraits", tool: "image" }], error: null },
    workflows: { data: [{ id: "w1", name: "Launch video" }], error: null },
    ...over,
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = chain(results[table] ?? { data: [], error: null })
    ;(made[table] ??= []).push(c)
    return c.self
  }) as never)
  return made
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
  vi.mocked(deploymentPayerActive).mockReturnValue(false)
  vi.mocked(deploymentPayerId).mockReturnValue(null)
})

describe("buckets", () => {
  it("names a day, the Monday of a week, and a month, in UTC — across a month and a year", () => {
    expect(bucketOf("2026-10-26T23:59:00.000Z", "day")).toBe("2026-10-26")
    expect(bucketOf("2026-10-29T10:00:00.000Z", "week")).toBe("2026-10-26") // Thursday → its Monday
    expect(bucketOf("2026-10-26T10:00:00.000Z", "week")).toBe("2026-10-26") // Monday stays
    expect(bucketOf("2027-01-01T10:00:00.000Z", "week")).toBe("2026-12-28") // a Friday → the Monday of the old year
    expect(bucketOf("2026-10-29T10:00:00.000Z", "month")).toBe("2026-10")
  })

  it("lists every bucket of a period with no holes, oldest first; one bucket when from equals to; the 31st does not skip a month", () => {
    expect(bucketsBetween("2026-10-30T12:00:00.000Z", "2026-11-02T00:00:00.000Z", "day")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
    expect(bucketsBetween("2026-10-29T00:00:00.000Z", "2026-11-10T00:00:00.000Z", "week")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"])
    expect(bucketsBetween("2026-09-15T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "month")).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(bucketsBetween("2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z", "day")).toEqual(["2026-10-05"])
    expect(bucketsBetween("2026-01-31T00:00:00.000Z", "2026-04-01T00:00:00.000Z", "month")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
    expect(bucketsBetween("2026-12-29T00:00:00.000Z", "2027-01-05T00:00:00.000Z", "week")).toEqual(["2026-12-28", "2027-01-04"])
  })
})

describe("usageSummaryFor", () => {
  it("sums the period: charges through the reader, purchases, net grants and real refunds from the ledger, by model, category, bucket, session and workflow", async () => {
    const made = tables()
    const s = await usageSummaryFor(USER, PERIOD)
    if ("error" in s) throw new Error("unexpected error")

    // used: 12 (settled below its 15 hold) + 15 (still held) + 80 + 3 + 2 (the side hold's credits); runs: 4, the side hold is not one.
    // granted: 100 - 50; refunded: 7 (the released 3 of j1 is not a refund).
    expect(s.totals).toEqual({ used: 112, purchased: 3000, granted: 50, refunded: 7, runs: 4, avgPerRun: 28 })
    expect(s.mostUsed).toEqual({ model: "kling-3:video", provider: "kie", credits: 80, runs: 1, share: 0.714 })
    expect(s.byModel.map((m) => [m.model, m.credits, m.runs])).toEqual([["kling-3:video", 80, 1], ["nano-banana", 27, 2], ["elevenlabs-tts", 3, 1], ["llm:gpt", 2, 0]])
    // The job's node type names the category (nano-banana's id says nothing); the TTS run has no job and is classed by its model id.
    expect(s.byCategory.map((c) => [c.category, c.credits, c.runs])).toEqual([["video", 82, 1], ["image", 27, 2], ["audio", 3, 1]])
    expect(s.bySession).toEqual([{ id: "s1", name: "Rapper portraits", tool: "image", credits: 27, runs: 2, models: ["nano-banana"], lastAt: "2026-10-26T16:07:00.000Z" }])
    expect(s.byWorkflow).toEqual([{ id: "w1", name: "Launch video", tool: null, credits: 82, runs: 1, models: ["kling-3:video", "llm:gpt"], lastAt: "2026-10-13T13:42:00.000Z" }])
    // Every day of the period, oldest first; the purchase lands in its day.
    expect(s.overTime).toHaveLength(27)
    expect(s.overTime[0]).toEqual({ bucket: "2026-10-01", used: 0, purchased: 0, runs: 0 })
    expect(s.overTime.find((b) => b.bucket === "2026-10-25")).toEqual({ bucket: "2026-10-25", used: 15, purchased: 3000, runs: 1 })
    expect(s.overTime.find((b) => b.bucket === "2026-10-13")).toEqual({ bucket: "2026-10-13", used: 85, purchased: 0, runs: 2 })
    expect(s.truncated).toBe(false)
    expect(s.partial).toBe(false)

    // The person's own personal rows, in the period, refunded runs left out; no cost column anywhere.
    const usage = made.usage_logs![0]!.calls
    expect(usage).toContainEqual(["eq", ["user_id", USER]])
    expect(usage).toContainEqual(["is", ["workspace_id", null]])
    expect(usage).toContainEqual(["in", ["status", ["reserved", "committed"]]])
    expect(usage).toContainEqual(["gte", ["created_at", PERIOD.from]])
    expect(usage).toContainEqual(["lte", ["created_at", PERIOD.to]])
    expect(usage).toContainEqual(["order", ["id", { ascending: false }]])
    expect(usage).toContainEqual(["range", [0, 999]])
    expect(made.credit_transactions![0]!.calls).toContainEqual(["neq", ["credit_type", "org"]])
    expect(made.jobs![0]!.calls).toContainEqual(["eq", ["user_id", USER]])
    expect(made.generation_sessions![0]!.calls).toContainEqual(["eq", ["user_id", USER]])
    expect(made.workflows![0]!.calls).toContainEqual(["eq", ["user_id", USER]])
    for (const list of Object.values(made)) for (const t of list) for (const [name, args] of t.calls) if (name === "select") expect(String(args[0])).not.toMatch(/cost|usd|margin/i)
  })

  it("is empty but whole for a period with nothing in it", async () => {
    tables({ usage_logs: { data: [], error: null }, credit_transactions: { data: [], error: null } })
    const s = await usageSummaryFor(USER, { ...PERIOD, bucket: "month" })
    if ("error" in s) throw new Error("unexpected error")
    expect(s.totals).toEqual({ used: 0, purchased: 0, granted: 0, refunded: 0, runs: 0, avgPerRun: 0 })
    expect(s.mostUsed).toBeNull()
    expect(s.overTime).toEqual([{ bucket: "2026-10", used: 0, purchased: 0, runs: 0 }])
    expect(s.bySession).toEqual([])
  })

  it("reads past PostgREST's 1000-row answer a page at a time, and says truncated only at the cap", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...RUNS[3]!, created_at: `2026-10-${pad(2 + (i % 20))}T00:00:00.000Z` }))
    const made = tables({ usage_logs: { data: many(2500), error: null }, credit_transactions: { data: [], error: null } })
    const s = await usageSummaryFor(USER, PERIOD)
    if ("error" in s) throw new Error("unexpected error")
    expect(s.totals.runs).toBe(2500)
    expect(s.totals.used).toBe(7500)
    expect(s.truncated).toBe(false)
    expect(made.usage_logs!.map((c) => c.calls.find(([name]) => name === "range")?.[1])).toEqual([[0, 999], [1000, 1999], [2000, 2999]])

    tables({ usage_logs: { data: many(USAGE_SUMMARY_ROW_CAP + 10), error: null }, credit_transactions: { data: [], error: null } })
    const cut = await usageSummaryFor(USER, PERIOD)
    if ("error" in cut) throw new Error("unexpected error")
    expect(cut.totals.runs).toBe(USAGE_SUMMARY_ROW_CAP)
    expect(cut.truncated).toBe(true)
  })

  it("says partial, not truncated, when the jobs read failed, and when a name read failed", async () => {
    const report = vi.fn()
    tables({ jobs: { data: null, error: { message: "boom" } } })
    const s = await usageSummaryFor(USER, PERIOD, report)
    if ("error" in s) throw new Error("unexpected error")
    expect(s.truncated).toBe(false)
    expect(s.partial).toBe(true)
    expect(s.totals.used).toBe(112)
    expect(s.bySession).toEqual([])
    expect(report).toHaveBeenCalledWith("jobs", "boom")

    tables({ workflows: { data: null, error: { message: "down" } } })
    const named = await usageSummaryFor(USER, PERIOD)
    if ("error" in named) throw new Error("unexpected error")
    expect(named.partial).toBe(true)
    expect(named.byWorkflow[0]).toMatchObject({ id: "w1", name: null })
  })

  it("under a deployment payer, a person's runs are read through on_behalf_of, and the payer's own through user_id; the jobs stay the caller's own", async () => {
    vi.mocked(deploymentPayerActive).mockReturnValue(true)
    vi.mocked(deploymentPayerId).mockReturnValue(PAYER)
    const person = tables()
    await usageSummaryFor(USER, PERIOD)
    expect(person.usage_logs![0]!.calls).toContainEqual(["eq", ["on_behalf_of", USER]])
    expect(person.jobs![0]!.calls).toContainEqual(["eq", ["user_id", USER]])

    const payer = tables()
    await usageSummaryFor(PAYER, PERIOD)
    expect(payer.usage_logs![0]!.calls).toContainEqual(["eq", ["user_id", PAYER]])
    expect(payer.jobs![0]!.calls).toContainEqual(["eq", ["user_id", PAYER]])
  })

  it("names a session or workflow null when it is gone, and returns the usage read's error", async () => {
    tables({ generation_sessions: { data: [], error: null } })
    const s = await usageSummaryFor(USER, PERIOD)
    if ("error" in s) throw new Error("unexpected error")
    expect(s.bySession[0]).toMatchObject({ id: "s1", name: null, tool: null })
    expect(s.partial).toBe(false)

    tables({ usage_logs: { data: null, error: { message: "down" } } })
    expect(await usageSummaryFor(USER, PERIOD)).toEqual({ error: { message: "down" } })
  })
})

const pad = (n: number) => String(n).padStart(2, "0")
