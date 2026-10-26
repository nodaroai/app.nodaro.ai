// @test-watches supabase/migrations/365_*.sql
import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../supabase.js"
import {
  ADJUSTMENT_SOURCES,
  CREDIT_HISTORY_EXPORT_MAX,
  HISTORY_KINDS,
  SOURCES_OF_KIND,
  csvCell,
  cursorOf,
  escapeLike,
  exportCreditHistory,
  historyCsv,
  kindOfSource,
  listCreditHistory,
  parseCursor,
  type HistoryEntry,
} from "../credit-history.js"

/** A fluent chain that records every call and resolves to `result` when awaited. */
function chain(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const self: Record<string, unknown> = {}
  for (const name of ["select", "eq", "neq", "in", "not", "or", "order", "limit", "gte", "lte", "ilike"]) {
    self[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return self
    })
  }
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { self, calls }
}

const USER = "00000000-0000-4000-8000-000000000001"
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const LEDGER = [
  { id: ID(1), created_at: "2026-10-26T16:07:00.000Z", amount: -15, credit_type: "topup", source: "usage", description: "Job job-1: nano-banana", job_id: "job-1", stripe_transaction_id: null, balance_after: 2950 },
  { id: ID(2), created_at: "2026-10-25T22:02:00.000Z", amount: 3000, credit_type: "topup", source: "one_time_purchase", description: "Credit pack", job_id: null, stripe_transaction_id: "pi_1", balance_after: 3085 },
  { id: ID(3), created_at: "2026-10-15T11:51:00.000Z", amount: 100, credit_type: "subscription", source: "signup_grant", description: null, job_id: null, stripe_transaction_id: null, balance_after: 105 },
]
const LOG = { job_id: "job-1", created_at: "2026-10-26T16:07:00.000Z", action: "nano-banana", provider: "kie", status: "committed", credits_used: 15, credits_charged: 12 }
const JOB = { id: "job-1", job_type: "generate-image", status: "completed", started_at: "2026-10-26T16:07:00.000Z", completed_at: "2026-10-26T16:07:48.000Z", workflow_id: "wf-1", session_id: "ses-1" }

function tables(over: Partial<Record<string, { data: unknown; error: unknown } | Array<{ data: unknown; error: unknown }>>> = {}) {
  const made: Record<string, ReturnType<typeof chain>[]> = {}
  const results: Record<string, { data: unknown; error: unknown } | Array<{ data: unknown; error: unknown }>> = {
    credit_transactions: { data: LEDGER, error: null },
    usage_logs: { data: [LOG], error: null },
    jobs: { data: [JOB], error: null },
    transactions: { data: [{ stripe_transaction_id: "pi_1", receipt_url: "https://pay.stripe.com/r/1" }], error: null },
    ...over,
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const r = results[table] ?? { data: [], error: null }
    const nth = (made[table] ??= []).length
    const c = chain(Array.isArray(r) ? (r[nth] ?? r[r.length - 1]!) : r)
    made[table]!.push(c)
    return c.self
  }) as never)
  return made
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
})

describe("kinds", () => {
  it("maps every ledger source to its kind, and the rest to adjustment", () => {
    for (const [kind, sources] of Object.entries(SOURCES_OF_KIND)) for (const s of sources) expect(kindOfSource(s)).toBe(kind)
    for (const s of ADJUSTMENT_SOURCES) expect(kindOfSource(s)).toBe("adjustment")
    expect(kindOfSource("something_new")).toBe("adjustment")
    expect(kindOfSource(null)).toBe("adjustment")
  })

  it("names every personal source the column's CHECK allows (migration 365): a new source lands in a kind, never between the filters", () => {
    const dir = join(__dirname, "..", "..", "..", "..", "supabase", "migrations")
    const file = readdirSync(dir).find((f) => f.startsWith("365_"))
    if (!file) throw new Error("migration 365 not found")
    const sql = readFileSync(join(dir, file), "utf8")
    const check = sql.match(/CHECK \(source IN \(([\s\S]*?)\)\)/)
    if (!check) throw new Error("the source CHECK was not found in migration 365")
    const allowed = [...check[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).filter((s) => !s.startsWith("org_"))
    const named = new Set([...Object.values(SOURCES_OF_KIND).flat(), ...ADJUSTMENT_SOURCES])
    expect(allowed.filter((s) => !named.has(s))).toEqual([])
    expect(HISTORY_KINDS).toContain("adjustment")
  })
})

describe("the cursor", () => {
  it("is the row's time and id, and only one of ours parses", () => {
    const cursor = cursorOf({ at: "2026-10-26T16:07:00.000Z", id: ID(1) })
    expect(parseCursor(cursor)).toEqual({ at: "2026-10-26T16:07:00.000Z", id: ID(1) })
    for (const bad of ["2026-10-26T16:07:00.000Z", "yesterday|" + ID(1), "2026-10-26T16:07:00.000Z|not-a-uuid", `${cursor}|x`, ""]) expect(parseCursor(bad), bad).toBeNull()
  })
})

describe("listCreditHistory", () => {
  it("lists the ledger's personal rows newest first; the reserve row carries the charge, the model, the job and the receipt where they belong", async () => {
    const made = tables()
    const page = await listCreditHistory(USER, {}, { limit: 50 })
    if (!("items" in page)) throw new Error("unexpected")

    expect(page.nextCursor).toBeNull()
    expect(page.items.map((e) => e.id)).toEqual([ID(1), ID(2), ID(3)])
    expect(page.items[0]).toEqual({
      id: ID(1),
      at: "2026-10-26T16:07:00.000Z",
      kind: "usage",
      source: "usage",
      amount: -15,
      balanceAfter: 2950,
      pool: "topup",
      description: "Job job-1: nano-banana",
      model: "nano-banana",
      provider: "kie",
      charge: 12, // the run settled below its 15-credit hold: the charge, not the ledger's amount
      status: "committed",
      job: { id: "job-1", type: "generate-image", status: "completed", startedAt: "2026-10-26T16:07:00.000Z", completedAt: "2026-10-26T16:07:48.000Z", durationMs: 48_000, workflowId: "wf-1", sessionId: "ses-1" },
      receiptUrl: null,
    })
    expect(page.items[1]).toMatchObject({ kind: "purchase", amount: 3000, balanceAfter: 3085, charge: null, model: null, job: null, receiptUrl: "https://pay.stripe.com/r/1" })
    expect(page.items[2]).toMatchObject({ kind: "grant", pool: "subscription", status: null, job: null })

    // The spine: the person's own, non-org ledger rows, in a total order.
    const spine = made.credit_transactions![0]!.calls
    expect(spine).toContainEqual(["eq", ["user_id", USER]])
    expect(spine).toContainEqual(["neq", ["credit_type", "org"]])
    expect(spine).toContainEqual(["order", ["created_at", { ascending: false }]])
    expect(spine).toContainEqual(["order", ["id", { ascending: false }]])
    expect(spine).toContainEqual(["limit", [50]])
    // Every side table is the person's own too — the jobs included (a payer's ledger carries its requesters' jobs).
    for (const table of ["usage_logs", "jobs", "transactions"]) expect(made[table]![0]!.calls, table).toContainEqual(["eq", ["user_id", USER]])
    expect(made.usage_logs![0]!.calls).toContainEqual(["in", ["job_id", ["job-1"]]])
    expect(made.jobs![0]!.calls).toContainEqual(["in", ["id", ["job-1"]]])
    expect(made.transactions![0]!.calls).toContainEqual(["in", ["stripe_transaction_id", ["pi_1"]]])
    // Economics never leave: no cost column is selected anywhere.
    for (const list of Object.values(made)) for (const t of list) for (const [name, args] of t.calls) if (name === "select") expect(String(args[0])).not.toMatch(/cost|usd|margin/i)
  })

  it("puts a job's charge on its reserve row only: the refund and the metered overrun line of the same job carry none, so a sum counts the job once", async () => {
    const rows = [
      { ...LEDGER[0]!, id: ID(7), created_at: "2026-10-26T16:09:00.000Z", amount: 5, source: "refund", description: "Refund for job job-1" },
      { ...LEDGER[0]!, id: ID(6), created_at: "2026-10-26T16:08:00.000Z", amount: -4, source: "usage", description: "Job job-1: nano-banana — usage above the hold" },
      LEDGER[0]!,
    ]
    tables({ credit_transactions: { data: rows, error: null } })
    const page = await listCreditHistory(USER, {}, { limit: 50 })
    if (!("items" in page)) throw new Error("unexpected")
    expect(page.items.map((e) => [e.kind, e.charge, e.status, e.model])).toEqual([
      ["refund", null, null, "nano-banana"],
      ["usage", null, null, "nano-banana"],
      ["usage", 12, "committed", "nano-banana"],
    ])
    expect(page.items.reduce((sum, e) => sum + (e.charge ?? 0), 0)).toBe(12)
  })

  it("applies the filters as ledger predicates: the kind's sources (adjustment = the rest), the dates, the words, and the model exactly", async () => {
    const made = tables()
    await listCreditHistory(USER, { kind: "purchase", model: "gpt-image", from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.000Z", q: "50% off*" }, { limit: 20 })
    const calls = made.credit_transactions![0]!.calls
    expect(calls).toContainEqual(["in", ["source", ["one_time_purchase", "subscription_created", "subscription_renewal", "purchase", "subscription", "renewal", "topup"]]])
    expect(calls).toContainEqual(["gte", ["created_at", "2026-10-01T00:00:00.000Z"]])
    expect(calls).toContainEqual(["lte", ["created_at", "2026-10-31T23:59:59.000Z"]])
    expect(calls).toContainEqual(["ilike", ["description", "%50\\% off\\*%"]])
    expect(calls).toContainEqual(["or", ["description.ilike.Job %: gpt-image,description.ilike.Job %: gpt-image (%,description.ilike.Job %: gpt-image —%"]])
    expect(calls).toContainEqual(["limit", [20]])

    const rest = tables()
    await listCreditHistory(USER, { kind: "adjustment" }, { limit: 20 })
    const not = rest.credit_transactions![0]!.calls.find(([name]) => name === "not")
    expect(not?.[1][0]).toBe("source")
    expect(not?.[1][1]).toBe("in")
    for (const s of Object.values(SOURCES_OF_KIND).flat()) expect(String(not?.[1][2])).toContain(s)
    expect(String(not?.[1][2])).not.toContain("admin_adjustment")
  })

  it("pages after the cursor's time and id, gives the next cursor on a full page, and refuses a cursor that is not ours", async () => {
    const grant = LEDGER[2]!
    const made = tables({ credit_transactions: { data: [grant], error: null } })
    const page = await listCreditHistory(USER, {}, { limit: 1, cursor: cursorOf({ at: "2026-10-20T00:00:00.000Z", id: ID(9) }) })
    if (!("items" in page)) throw new Error("unexpected")
    expect(made.credit_transactions![0]!.calls).toContainEqual(["or", [`created_at.lt.2026-10-20T00:00:00.000Z,and(created_at.eq.2026-10-20T00:00:00.000Z,id.lt.${ID(9)})`]])
    expect(page.nextCursor).toBe(cursorOf({ at: grant.created_at, id: grant.id }))
    // A page with no jobs or purchases reads no side table.
    expect(made.usage_logs).toBeUndefined()
    expect(made.jobs).toBeUndefined()
    expect(made.transactions).toBeUndefined()

    expect(await listCreditHistory(USER, {}, { limit: 1, cursor: "2026-10-20T00:00:00.000Z" })).toEqual({ badCursor: true })
  })

  it("keeps the movements when an enrichment read fails, reports it, and leaves that field null", async () => {
    tables({ jobs: { data: null, error: { message: "boom" } } })
    const report = vi.fn()
    const page = await listCreditHistory(USER, {}, { limit: 50 }, report)
    if (!("items" in page)) throw new Error("unexpected")
    expect(page.items[0]).toMatchObject({ model: "nano-banana", charge: 12, job: { id: "job-1", type: null, durationMs: null } })
    expect(report).toHaveBeenCalledWith("jobs", "boom")
  })

  it("returns the ledger read's error", async () => {
    tables({ credit_transactions: { data: null, error: { message: "down" } } })
    expect(await listCreditHistory(USER, {}, { limit: 50 })).toEqual({ error: { message: "down" } })
  })
})

describe("the CSV", () => {
  it("escapes like PostgREST expects; numbers stay numbers, a formula-leading text is neutralised", () => {
    expect(escapeLike("100%_a\\b*")).toBe("100\\%\\_a\\\\b\\*")
    expect(csvCell('a "quoted", cell')).toBe('"a ""quoted"", cell"')
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(csvCell("-not a number")).toBe("'-not a number")
    expect(csvCell(null)).toBe("")
    expect(csvCell(-15)).toBe("-15")
  })

  it("writes a header and one line per entry, newest first", async () => {
    tables()
    const exported = await exportCreditHistory(USER, {})
    if ("error" in exported) throw new Error("unexpected error")
    const lines = exported.csv.split("\r\n")
    expect(lines[0]).toBe("at,kind,source,amount,charge,balanceAfter,pool,status,model,provider,jobId,jobType,durationMs,sessionId,workflowId,receiptUrl,description")
    expect(lines[1]).toBe("2026-10-26T16:07:00.000Z,usage,usage,-15,12,2950,topup,committed,nano-banana,kie,job-1,generate-image,48000,ses-1,wf-1,,Job job-1: nano-banana")
    expect(lines[2]).toContain(",purchase,one_time_purchase,3000,,3085,topup,,,,,,,,,https://pay.stripe.com/r/1,Credit pack")
    expect(lines).toHaveLength(5) // header, three rows, the trailing line break
  })

  it("exports a step at a time (each under PostgREST's row cap), follows the cursor, and marks the file cut only when a row beyond the maximum exists", async () => {
    const step = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ ...LEDGER[2]!, id: ID(from + i), created_at: `2026-09-${String(30 - Math.floor((from + i) / 1000)).padStart(2, "0")}T00:00:00.000Z` }))
    const pages = [...Array.from({ length: 25 }, (_, i) => ({ data: step(200, i * 200), error: null })), { data: [LEDGER[2]!], error: null }]
    const made = tables({ credit_transactions: pages })
    const exported = await exportCreditHistory(USER, {})
    if ("error" in exported) throw new Error("unexpected error")
    const lines = exported.csv.split("\r\n")
    expect(lines).toHaveLength(CREDIT_HISTORY_EXPORT_MAX + 3) // header, the rows, the cut line, the trailing break
    expect(lines[lines.length - 2]).toContain(`cut at ${CREDIT_HISTORY_EXPORT_MAX} rows`)
    const reads = made.credit_transactions!
    expect(reads).toHaveLength(26) // 25 steps of 200, then the one-row look beyond
    expect(reads[0]!.calls).toContainEqual(["limit", [200]])
    expect(reads[1]!.calls.find(([name]) => name === "or")).toBeDefined()
    expect(reads[25]!.calls).toContainEqual(["limit", [1]])

    // Exactly the maximum, nothing beyond: whole, not cut.
    const exact = tables({ credit_transactions: [...Array.from({ length: 25 }, (_, i) => ({ data: step(200, i * 200), error: null })), { data: [], error: null }] })
    const whole = await exportCreditHistory(USER, {})
    if ("error" in whole) throw new Error("unexpected error")
    expect(whole.csv).not.toContain("cut at")
    expect(exact.credit_transactions).toHaveLength(26)
  })

  it("marks a cut file", () => {
    const entry: HistoryEntry = { id: "x", at: "2026-01-01T00:00:00.000Z", kind: "grant", source: "signup_grant", amount: 1, balanceAfter: 1, pool: "subscription", description: null, model: null, provider: null, charge: null, status: null, job: null, receiptUrl: null }
    expect(historyCsv([entry], true).split("\r\n")[2]).toContain(`cut at ${CREDIT_HISTORY_EXPORT_MAX} rows`)
    expect(historyCsv([entry], false).split("\r\n")).toHaveLength(3)
  })
})
