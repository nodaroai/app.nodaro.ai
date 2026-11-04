// @test-watches supabase/tests/fixtures/motion-price-run-cases.json supabase/tests/fixtures/motion-engine-cases.json
/**
 * The admin Motion price check reads every Nodaro Motion run's figures in SQL
 * (`public.admin_motion_runs` and `public.admin_motion_engine`, migration 593),
 * proved against two case tables in supabase/tests/admin-motion-price-check.behavior.sql.
 * This file holds the same tables to the TypeScript every other surface reads,
 * so the SQL cannot drift from it:
 *
 *  - each expected run's hold, charge and settlement are exactly what the one
 *    loader of a run's figures (`runCreditsFor`) answers for the case's jobs,
 *    usage logs and side holds — its database reads answered from the case's
 *    rows by the double `job-run-credits.test.ts` uses too
 *    (`helpers/run-credits-db.ts`);
 *  - each engine case's group (`pulse` / `prism`) is the one the internal
 *    engine id names (`castSwapEngineFrom`, Seedance 2.5 when none).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CAST_SWAP_ENGINE_WHEN_OMITTED, castSwapEngineFrom } from "@nodaro/shared/models"
import { db, resetDb } from "./helpers/run-credits-db.js"

interface CaseJob {
  key: string
  id: string
  parent: string | null
  credits: number | null
  log: { status: string; used: number | null; charged: number | null } | null
  owner?: "other"
}
interface CaseSide {
  job: string
  status: string
  used: number
  charged: number | null
}
interface Expected {
  held: number | null
  taken: number | null
  settled: boolean
}
interface RunCase {
  label: string
  jobs: CaseJob[]
  side?: CaseSide[]
  expect: Record<string, Expected>
}
interface EngineCase {
  engine: string | null
  expected: "pulse" | "prism"
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../supabase/tests/fixtures/${name}`, import.meta.url)), "utf8")) as T
}
const RUN_CASES = fixture<RunCase[]>("motion-price-run-cases.json")
const ENGINE_CASES = fixture<EngineCase[]>("motion-engine-cases.json")

const OWNER_ID = "00000000-0000-4000-8000-000000593001"
const OTHER_ID = "00000000-0000-4000-8000-000000593002"
vi.mock("../config.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withCreditsSwitch(await importOriginal<typeof import("../config.js")>()))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withMeteredSchemaReady(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()))
vi.mock("../supabase.js", async () => (await import("./helpers/run-credits-db.js")).supabaseDouble())

const { runCreditsFor, runCreditsOf } = await import("../job-credit-status.js")

const logIdOf = (job: CaseJob) => (job.log ? `ul-${job.id}` : null)

/** The case's rows, as the database double answers them. */
function load(c: RunCase): void {
  db.jobs = c.jobs.map((j) => ({
    id: j.id,
    parent_job_id: j.parent,
    usage_log_id: logIdOf(j),
    credits: j.credits,
    user_id: j.owner === "other" ? OTHER_ID : OWNER_ID,
  }))
  db.logs = c.jobs.flatMap((j) => (j.log ? [{ id: logIdOf(j)!, status: j.log.status, credits_used: j.log.used, credits_charged: j.log.charged }] : []))
  db.side = (c.side ?? []).map((s) => {
    const job = c.jobs.find((j) => j.key === s.job)
    if (!job) throw new Error(`${c.label}: a side hold names no job "${s.job}"`)
    return { job_id: job.id, usage_logs: { status: s.status, credits_used: s.used, credits_charged: s.charged } }
  })
}

beforeEach(() => resetDb())

describe("the Motion price check's run figures — one rule for SQL and TypeScript", () => {
  it("has every case to check: twenty-two runs, and a job that is not one", () => {
    expect(RUN_CASES.reduce((n, c) => n + Object.keys(c.expect).length, 0)).toBe(22)
    expect(RUN_CASES.some((c) => Object.keys(c.expect).length === 0)).toBe(true)
  })

  it("names every job by an id of the proof's own range, once", () => {
    const ids = RUN_CASES.flatMap((c) => c.jobs.map((j) => j.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^00000000-0000-4000-8000-000000593\d{3}$/)
  })

  for (const c of RUN_CASES) {
    for (const [key, expected] of Object.entries(c.expect)) {
      it(`runCreditsFor agrees: ${c.label} / ${key}`, async () => {
        load(c)
        const run = c.jobs.find((j) => j.key === key)
        expect(run, `${c.label}: no job "${key}"`).toBeDefined()
        const credits = await runCreditsFor([{ id: run!.id, usage_log_id: logIdOf(run!), credits: run!.credits, user_id: OWNER_ID }], OWNER_ID)
        const figures = runCreditsOf(run!.id, credits)
        expect(figures).not.toBeNull()
        expect({ held: figures!.held, charged: figures!.charged, settled: figures!.settled }).toEqual({
          held: expected.held,
          charged: expected.taken,
          settled: expected.settled,
        })
      })
    }
  }
})

describe("the Motion price check's engine — one rule for SQL and TypeScript", () => {
  it("has every engine id to check, in each vocabulary, and one that names none", () => {
    expect(ENGINE_CASES.length).toBeGreaterThanOrEqual(8)
    expect(ENGINE_CASES.some((c) => c.engine === null)).toBe(true)
  })

  for (const c of ENGINE_CASES) {
    it(`${String(c.engine)} runs on ${c.expected}`, () => {
      expect((castSwapEngineFrom(c.engine) ?? CAST_SWAP_ENGINE_WHEN_OMITTED) === "kling-4" ? "pulse" : "prism").toBe(c.expected)
    })
  }
})
