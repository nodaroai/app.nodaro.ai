// @test-reads-none a database double; reads no repo file
/**
 * A job's public charge is a RUN's: its own settled charge plus every step it
 * ran (child jobs by `parent_job_id`, at any depth, each billed on its own
 * usage log) plus settled side holds — through the one loader,
 * `runCreditsFor`, in one read per table (one per tree level for the steps).
 *
 * In flight: the run reads null while the job's own hold is open; once it
 * settles, a step adds its charge only once the step settles too; a refunded
 * step adds 0. "Released" is shown only when every hold in the run settled.
 *
 * The case "Nodaro Motion 4 s preview" is the production run of 2026-10-26:
 * Cast Swap 44, two reference preps at 66, a mask at 33 and the video held
 * 3,564 and charged 854.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
// The database double is shared with motion-price-run-cases.test.ts; `h` is its state.
import { DB_DEFAULT_OWNER, db as h, resetDb, type DbJob as Job, type DbLog as Log } from "./helpers/run-credits-db.js"

vi.mock("../config.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withCreditsSwitch(await importOriginal<typeof import("../config.js")>()))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) =>
  (await import("./helpers/run-credits-db.js")).withMeteredSchemaReady(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()))
vi.mock("../supabase.js", async () => (await import("./helpers/run-credits-db.js")).supabaseDouble())

const { runCreditsFor, creditsChargedOf, publicCreditFieldsOf } = await import("../job-credit-status.js")

const OWNER = DB_DEFAULT_OWNER

const job = (id: string, parent: string | null, credits: number | null, log: string | null = `ul-${id}`): Job => ({
  id,
  parent_job_id: parent,
  usage_log_id: log,
  credits,
})
const committed = (id: string, held: number, charged: number): Log => ({ id, status: "committed", credits_used: held, credits_charged: charged })
const reserved = (id: string, held: number): Log => ({ id, status: "reserved", credits_used: held, credits_charged: null })
const refunded = (id: string, held: number): Log => ({ id, status: "refunded", credits_used: held, credits_charged: 0 })
const rowOf = (j: Job) => ({ id: j.id, usage_log_id: j.usage_log_id, credits: j.credits })

beforeEach(() => resetDb())

/** The production Nodaro Motion preview: a Cast Swap parent and its four steps. */
function motionPreview(): Job {
  const parent = job("run", null, 44)
  h.jobs = [parent, job("ref-1", "run", 66), job("ref-2", "run", 66), job("mask", "run", 33), job("video", "run", 3564)]
  h.logs = [
    committed("ul-run", 44, 44),
    committed("ul-ref-1", 66, 66),
    committed("ul-ref-2", 66, 66),
    committed("ul-mask", 33, 33),
    committed("ul-video", 3564, 854),
  ]
  return parent
}

describe("runCreditsFor — a run's charge includes its steps", () => {
  it("a job with no steps: its own charge, its own hold", async () => {
    const solo = job("solo", null, 120)
    h.jobs = [solo]
    h.logs = [committed("ul-solo", 120, 90)]
    const credits = await runCreditsFor([rowOf(solo)], OWNER)
    expect(credits.get("solo")).toEqual({
      status: "committed", ownCharged: 90, ownHeld: 120, ownReleased: 30,
      charged: 90, held: 120, released: 30, sideCharged: 0, stepsCharged: null, steps: 0, settled: true, stepsSettled: true, complete: true,
    })
    expect(publicCreditFieldsOf("solo", credits)).toEqual({ credits_charged: 90, credits_held: 120, credits_released: 30 })
  })

  it("Nodaro Motion 4 s preview: the parent's 44 plus its four settled steps = 1,063", async () => {
    const parent = motionPreview()
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(creditsChargedOf("run", credits)).toBe(1063)
    expect(credits.get("run")).toMatchObject({ ownCharged: 44, ownHeld: 44, charged: 1063, held: 3773, released: 2710, steps: 4, settled: true })
  })

  it("a refunded step counts 0 (its hold went back)", async () => {
    const parent = motionPreview()
    h.logs = h.logs.map((l) => (l.id === "ul-mask" ? refunded("ul-mask", 33) : l))
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: 1030, held: 3773, released: 2743, settled: true })
  })

  it("a step still held adds nothing until it settles; nothing is shown as released meanwhile", async () => {
    const parent = motionPreview()
    h.logs = h.logs.map((l) => (l.id === "ul-video" ? reserved("ul-video", 3564) : l))
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: 209, held: 3773, released: null, settled: false })
  })

  it("the job's own hold open: the run reads null (not settled yet), with the run's hold", async () => {
    const parent = motionPreview()
    h.logs = h.logs.map((l) => (l.id === "ul-run" ? reserved("ul-run", 44) : l))
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(creditsChargedOf("run", credits)).toBeNull()
    expect(credits.get("run")).toMatchObject({ status: "reserved", ownCharged: null, charged: null, held: 3773, released: null, settled: false })
  })

  it("grandchildren count, and each step's settled side holds", async () => {
    const parent = job("p", null, 10)
    h.jobs = [parent, job("c", "p", 20), job("g", "c", 30)]
    h.logs = [committed("ul-p", 10, 10), committed("ul-c", 20, 15), committed("ul-g", 30, 25)]
    h.side = [{ job_id: "g", usage_logs: { status: "committed", credits_used: 5, credits_charged: 4 } }]
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("p")).toMatchObject({ charged: 54, held: 60, steps: 2, settled: true })
  })

  it("a job with no usage log but paid steps reports the steps' charge", async () => {
    const parent = job("free", null, 0, null)
    h.jobs = [parent, job("paid", "free", 50)]
    h.logs = [committed("ul-paid", 50, 40)]
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("free")).toMatchObject({ status: null, ownCharged: null, charged: 40, held: 50 })
  })

  it("a job with no usage log and no steps stays null (not available)", async () => {
    const free = job("free", null, null, null)
    h.jobs = [free]
    const credits = await runCreditsFor([rowOf(free)], OWNER)
    expect(publicCreditFieldsOf("free", credits)).toEqual({ credits_charged: null, credits_held: null, credits_released: null })
  })

  it("a parent and its child listed together: the parent's run has the child, the child's own figures do not double it", async () => {
    const parent = motionPreview()
    const video = h.jobs.find((j) => j.id === "video")!
    const credits = await runCreditsFor([rowOf(parent), rowOf(video)], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: 1063, steps: 4 })
    expect(credits.get("video")).toMatchObject({ ownCharged: 854, charged: 854, steps: 0 })
    // A total over a list adds each row's OWN charge: every job counted once.
    expect((credits.get("run")!.ownCharged ?? 0) + (credits.get("video")!.ownCharged ?? 0)).toBe(898)
  })

  it("batches: one jobs read per tree level, one usage-log read and one side-hold read for the whole page", async () => {
    const parents = ["a", "b", "c"].map((id) => job(id, null, 10))
    h.jobs = [...parents, ...["a", "b", "c"].flatMap((p) => [job(`${p}1`, p, 5), job(`${p}2`, p, 5)]), job("a11", "a1", 1)]
    h.logs = h.jobs.map((j) => committed(`ul-${j.id}`, j.credits ?? 0, j.credits ?? 0))
    const credits = await runCreditsFor(parents.map(rowOf), OWNER)
    expect(credits.get("a")).toMatchObject({ charged: 21, steps: 3 })
    expect(credits.get("b")).toMatchObject({ charged: 20, steps: 2 })
    const byTable = (t: string) => h.reads.filter((r) => r.table === t)
    // Levels 1, 2 and 3 (the last finds nothing): never a read per job.
    expect(byTable("jobs")).toHaveLength(3)
    expect(byTable("jobs")[0]).toMatchObject({ column: "parent_job_id", ids: ["a", "b", "c"] })
    // Every step read is the owner's, in the query.
    for (const r of byTable("jobs")) expect(r.eqs).toContainEqual(["user_id", OWNER])
    expect(byTable("usage_logs")).toHaveLength(1)
    expect(byTable("llm_side_holds")).toHaveLength(1)
  })

  it("a loop in parent_job_id ends, and the walk stops after five levels", async () => {
    const a = job("a", "b", 1)
    h.jobs = [a, job("b", "a", 1)]
    h.logs = [committed("ul-a", 1, 1), committed("ul-b", 1, 1)]
    expect((await runCreditsFor([rowOf(a)], OWNER)).get("a")).toMatchObject({ charged: 2, steps: 1 })

    const chain = Array.from({ length: 8 }, (_, i) => job(`n${i}`, i === 0 ? null : `n${i - 1}`, 1))
    h.jobs = chain
    h.logs = chain.map((j) => committed(`ul-${j.id}`, 1, 1))
    h.reads = []
    expect((await runCreditsFor([rowOf(chain[0]!)], OWNER)).get("n0")).toMatchObject({ charged: 6, steps: 5 })
    expect(h.reads.filter((r) => r.table === "jobs")).toHaveLength(5)
  })

  it("a page mixing owners (an admin list): each step read as its parent's owner's, ids and owners packed per request", async () => {
    const OTHER = "00000000-0000-4000-8000-0000000000b2"
    const mine = { ...job("m", null, 10), user_id: OWNER }
    const theirs = { ...job("t", null, 10), user_id: OTHER }
    h.jobs = [mine, theirs, { ...job("m1", "m", 5), user_id: OWNER }, { ...job("t1", "t", 7), user_id: OTHER }]
    h.logs = h.jobs.map((j) => committed(`ul-${j.id}`, j.credits ?? 0, j.credits ?? 0))
    const credits = await runCreditsFor([mine, theirs].map((j) => ({ ...rowOf(j), user_id: j.user_id })), [OWNER, OTHER])
    expect(credits.get("m")).toMatchObject({ charged: 15, steps: 1 })
    expect(credits.get("t")).toMatchObject({ charged: 17, steps: 1 })
    const first = h.reads.find((r) => r.table === "jobs")!
    expect(first.ins).toEqual([["user_id", [OWNER, OTHER]], ["parent_job_id", ["m", "t"]]])
    // A row whose owner is not among the ones named gets no steps.
    h.reads = []
    const stray = await runCreditsFor([{ ...rowOf(theirs), user_id: OTHER }], [OWNER])
    expect(stray.get("t")).toMatchObject({ charged: 10, steps: 0 })
    expect(h.reads.filter((r) => r.table === "jobs")).toHaveLength(0)
  })

  it("packs at most 200 ids and owners into one request", async () => {
    const owners = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    const roots = owners.map((o, i) => ({ ...job(`r${i}`, null, 1), user_id: o }))
    h.jobs = roots
    h.logs = []
    await runCreditsFor(roots.map((j) => ({ ...rowOf(j), user_id: j.user_id })), owners)
    const reads = h.reads.filter((r) => r.table === "jobs")
    expect(reads.length).toBe(2)
    for (const r of reads) {
      const size = r.ins.reduce((n, [, ids]) => n + ids.length, 0)
      expect(size).toBeLessThanOrEqual(200)
    }
    expect(reads.flatMap((r) => r.ins.find(([c]) => c === "parent_job_id")![1]).sort()).toEqual(roots.map((r) => r.id).sort())
  })

  it("a steps read that fails reads as unknown (null) — never a lower figure; the job's own figures stand", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const parent = motionPreview()
    h.failSteps = true
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("run")).toMatchObject({
      complete: false, charged: null, held: null, released: null, stepsCharged: null, settled: false,
      status: "committed", ownCharged: 44, ownHeld: 44,
    })
    expect(publicCreditFieldsOf("run", credits)).toEqual({ credits_charged: null, credits_held: null, credits_released: null })
  })

  it("a refunded run whose reference and mask steps committed reads 165", async () => {
    const parent = motionPreview()
    h.jobs = h.jobs.filter((j) => j.id !== "video")
    h.logs = h.logs.map((l) => (l.id === "ul-run" ? refunded("ul-run", 44) : l))
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("run")).toMatchObject({ status: "refunded", charged: 165 })
  })

  it("a step row of another owner is dropped even if the database returned it", async () => {
    const parent = motionPreview()
    h.jobs = [...h.jobs, { ...job("intruder", "run", 999), user_id: "00000000-0000-4000-8000-0000000000ff" }]
    h.logs = [...h.logs, committed("ul-intruder", 999, 999)]
    h.ignoreOwner = true
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(credits.get("run")).toMatchObject({ charged: 1063, steps: 4 })
  })

  it("without credits nothing is read for steps", async () => {
    h.credits = false
    const parent = motionPreview()
    const credits = await runCreditsFor([rowOf(parent)], OWNER)
    expect(h.reads.filter((r) => r.table === "jobs")).toHaveLength(0)
    expect(credits.get("run")).toMatchObject({ charged: 44, steps: 0 })
  })
})
