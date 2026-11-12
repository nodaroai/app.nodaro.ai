/**
 * ONE RULE FOR A RUN'S STATES AND ITS JOBS (lib/provider-words-readers.ts,
 * decided 2026-11-11). The provider's words of a run's failed node are served
 * twice: on the run's states (`GET /v1/workflow-executions/:id`) and on the
 * job that failed (`GET /v1/jobs/:id`). Both ask the same run rule, so for any
 * run and any reader the two reads give the same answer — the guard against
 * the drift where a use-case node's inner run kept its states' words from its
 * own owner while its jobs gave them out.
 *
 * Each case seeds one failed run (its failed node carrying the words) and that
 * node's failed job, reads both as the reader, and requires the same answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockWorkflowAccess, db } = vi.hoisted(() => ({
  mockWorkflowAccess: vi.fn(),
  db: {
    runs: [] as Array<Record<string, unknown>>,
    jobs: [] as Array<Record<string, unknown>>,
    /** A read of the runs by the run rule fails (the link lookups too). */
    runReadsFail: false,
    reads: [] as Array<{ table: string; columns: string }>,
  },
}))

vi.mock("@/lib/app-settings-version.js", () => ({
  appSettingsVersion: async () => null,
  appSettingsChangedSince: async () => false,
  forgetAppSettingsVersion: () => {},
}))
vi.mock("@/lib/supabase.js", () => {
  function project(row: Record<string, unknown>, select: string): Record<string, unknown> {
    if (select.trim() === "*") return { ...row }
    const out: Record<string, unknown> = {}
    for (const raw of select.split(",").map((c) => c.trim()).filter(Boolean)) {
      const alias = /^(\w+):(\w+)->>?(\w+)$/.exec(raw)
      if (alias) {
        const src = row[alias[2]!]
        const v = src && typeof src === "object" ? (src as Record<string, unknown>)[alias[3]!] : undefined
        out[alias[1]!] = v === undefined ? null : v
      } else if (raw in row) {
        out[raw] = row[raw]
      }
    }
    return out
  }
  function table(name: string) {
    const rows = name === "workflow_executions" ? db.runs : name === "jobs" ? db.jobs : []
    const read = { table: name, columns: "" }
    db.reads.push(read)
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const failing = () => name === "workflow_executions" && db.runReadsFail && !read.columns.includes("node_states") && read.columns !== "*"
    const matched = () => rows.filter((row) => filters.every((f) => f(row))).map((row) => project(row, read.columns))
    const chain: Record<string, unknown> = {}
    const proxy: unknown = new Proxy(chain, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => ok(failing() ? { data: null, error: { message: "boom" } } : { data: matched(), error: null })
        if (prop === "single") return async () => (matched()[0] ? { data: matched()[0], error: null } : { data: null, error: { code: "PGRST116", message: "none" } })
        if (prop === "maybeSingle") return async () => (failing() ? { data: null, error: { message: "boom" } } : { data: matched()[0] ?? null, error: null })
        if (prop === "select") return (s: string) => ((read.columns = s), proxy)
        if (prop === "eq") return (col: string, v: unknown) => (filters.push((row) => !(col in row) || row[col] === v), proxy)
        if (prop === "in") return (col: string, vs: unknown[]) => (filters.push((row) => vs.includes(row[col])), proxy)
        if (prop === "is") return (col: string, v: unknown) => (filters.push((row) => (row[col] ?? null) === v), proxy)
        return () => proxy
      },
    })
    return proxy
  }
  return { supabase: { from: (name: string) => table(name) } }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => false,
  hasCredits: () => false,
  isCommunity: () => false,
  isBusiness: () => true,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => null }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))
vi.mock("@/lib/workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workflow-access.js")>()),
  workflowAccess: mockWorkflowAccess,
}))

import { workflowExecutionRoutes } from "../workflow-execution.js"
import { jobRoutes } from "../jobs.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { outerRunStamp } from "../../lib/use-case-outer-run.js"
import { runsWordsReadable } from "../../lib/provider-words-readers.js"
import { USE_CASE_MAX_DEPTH } from "../../lib/use-case/lanes.js"

type Row = Record<string, unknown>

/** The reader of every request: each run and job below is theirs. */
const READER = "00000000-0000-4000-8000-000000000001"
const OWN_WF = "00000000-0000-4000-8000-000000000020"
const SHARED_WF = "00000000-0000-4000-8000-000000000021"
const TEAM_WF = "00000000-0000-4000-8000-000000000022"
/** What the reader may do with each workflow: theirs, a workspace's they belong to, a share link's. */
const ACCESS: Record<string, string> = { [OWN_WF]: "own", [TEAM_WF]: "view", [SHARED_WF]: "none" }
const WORDS = "provider said: the prompt 'a red fox at dawn, in the creator's style' was flagged"

let next = 0
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** A failed run (its node `n1` failed with the words, as job `jobId`), the reader's. */
function run(over: Row): Row {
  next += 1
  const id = uuid(1000 + next)
  return {
    id,
    user_id: READER,
    workflow_id: OWN_WF,
    status: "failed",
    trigger_type: "manual",
    trigger_data: null,
    mcp_client: null,
    node_states: { n1: { status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: uuid(5000 + next) } },
    total_nodes: 1,
    completed_nodes: 0,
    failed_nodes: 1,
    total_credits_used: 0,
    error_message: "Generation failed",
    started_at: "2026-11-11T10:00:00Z",
    completed_at: "2026-11-11T10:01:00Z",
    created_at: "2026-11-11T10:00:00Z",
    updated_at: "2026-11-11T10:01:00Z",
    ...over,
  }
}

/** The failed job of `of`'s node n1. */
function jobOf(of: Row): Row {
  return {
    id: (of.node_states as Record<string, { jobId: string }>).n1!.jobId,
    user_id: READER,
    status: "failed",
    progress: 0,
    job_type: "generate-image",
    input_data: { type: "generate-image", prompt: "a lighthouse" },
    output_data: null,
    error_message: "Generation failed",
    error_detail: WORDS,
    error_hint: null,
    created_at: "2026-11-11T10:00:00Z",
    started_at: "2026-11-11T10:00:01Z",
    completed_at: "2026-11-11T10:00:09Z",
    credits: 10,
    usage_log_id: null,
    workflow_execution_id: of.id,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  db.runs = []
  db.jobs = []
  db.reads = []
  db.runReadsFail = false
  mockWorkflowAccess.mockImplementation(async (_user: string, workflowId: string) => ACCESS[workflowId] ?? "none")
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = READER
    req.userRole = req.headers["x-test-role"] === "admin" ? "admin" : undefined
  })
  await app.register(async (i) => {
    await workflowExecutionRoutes(i)
    await jobRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

/** Whether the run read and the job read of `target` carry the words, for `role`; every run in `runs` is in the table. */
async function bothReads(target: Row, runs: Row[], role = "user"): Promise<{ run: boolean; job: boolean }> {
  db.runs = runs
  db.jobs = [jobOf(target)]
  const headers = { "x-test-role": role }
  const runRes = await app.inject({ method: "GET", url: `/v1/workflow-executions/${target.id}`, headers })
  expect(runRes.statusCode).toBe(200)
  const jobRes = await app.inject({ method: "GET", url: `/v1/jobs/${jobOf(target).id}`, headers })
  expect(jobRes.statusCode).toBe(200)
  const states = runRes.json().data.nodeStates as Record<string, Row>
  const job = jobRes.json().data as Row
  expect(job).not.toHaveProperty("workflow_execution_id")
  return { run: states.n1!.errorDetail === WORDS, job: job.error_detail === WORDS }
}

/** Both reads agree, and say `words`. */
async function expectBoth(target: Row, runs: Row[], words: boolean, role = "user"): Promise<void> {
  expect(await bothReads(target, runs, role)).toEqual({ run: words, job: words })
}

describe("a run of a workflow", () => {
  it("its creator reads the words on both reads", async () => {
    const r = run({ workflow_id: OWN_WF })
    await expectBoth(r, [r], true)
  })

  it("a person who ran someone else's shared workflow reads them on neither", async () => {
    const r = run({ workflow_id: SHARED_WF })
    await expectBoth(r, [r], false)
  })

  it("a workspace member the workflow is shared with reads them on both", async () => {
    const r = run({ workflow_id: TEAM_WF })
    await expectBoth(r, [r], true)
  })

  it("an admin reads them on both", async () => {
    const r = run({ workflow_id: SHARED_WF })
    await expectBoth(r, [r], true, "admin")
  })
})

describe("a standalone use-case job's run (no workflow run started it)", () => {
  it("its owner reads the words on both reads, as before the run rule", async () => {
    const r = run({ workflow_id: null, trigger_type: "use_case" })
    await expectBoth(r, [r], true)
    // Nothing to look up: the run names no workflow and links no run.
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("an inner run recorded with no link (from before any link was recorded) is read as standalone: its owner's", async () => {
    const r = run({ workflow_id: null, trigger_type: "use_case", trigger_data: null })
    await expectBoth(r, [r], true)
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })
})

describe("a lookup that fails withholds the words on both reads", () => {
  it("the access check throws and the runs cannot be read: the creator's own run reads as withheld", async () => {
    mockWorkflowAccess.mockRejectedValue(new Error("boom"))
    db.runReadsFail = true
    const r = run({ workflow_id: OWN_WF })
    await expectBoth(r, [r], false)
  })

  it("only the access check fails: both reads withhold", async () => {
    mockWorkflowAccess.mockRejectedValue(new Error("boom"))
    const r = run({ workflow_id: OWN_WF })
    await expectBoth(r, [r], false)
  })
})

/** A use-case node's inner run (no workflow), linked to `outer` when given. */
function inner(outer?: Row): Row {
  return run({ workflow_id: null, trigger_type: "use_case", trigger_data: outer ? outerRunStamp(outer.id as string) : null })
}

describe("a use-case node's inner run started inside a workflow run (it links that run)", () => {
  it("the outer workflow's creator reads the words on both reads", async () => {
    const outer = run({ workflow_id: OWN_WF })
    const r = inner(outer)
    await expectBoth(r, [outer, r], true)
    expect(mockWorkflowAccess).toHaveBeenCalledWith(READER, OWN_WF)
  })

  it("a person who ran someone else's shared workflow reads them on neither", async () => {
    const outer = run({ workflow_id: SHARED_WF })
    const r = inner(outer)
    await expectBoth(r, [outer, r], false)
  })

  it("a workspace member the outer workflow is shared with reads them on both", async () => {
    const outer = run({ workflow_id: TEAM_WF })
    const r = inner(outer)
    await expectBoth(r, [outer, r], true)
  })

  it("an admin reads them on both, with no lookup", async () => {
    const outer = run({ workflow_id: SHARED_WF })
    const r = inner(outer)
    await expectBoth(r, [outer, r], true, "admin")
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a nested inner run walks up to the nearest run that names a workflow", async () => {
    const shared = run({ workflow_id: SHARED_WF })
    const middle = inner(shared)
    const deepest = inner(middle)
    await expectBoth(deepest, [shared, middle, deepest], false)
    const own = run({ workflow_id: OWN_WF })
    const ownMiddle = inner(own)
    const ownDeepest = inner(ownMiddle)
    await expectBoth(ownDeepest, [own, ownMiddle, ownDeepest], true)
  })

  it("a continuation of an inner run carries the same link, so it reads the same", async () => {
    // A continuation started from outside a run is inserted with the link of the run it continues
    // (routes/use-case-continue.ts); read side, it is an inner run linked to the same outer run.
    const outer = run({ workflow_id: SHARED_WF })
    const first = inner(outer)
    const continued = inner(outer)
    await expectBoth(first, [outer, first, continued], false)
    await expectBoth(continued, [outer, first, continued], false)
  })

  it("a chain that ends at a run with no link (a standalone outer use-case run) is its owner's", async () => {
    const standalone = inner()
    const r = inner(standalone)
    await expectBoth(r, [standalone, r], true)
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })
})

describe("a link that cannot be followed withholds the words on both reads", () => {
  it("the linked run is gone (its workflow deleted, the run with it): even its owner reads them on neither", async () => {
    const r = inner(run({ workflow_id: OWN_WF }))
    await expectBoth(r, [r], false)
  })

  it("the linked run cannot be read (a read that fails)", async () => {
    const outer = run({ workflow_id: OWN_WF })
    const r = inner(outer)
    db.runReadsFail = true
    await expectBoth(r, [outer, r], false)
  })

  it("the linked run is someone else's: never followed", async () => {
    const theirs = run({ workflow_id: OWN_WF, user_id: "00000000-0000-4000-8000-000000000099" })
    const r = inner(theirs)
    await expectBoth(r, [theirs, r], false)
  })

  it(`a chain longer than the nesting limit (${USE_CASE_MAX_DEPTH} links) withholds`, async () => {
    const outer = run({ workflow_id: OWN_WF })
    const chain: Row[] = [outer]
    for (let i = 0; i <= USE_CASE_MAX_DEPTH; i++) chain.push(inner(chain[chain.length - 1]))
    await expectBoth(chain[chain.length - 1]!, chain, false)
    // At the limit it is still followed.
    const within: Row[] = [outer]
    for (let i = 0; i < USE_CASE_MAX_DEPTH; i++) within.push(inner(within[within.length - 1]))
    await expectBoth(within[within.length - 1]!, within, true)
  })

  it("a link on a row of another lane is no link: its owner's, as a run that names no workflow", async () => {
    const outer = run({ workflow_id: SHARED_WF })
    const r = run({ workflow_id: null, trigger_type: "webhook", trigger_data: outerRunStamp(outer.id as string) })
    await expectBoth(r, [outer, r], true)
  })
})

describe("cost: links are followed level by level, one read for every run at that level", () => {
  it("many runs at once: one read of the linked runs per level, one access check per distinct workflow", async () => {
    const shared = run({ workflow_id: SHARED_WF })
    const own = run({ workflow_id: OWN_WF })
    const a = inner(shared)
    const b = inner(shared)
    const c = inner(own)
    const d = inner(a)
    db.runs = [shared, own, a, b, c, d]
    db.reads = []
    const readable = await runsWordsReadable(READER, [a, b, c, d] as never)
    expect([...readable].sort()).toEqual([c.id].sort())
    // Level 1 (a, b, c link shared/own; d links a), level 2 (a's link): two reads in all.
    expect(db.reads.filter((r) => r.table === "workflow_executions").length).toBe(2)
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(2)
  })

  it("no run links one: no read at all", async () => {
    db.reads = []
    const r = run({ workflow_id: OWN_WF })
    await runsWordsReadable(READER, [r as never])
    expect(db.reads.filter((x) => x.table === "workflow_executions")).toEqual([])
  })
})
