// Podcast Track 0.11 — the clocks that wait on an execution from OUTSIDE its
// orchestrator (the stale sweeps, the component route, a parent's component
// node) must see the same budget excess the orchestrator grew its own cap by.
// They rebuild it from rows through the SAME per-job budget function
// (`declaredJobBudgetMs` over `jobs.job_type` + `input_data`), and read it only
// once their base limit is spent — so an unbudgeted run costs no extra query
// and times out exactly as before.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"

const db = vi.hoisted(() => ({
  /** jobs rows by execution id (the budget scan). */
  childJobs: new Map<string, Array<Record<string, unknown>>>(),
  /** node_states by execution id. */
  nodeStates: new Map<string, Record<string, unknown>>(),
  /** jobs rows by id (the component-wrapper lookup). */
  jobsById: new Map<string, Record<string, unknown>>(),
  queries: [] as string[],
  failJobs: false,
}))

vi.mock("../supabase.js", () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {}
    let columns = ""
    const b: Record<string, unknown> = {}
    b.select = (c: string) => { columns = c; return b }
    b.eq = (col: string, v: unknown) => { filters[`eq:${col}`] = v; return b }
    b.in = (col: string, v: unknown) => { filters[`in:${col}`] = v; return b }
    const resolve = () => {
      db.queries.push(`${table}:${columns}`)
      if (table === "workflow_executions") {
        const id = filters["eq:id"] as string
        return { data: db.nodeStates.has(id) ? { node_states: db.nodeStates.get(id) } : null, error: null }
      }
      if (db.failJobs) throw new Error("db down")
      if (filters["eq:workflow_execution_id"] !== undefined) {
        const names = filters["in:job_type"] as string[]
        const rows = (db.childJobs.get(filters["eq:workflow_execution_id"] as string) ?? [])
          .filter((r) => names.includes(r.job_type as string))
        return { data: rows, error: null }
      }
      const ids = filters["in:id"] as string[]
      const rows = ids.map((id) => db.jobsById.get(id)).filter((r): r is Record<string, unknown> => !!r)
        .filter((r) => r.provider === filters["eq:provider"])
      return { data: rows, error: null }
    }
    b.maybeSingle = async () => resolve()
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      try { return Promise.resolve(resolve()).then(res, rej) } catch (e) { return Promise.reject(e).then(res, rej) }
    }
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})

import { BudgetedDeadline, executionBudgetExcessMs } from "../execution-budget.js"
import { budgetExcessMs, declaredJobBudgetMs } from "../job-budget.js"

const MIN = 60_000

function edlOf(minutes: number): Edl {
  const segments: EdlSegment[] = Array.from({ length: minutes }, (_, i) => ({
    id: `s${i}`, inMs: i * MIN, outMs: (i + 1) * MIN, video: "A",
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}
const applyEdlRow = (minutes: number, output: "video" | "audio" = "video") => ({
  job_type: "apply-edl",
  input_data: { edl: edlOf(minutes), output, quality: "final", type: "apply-edl", node_id: "n" },
})
const excessOf = (row: ReturnType<typeof applyEdlRow>) => budgetExcessMs(declaredJobBudgetMs("apply-edl", row.input_data))

beforeEach(() => {
  db.childJobs.clear(); db.nodeStates.clear(); db.jobsById.clear(); db.queries.length = 0; db.failJobs = false
})

describe("executionBudgetExcessMs", () => {
  it("sums the excess of the execution's budgeted child jobs — through the same per-job budget", async () => {
    const long = applyEdlRow(180)
    const alsoLong = applyEdlRow(150, "audio")
    const short = applyEdlRow(2)
    db.childJobs.set("exec-1", [long, alsoLong, short, { job_type: "generate-image", input_data: {} }])
    db.nodeStates.set("exec-1", {})
    const total = await executionBudgetExcessMs("exec-1")
    expect(excessOf(long)).toBeGreaterThan(0)
    expect(excessOf(alsoLong)).toBeGreaterThan(0)
    expect(excessOf(short)).toBe(0)
    expect(total).toBe(excessOf(long) + excessOf(alsoLong))
  })

  it("is 0 for an execution that dispatched nothing budgeted", async () => {
    db.childJobs.set("exec-1", [{ job_type: "generate-image", input_data: {} }])
    db.nodeStates.set("exec-1", { a: { status: "running", jobId: "j-a" } })
    db.jobsById.set("j-a", { provider: "kie", input_data: {} })
    expect(await executionBudgetExcessMs("exec-1")).toBe(0)
  })

  it("adds a component node's INNER execution, recursively (the wrapper's _executionId)", async () => {
    const inner = applyEdlRow(200)
    const deep = applyEdlRow(160)
    db.childJobs.set("outer", [])
    db.nodeStates.set("outer", { comp: { status: "running", jobId: "wrap-1" } })
    db.jobsById.set("wrap-1", { provider: "component", input_data: { _executionId: "inner" } })
    db.childJobs.set("inner", [inner])
    db.nodeStates.set("inner", { comp2: { status: "running", jobIds: ["wrap-2"] } })
    db.jobsById.set("wrap-2", { provider: "component", input_data: { _executionId: "deep" } })
    db.childJobs.set("deep", [deep])
    db.nodeStates.set("deep", {})
    expect(await executionBudgetExcessMs("outer")).toBe(excessOf(inner) + excessOf(deep))
  })

  it("uses the caller's node_states when given (no row read) and survives a cycle", async () => {
    db.childJobs.set("a", [applyEdlRow(180)])
    db.jobsById.set("w", { provider: "component", input_data: { _executionId: "a" } })
    const got = await executionBudgetExcessMs("a", { x: { jobId: "w" } })
    expect(got).toBe(excessOf(applyEdlRow(180)))
    expect(db.queries.some((q) => q.startsWith("workflow_executions"))).toBe(false)
  })

  it("a failed read counts as 0 — the caller stays on its default limit", async () => {
    db.failJobs = true
    db.nodeStates.set("exec-1", {})
    expect(await executionBudgetExcessMs("exec-1")).toBe(0)
  })
})

describe("BudgetedDeadline — base + an excess looked up only once the base is spent", () => {
  it("nothing budgeted: reached EXACTLY at the base (the `elapsed < LIMIT` loop it replaces), one lookup", async () => {
    const read = vi.fn(async () => 0)
    const d = new BudgetedDeadline(90 * MIN, read)
    expect(await d.reached(0)).toBe(false)
    expect(await d.reached(90 * MIN - 1)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(await d.reached(90 * MIN)).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(d.limitMs).toBe(90 * MIN)
  })

  it("a found excess extends the limit, and is re-read only when the grown limit is reached", async () => {
    let excess = 60 * MIN
    const read = vi.fn(async () => excess)
    const d = new BudgetedDeadline(90 * MIN, read)
    expect(await d.reached(90 * MIN)).toBe(false)
    expect(d.limitMs).toBe(150 * MIN)
    expect(await d.reached(149 * MIN)).toBe(false)
    expect(read).toHaveBeenCalledTimes(1)
    excess = 100 * MIN // the run dispatched another long render meanwhile
    expect(await d.reached(150 * MIN)).toBe(false)
    expect(d.limitMs).toBe(190 * MIN)
    expect(await d.reached(190 * MIN)).toBe(true)
  })

  it("never shrinks, and a failed lookup keeps what is known", async () => {
    let n = 0
    const d = new BudgetedDeadline(10, async () => {
      n++
      if (n === 1) return 50
      if (n === 2) return 5
      throw new Error("db down")
    })
    expect(await d.reached(10)).toBe(false) // → 60
    expect(await d.reached(60)).toBe(true) // lookup says 5: kept at 50
    expect(d.excessMs).toBe(50)
    expect(await d.reached(60)).toBe(true) // lookup throws: kept at 50
    expect(d.excessMs).toBe(50)
  })
})
