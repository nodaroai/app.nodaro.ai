/**
 * The database double behind a run's figures (`runCreditsFor`,
 * lib/job-credit-status.ts): the reads it makes — the steps (`jobs` by
 * `parent_job_id`, owner-scoped, one read per tree level), their usage logs,
 * and the committed side holds — answered from the rows a test sets, with
 * every read recorded. Shared by job-run-credits.test.ts and
 * motion-price-run-cases.test.ts, so the two cannot answer differently.
 *
 * Each test file still declares its own vi.mock() calls (Vitest hoists them),
 * each delegating here:
 *
 *   vi.mock("../config.js", async (importOriginal) =>
 *     (await import("./helpers/run-credits-db.js")).withCreditsSwitch(await importOriginal<typeof import("../config.js")>()))
 *   vi.mock("../llm-metered-schema-gate.js", async (importOriginal) =>
 *     (await import("./helpers/run-credits-db.js")).withMeteredSchemaReady(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()))
 *   vi.mock("../supabase.js", async () => (await import("./helpers/run-credits-db.js")).supabaseDouble())
 *
 * and calls `resetDb()` in `beforeEach`. The test and the mocks import this one
 * module, so they share `db`.
 */

export type DbJob = { id: string; parent_job_id: string | null; usage_log_id: string | null; credits: number | null; user_id?: string }
export type DbLog = { id: string; status: string; credits_used: number | null; credits_charged: number | null }
export type DbSide = { job_id: string; usage_logs: { status: string; credits_used: number | null; credits_charged: number | null } }
export type DbRead = { table: string; column: string; ids: unknown[]; eqs: Array<[string, unknown]>; ins: Array<[string, unknown[]]> }

/** The owner of a job row that names none. */
export const DB_DEFAULT_OWNER = "00000000-0000-4000-8000-0000000000a1"

/** The rows the double answers from, its switches, and every read it was asked for. */
export const db = {
  /** `hasCredits()`: without credits nothing is read for steps. */
  credits: true,
  /** A steps read that fails (the gateway, a timeout). */
  failSteps: false,
  /** A database that ignores the owner filter (defence in depth must still hold). */
  ignoreOwner: false,
  jobs: [] as DbJob[],
  logs: [] as DbLog[],
  side: [] as DbSide[],
  reads: [] as DbRead[],
}

/** Every switch back to its default and every table empty. */
export function resetDb(): void {
  db.credits = true
  db.failSteps = false
  db.ignoreOwner = false
  db.jobs = []
  db.logs = []
  db.side = []
  db.reads = []
}

/** lib/config.js with `hasCredits()` read from `db.credits`. */
export function withCreditsSwitch<T extends { hasCredits: () => boolean }>(config: T): T {
  return { ...config, hasCredits: () => db.credits }
}

/** lib/llm-metered-schema-gate.js with the metered schema ready (side holds are read). */
export function withMeteredSchemaReady<T extends { llmMeteredSchemaReady: () => boolean }>(gate: T): T {
  return { ...gate, llmMeteredSchemaReady: () => true }
}

/** lib/supabase.js: `from(table)` answering the three reads from `db`. */
export function supabaseDouble() {
  return {
    supabase: {
      from: (table: string) => {
        const read: DbRead = { table, column: "", ids: [], eqs: [], ins: [] }
        db.reads.push(read)
        const ownerOk = (j: DbJob) => {
          const owner = j.user_id ?? DB_DEFAULT_OWNER
          const eq = read.eqs.find(([c]) => c === "user_id")
          const inList = read.ins.find(([c]) => c === "user_id")
          return db.ignoreOwner || ((!eq || eq[1] === owner) && (!inList || inList[1].includes(owner)))
        }
        const rows = (): unknown[] => {
          if (table === "jobs") return db.jobs.filter((j) => read.ids.includes((j as Record<string, unknown>)[read.column]) && ownerOk(j))
          if (table === "usage_logs") return db.logs.filter((l) => read.ids.includes(l.id))
          return db.side.filter((s) => read.ids.includes(s.job_id) && s.usage_logs.status === "committed")
        }
        const q = {
          select: () => q,
          in: (column: string, ids: unknown[]) => (read.ins.push([column, ids]), column === "user_id" ? q : ((read.column = column), (read.ids = ids), q)),
          eq: (column: string, value: unknown) => (read.eqs.push([column, value]), q),
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(table === "jobs" && db.failSteps ? { data: null, error: { message: "timeout" } } : { data: rows(), error: null }).then(res),
        }
        return q
      },
    },
  }
}
