// @test-reads-none a database double; reads no repo file
/**
 * A use-case run's charge (decided 2026-11-17): the run's own job holds only
 * its per-run fee, and its steps are the jobs of its own inner execution
 * (`workflow_execution_id`), never children by `parent_job_id`. They count as
 * its steps, with their own children, so `credits_charged` / `credits_held`
 * are the whole run's.
 *
 * The case "Clip Pack, 3 clips" is the production run of 2026-11-17 (quoted
 * 754): the fee 11, Transcribe 25, Edit Plan 62, three framed renders 22 + 11
 * + 22, and captions 55 on one clip (the two whose captions failed were
 * refunded) — 208 charged, where the run used to show 11.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DB_DEFAULT_OWNER, db as h, resetDb, type DbJob as Job, type DbLog as Log } from "./helpers/run-credits-db.js"

vi.mock("../config.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withCreditsSwitch(await importOriginal<typeof import("../config.js")>()))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withMeteredSchemaReady(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()))
vi.mock("../supabase.js", async () => (await import("./helpers/run-credits-db.js")).supabaseDouble())

const { runCreditsFor, creditsChargedOf, publicCreditFieldsOf, useCaseRunExecutionOf } = await import("../job-credit-status.js")
const { INNER_JOBS_PAGE } = await import("../job-run-steps.js")

const OWNER = DB_DEFAULT_OWNER
const job = (id: string, credits: number, over: Partial<Job> = {}): Job => ({ id, parent_job_id: null, usage_log_id: `ul-${id}`, credits, ...over })
const committed = (id: string, held: number, charged: number): Log => ({ id: `ul-${id}`, status: "committed", credits_used: held, credits_charged: charged })
const refunded = (id: string, held: number): Log => ({ id: `ul-${id}`, status: "refunded", credits_used: held, credits_charged: 0 })
/** The run's row as a reader passes it: its own hold and its input, which names its inner execution. */
const runRow = (id: string, execution: string, type = "clip-pack") => ({ id, usage_log_id: `ul-${id}`, credits: 11, input_data: { type, _executionId: execution } })

beforeEach(() => resetDb())

/** The production Clip Pack: the run and the jobs of its inner execution. */
function clipPack(): void {
  const inner = (id: string, credits: number) => job(id, credits, { workflow_execution_id: "exec-1" })
  h.jobs = [
    job("run", 11),
    inner("transcribe", 25), inner("plan", 62),
    inner("render-1", 22), inner("render-2", 11), inner("render-3", 22),
    inner("captions-1", 55), inner("captions-2", 55), inner("captions-3", 55),
  ]
  h.logs = [
    committed("run", 11, 11), committed("transcribe", 25, 25), committed("plan", 62, 62),
    committed("render-1", 22, 22), committed("render-2", 11, 11), committed("render-3", 22, 22),
    committed("captions-1", 55, 55), refunded("captions-2", 55), refunded("captions-3", 55),
  ]
}

describe("runCreditsFor — a use-case run's steps are its inner execution's jobs", () => {
  it("Clip Pack, 3 clips: the fee and every step = 208 charged, the whole run held", async () => {
    clipPack()
    const credits = await runCreditsFor([runRow("run", "exec-1")], OWNER)
    expect(creditsChargedOf("run", credits)).toBe(208)
    expect(credits.get("run")).toMatchObject({ ownCharged: 11, ownHeld: 11, charged: 208, held: 318, released: 110, steps: 8, settled: true, complete: true })
    expect(publicCreditFieldsOf("run", credits)).toEqual({ credits_charged: 208, credits_held: 318, credits_released: 110 })
  })

  it("a step's own child job (a plugin step under a render) counts too", async () => {
    clipPack()
    h.jobs = [...h.jobs, job("frames", 9, { parent_job_id: "render-1" })]
    h.logs = [...h.logs, committed("frames", 9, 9)]
    const credits = await runCreditsFor([runRow("run", "exec-1")], OWNER)
    expect(creditsChargedOf("run", credits)).toBe(217)
  })

  it("a row read without its input (a caller that passes none) is the run's own job alone, as before", async () => {
    clipPack()
    const credits = await runCreditsFor([{ id: "run", usage_log_id: "ul-run", credits: 11 }], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: 11, held: 11, steps: 0 })
    expect(h.reads.some((r) => r.column === "workflow_execution_id")).toBe(false)
  })

  it("a continuation counts only its own execution: the steps it reused stay the earlier run's, never counted twice", async () => {
    // The first run failed after its plan; its continuation re-ran only the render.
    h.jobs = [
      job("first", 11), job("transcribe", 25, { workflow_execution_id: "exec-1" }), job("plan", 62, { workflow_execution_id: "exec-1" }),
      job("again", 11), job("render", 22, { workflow_execution_id: "exec-2" }),
    ]
    h.logs = [committed("first", 11, 0), committed("transcribe", 25, 25), committed("plan", 62, 62), committed("again", 11, 11), committed("render", 22, 22)]
    const credits = await runCreditsFor([runRow("first", "exec-1"), runRow("again", "exec-2")], OWNER)
    expect(creditsChargedOf("first", credits)).toBe(87)
    expect(creditsChargedOf("again", credits)).toBe(33)
  })

  it("an inner job asked for beside its run is the run's step and its own row", async () => {
    clipPack()
    const credits = await runCreditsFor([runRow("run", "exec-1"), { id: "plan", usage_log_id: "ul-plan", credits: 62 }], OWNER)
    expect(creditsChargedOf("run", credits)).toBe(208)
    expect(creditsChargedOf("plan", credits)).toBe(62)
  })

  it("another owner's jobs in that execution are never counted", async () => {
    clipPack()
    h.jobs = [...h.jobs, job("intruder", 999, { workflow_execution_id: "exec-1", user_id: "00000000-0000-4000-8000-0000000000b2" })]
    h.logs = [...h.logs, committed("intruder", 999, 999)]
    h.ignoreOwner = true
    expect(creditsChargedOf("run", await runCreditsFor([runRow("run", "exec-1")], OWNER))).toBe(208)
  })

  it("a run with more steps than one page of the database is read to its last step", async () => {
    const steps = Array.from({ length: INNER_JOBS_PAGE + 5 }, (_, i) => job(`s-${String(i).padStart(5, "0")}`, 2, { workflow_execution_id: "exec-big" }))
    h.jobs = [job("big", 11), ...steps]
    h.logs = [committed("big", 11, 11), ...steps.map((s) => committed(s.id, 2, 2))]
    const credits = await runCreditsFor([runRow("big", "exec-big")], OWNER)
    expect(credits.get("big")).toMatchObject({ steps: INNER_JOBS_PAGE + 5, charged: 11 + 2 * (INNER_JOBS_PAGE + 5), complete: true })
  })

  it("a read of the steps that fails leaves the run's figures unknown, never a lower number", async () => {
    clipPack()
    h.failSteps = true
    const credits = await runCreditsFor([runRow("run", "exec-1")], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: null, held: null, complete: false, ownCharged: 11 })
  })
})

describe("useCaseRunExecutionOf — which job is a use-case run", () => {
  it("a run of a use-case type with its execution stamp", () => {
    expect(useCaseRunExecutionOf({ type: "clip-pack", _executionId: "exec-1" })).toBe("exec-1")
    expect(useCaseRunExecutionOf({ type: "tighten-episode", mode: "render-final", _executionId: "exec-9" })).toBe("exec-9")
  })
  it("never a step of one, another job type, a run not stamped yet, or no input", () => {
    expect(useCaseRunExecutionOf({ type: "speaker-view", _executionId: "exec-1" })).toBeUndefined()
    expect(useCaseRunExecutionOf({ type: "clip-pack" })).toBeUndefined()
    expect(useCaseRunExecutionOf({ type: "clip-pack", _executionId: "" })).toBeUndefined()
    expect(useCaseRunExecutionOf(null)).toBeUndefined()
    expect(useCaseRunExecutionOf("clip-pack")).toBeUndefined()
  })
})
