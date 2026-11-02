// @test-watches supabase/migrations/*.sql backend/src/**/*.ts
/**
 * A job moving `pending → queued` (it waits for a concurrency slot) tells
 * nobody: no job-status webhook, no execution event on the run's stream, no
 * analytics capture. `queued` is an in-flight status like `pending`; what a
 * client sees of it is the `queue` field of a status read it makes itself.
 *
 *   - The status webhook is captured by database triggers on `jobs`
 *     (migration 521): they fire on a terminal status only, so the transition
 *     never records a delivery. Every trigger on `jobs` that can fire on a
 *     status update is checked here, as the migrations leave it.
 *   - The webhook vocabulary has no `job.queued` event.
 *   - The only write of `queued` to a `jobs` row is the park (park.ts
 *     `markWaiting`), and parking a job emits no execution event and loads no
 *     emitter: there is no backend analytics capture of job statuses at all.
 *
 * Not an event, and left as is: the `jobs` realtime publication (migration
 * 137) carries every row change, this one included; its one subscriber in the
 * editor reacts to terminal statuses only.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, walk } from "./source-scan.js"
import { IN_FLIGHT_JOB_STATUSES, TERMINAL_JOB_STATUSES } from "../job-status.js"
import { WEBHOOK_JOB_EVENTS } from "../webhooks/event-types.js"
import { ConcurrencyGate } from "../concurrency-lanes/gate.js"
import type { LaneSizes } from "../concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../concurrency-lanes/__tests__/fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../concurrency-lanes/__tests__/fake-lane-db.js"

const MIGRATIONS = resolve(__dirname, "../../../../supabase/migrations")

// ------------------------------------------------------------ the triggers

interface JobsTrigger {
  name: string
  file: string
  timing: string
  events: string
  when: string | null
}

/** SQL with comments and dollar-quoted bodies removed: only statements remain. */
function statementsOf(sql: string): string[] {
  const bare = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
  return bare.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 0)
}

const CREATE_TRIGGER = /^create (?:or replace )?(?:constraint )?trigger "?(\w+)"? (before|after|instead of) (.+?) on (?:"?public"?\.)?"?(\w+)"? (.*)$/i
const DROP_TRIGGER = /^drop trigger (?:if exists )?"?(\w+)"? on (?:"?public"?\.)?"?(\w+)"?/i

/** Apply the trigger statements of `sql` (one migration) to `live`, the `jobs` triggers so far. */
function applyTriggerStatements(sql: string, file: string, live: Map<string, JobsTrigger>): void {
  for (const statement of statementsOf(sql)) {
    const drop = DROP_TRIGGER.exec(statement)
    if (drop) {
      if (drop[2]!.toLowerCase() === "jobs") live.delete(drop[1]!)
      continue
    }
    const create = CREATE_TRIGGER.exec(statement)
    if (!create || create[4]!.toLowerCase() !== "jobs") continue
    const when = /\bwhen \((.*)\) execute (?:function|procedure)\b/i.exec(create[5]!)
    live.set(create[1]!, { name: create[1]!, file, timing: create[2]!.toLowerCase(), events: create[3]!, when: when ? when[1]! : null })
  }
}

/** The triggers on `jobs` once every migration ran, in number order. */
function liveJobsTriggers(): Map<string, JobsTrigger> {
  const live = new Map<string, JobsTrigger>()
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  for (const file of files) applyTriggerStatements(readFileSync(join(MIGRATIONS, file), "utf8"), file, live)
  return live
}

/** Whether a trigger's events include an UPDATE that a status change sets off (no column list, or one naming `status`). */
function firesOnStatusUpdate(t: JobsTrigger): boolean {
  return t.events.split(/ or /i).some((event) => {
    const m = /^update(?: of (.+))?$/i.exec(event.trim())
    if (!m) return false
    return m[1] === undefined || m[1].split(",").some((c) => c.trim().replace(/"/g, "").toLowerCase() === "status")
  })
}

/** The statuses a trigger's WHEN limits NEW.status to (`NEW.status IN (…)` or `NEW.status = '…'`); null when it names none. */
function whenStatuses(t: JobsTrigger): string[] | null {
  if (!t.when) return null
  const list = /new\.status in \(([^)]*)\)/i.exec(t.when)
  if (list) return [...list[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!)
  const one = /new\.status = '([^']*)'/i.exec(t.when)
  return one ? [one[1]!] : null
}

/**
 * Triggers that fire on a status update but send nothing — each with why.
 * A new one fails until it limits itself to terminal statuses or is listed here.
 */
const SENDS_NOTHING: Readonly<Record<string, string>> = {
  trg_clamp_workspace_job_privacy:
    "a BEFORE trigger that clamps `is_public` on a workspace job's row as it is written; it records and notifies nothing",
}

/** The trigger statuses a status-update trigger that may send something is allowed to fire on. */
function sendingTriggerProblems(live: Map<string, JobsTrigger>): string[] {
  const problems: string[] = []
  for (const t of live.values()) {
    if (!firesOnStatusUpdate(t) || t.name in SENDS_NOTHING) continue
    const statuses = whenStatuses(t)
    if (statuses === null) {
      problems.push(`${t.name} (${t.file}) fires on every status update: limit it to terminal statuses with WHEN (NEW.status IN (…)), or list it in SENDS_NOTHING`)
      continue
    }
    const inFlight = statuses.filter((s) => (IN_FLIGHT_JOB_STATUSES as readonly string[]).includes(s))
    if (inFlight.length > 0) problems.push(`${t.name} (${t.file}) fires on ${inFlight.join(", ")}`)
  }
  return problems
}

describe("the pending → queued transition fires no status event", { timeout: SCAN_TIMEOUT_MS }, () => {
  const live = liveJobsTriggers()

  it("finds the triggers on jobs (the scan works)", () => {
    expect(live.get("trg_jobs_webhook_event")).toMatchObject({ timing: "after", events: "UPDATE OF status" })
    expect(live.get("trg_jobs_webhook_event_insert")).toMatchObject({ timing: "after", events: "INSERT" })
    // Dropped and re-created by its migration: still there once.
    expect(live.has("trg_jobs_trash_clear_cover")).toBe(true)
  })

  it("the job-status webhook fires on a terminal status only", () => {
    for (const name of ["trg_jobs_webhook_event", "trg_jobs_webhook_event_insert"]) {
      const statuses = whenStatuses(live.get(name)!)
      expect(statuses, name).not.toBeNull()
      expect(statuses!.length, name).toBeGreaterThan(0)
      for (const s of statuses!) expect(TERMINAL_JOB_STATUSES as readonly string[], `${name}: ${s}`).toContain(s)
      expect(statuses, name).not.toContain("queued")
    }
  })

  it("no trigger on jobs that could send something fires on an in-flight status (queued included)", () => {
    expect(sendingTriggerProblems(live)).toEqual([])
  })

  it("every trigger listed as sending nothing still exists and still fires on a status update (a stale entry would excuse a new one)", () => {
    for (const [name, why] of Object.entries(SENDS_NOTHING)) {
      expect(live.has(name), name).toBe(true)
      expect(firesOnStatusUpdate(live.get(name)!), name).toBe(true)
      expect(why.length, name).toBeGreaterThan(30)
    }
  })

  it("the scan catches a trigger that would fire on queued", () => {
    const extra = new Map(live)
    applyTriggerStatements(
      "CREATE TRIGGER trg_jobs_notify\n  AFTER UPDATE OF progress, status ON public.jobs\n  FOR EACH ROW EXECUTE FUNCTION public.notify_job();",
      "999_test.sql",
      extra,
    )
    expect(sendingTriggerProblems(extra)).toEqual([expect.stringContaining("trg_jobs_notify (999_test.sql) fires on every status update")])
    applyTriggerStatements(
      "CREATE OR REPLACE TRIGGER trg_jobs_notify AFTER UPDATE ON jobs FOR EACH ROW WHEN (NEW.status IN ('queued', 'completed')) EXECUTE FUNCTION notify_job();",
      "999_test.sql",
      extra,
    )
    expect(sendingTriggerProblems(extra)).toEqual(["trg_jobs_notify (999_test.sql) fires on queued"])
    applyTriggerStatements("DROP TRIGGER IF EXISTS trg_jobs_notify ON public.jobs;", "999_test.sql", extra)
    expect(sendingTriggerProblems(extra)).toEqual([])
    // A function body that happens to spell a trigger is not a statement.
    applyTriggerStatements(
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN EXECUTE 'CREATE TRIGGER t AFTER UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION g()'; END $$ LANGUAGE plpgsql;",
      "999_test.sql",
      extra,
    )
    expect(extra.has("t")).toBe(false)
  })

  it("the webhook vocabulary has no queued event", () => {
    expect(WEBHOOK_JOB_EVENTS as readonly string[]).not.toContain("job.queued")
    for (const event of WEBHOOK_JOB_EVENTS) {
      expect(TERMINAL_JOB_STATUSES as readonly string[]).toContain(event.replace(/^job\./, ""))
    }
  })
})

// ------------------------------------------------------------ the writers

/** Does `call` write to `jobs` (an `.update` / `.insert` / `.upsert` on a `.from("jobs")` chain)? */
function writesJobs(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false
  if (!["update", "insert", "upsert"].includes(call.expression.name.text)) return false
  let e: ts.Expression = call.expression.expression
  for (;;) {
    if (ts.isCallExpression(e)) {
      const arg = e.arguments[0]
      if (ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "from" && arg !== undefined && ts.isStringLiteralLike(arg)) {
        return arg.text === "jobs"
      }
      e = e.expression
    } else if (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) {
      e = e.expression
    } else {
      return false
    }
  }
}

/** Whether a write's payload sets `status: "queued"` (an object literal, or an array of them). */
function setsQueued(call: ts.CallExpression): boolean {
  const payload = call.arguments[0]
  const literals = payload && ts.isArrayLiteralExpression(payload) ? payload.elements : payload ? [payload] : []
  return literals.some((l) => ts.isObjectLiteralExpression(l) && l.properties.some((p) =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "status" && ts.isStringLiteralLike(p.initializer) && p.initializer.text === "queued"))
}

const EMITTERS = [/execution-events\.js$/, /\/sse\.js$/, /\/webhooks\//]

describe("the only writer of a queued job is the park, and it loads no emitter", { timeout: SCAN_TIMEOUT_MS }, () => {
  const writers = new Set<string>()
  const importsOf = new Map<string, string[]>()
  eachSourceFile(['"queued"'], (sf, rel) => {
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && writesJobs(n) && setsQueued(n)) writers.add(rel)
    })
    if (rel === "lib/concurrency-lanes/park.ts" || rel === "lib/concurrency-lanes/columns.ts") {
      importsOf.set(rel, sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text))
    }
  })

  it("park.ts is the one file that writes `queued` to a jobs row", () => {
    expect([...writers]).toEqual(["lib/concurrency-lanes/park.ts"])
  })

  it("the park and the stamps it writes first import no event emitter", () => {
    expect([...importsOf.keys()].sort()).toEqual(["lib/concurrency-lanes/columns.ts", "lib/concurrency-lanes/park.ts"])
    for (const [file, imports] of importsOf) {
      expect(imports.filter((i) => EMITTERS.some((re) => re.test(i))), file).toEqual([])
    }
  })

  it("the scan sees the spellings in use", () => {
    const count = (text: string) => {
      const sf = ts.createSourceFile("x.ts", `async function f() { ${text} }`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
      let n = 0
      walk(sf, (node) => {
        if (ts.isCallExpression(node) && writesJobs(node) && setsQueued(node)) n++
      })
      return n
    }
    expect(count(`await supabase.from("jobs").update({ status: "queued" }).eq("id", id)`)).toBe(1)
    expect(count(`await (supabase.from("jobs") as any).update({ status: "queued" })`)).toBe(1)
    expect(count(`await supabase.from("jobs").insert([{ id, status: "queued" }])`)).toBe(1)
    expect(count(`await supabase.from("jobs").update({ status: "pending" })`)).toBe(0)
    expect(count(`await supabase.from("scheduled_posts").update({ status: "queued" })`)).toBe(0)
  })
})

// ------------------------------------------------------- parking, for real

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
}))

vi.mock("bullmq", async (importOriginal) => {
  const real = await importOriginal<typeof import("bullmq")>()
  class Queue {
    constructor(readonly name: string, readonly opts: unknown) {}
  }
  return { ...real, Queue, Job: { fromId: vi.fn(async () => undefined) } }
})
vi.mock("../concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
// A job parks only where limits can be turned on: the parking path is made available.
vi.mock("../concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
vi.mock("../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("../concurrency-lanes/sizes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../concurrency-lanes/sizes.js")>()),
  laneSizesFor: async () => refs.sizes,
}))
vi.mock("../concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => "kie" }))
vi.mock("../queue.js", () => ({ redis: { fake: "connection" } }))
vi.mock("../concurrency-lanes/wake-subscriber.js", () => ({ startLaneWakeSubscriber: () => () => {} }))

describe("parking a job emits no execution event", () => {
  let db: FakeLaneDb
  let gate: ConcurrencyGate

  beforeEach(async () => {
    db = makeFakeLaneDb()
    refs.db = db
    const store = makeFakeLaneStore()
    gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
    refs.gate = gate
    vi.stubEnv("RUNTIME_ENV", "production")
    const { resetWorkerAdmitHooksForTests } = await import("../concurrency-lanes/worker-admit.js")
    const { registerLaneParking, resetLaneParkingForTests, setLaneQueueConnection } = await import("../concurrency-lanes/park.js")
    const { resetLaneColumnsForTests } = await import("../concurrency-lanes/columns.js")
    const { resetServerShareForTests } = await import("../concurrency-lanes/server-share.js")
    resetWorkerAdmitHooksForTests()
    resetLaneParkingForTests()
    resetLaneColumnsForTests()
    resetServerShareForTests()
    registerLaneParking()
    setLaneQueueConnection({ fake: "connection" })
    await gate.setEnforced(true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("a job over its line moves pending → queued, and nothing is emitted", async () => {
    const { executionEvents } = await import("../execution-events.js")
    const emit = vi.spyOn(executionEvents, "emit")
    const { admitOrPark } = await import("../concurrency-lanes/worker-admit.js")
    // The user's one provider slot is taken.
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "provider", provider: "kie", source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: "bull-other" },
      size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
    })
    const row = { id: "job-1", user_id: "U", status: "pending", lane_queued_at: null as string | null }
    db.rows("jobs").push(row)
    const job = {
      id: "bull-job-1", name: "image-to-video", data: { jobId: "job-1", userId: "U" }, opts: { priority: 1, attempts: 3 },
      moveToDelayed: vi.fn(async () => undefined), promote: vi.fn(async () => undefined),
    }
    const admission = await admitOrPark({
      job, token: "tok", queue: "video-generation",
      row: {
        id: "job-1", user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
        pipeline_id: null, workspace_id: null, org_id: null, source: "editor", source_detail: null, mcp_client: null,
      },
    })
    expect(admission).toBeNull()
    expect(row.status).toBe("queued")
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
    // No delivery is recorded by the backend either (the database's capture is the triggers above).
    expect(db.rows("webhook_deliveries")).toEqual([])
  })
})
