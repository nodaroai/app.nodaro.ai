import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify"

/**
 * A RUN'S JOBS on the REST job reads (lib/provider-words.ts, decided
 * 2026-11-11). A job that belongs to a workflow run (`workflow_execution_id`
 * set) is judged by the run's workflow, as the run reads are: its owner —
 * whoever started the run — reads the provider's words only when they can open
 * that workflow (its creator; a workspace member it is shared with), and an
 * admin always does. A person who ran someone else's shared workflow owns the
 * run's jobs but never reads their words. A job with no run keeps the rule it
 * had: its owner reads them.
 *
 * The relation is looked up only when a row carries words, belongs to a run,
 * the reader is not an admin and the deployment shows words to owners — one
 * read of the runs, then one access lookup per distinct workflow. The run id
 * is read for the rule alone and never answered.
 *
 * The fake tables PROJECT to the columns a read selected and apply its
 * `eq` / `in` / `is` filters, as PostgREST would; `workflowAccess` is watched.
 */

const { mockWorkflowAccess } = vi.hoisted(() => ({ mockWorkflowAccess: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))
vi.mock("@/lib/workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workflow-access.js")>()),
  workflowAccess: mockWorkflowAccess,
}))

import { jobRoutes } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

type Row = Record<string, unknown>
type Role = "user" | "admin"

/** The reader of every request: each job and run below is theirs. */
const READER = "00000000-0000-4000-8000-000000000001"
const CREATOR = "00000000-0000-4000-8000-000000000003"
const OWN_WF = "00000000-0000-4000-8000-000000000020"
const SHARED_WF = "00000000-0000-4000-8000-000000000021"
const TEAM_WF = "00000000-0000-4000-8000-000000000022"
const OTHER_SHARED_WF = "00000000-0000-4000-8000-000000000023"
const RUN_OWN = "00000000-0000-4000-8000-000000000030"
const RUN_SHARED = "00000000-0000-4000-8000-000000000031"
const RUN_TEAM = "00000000-0000-4000-8000-000000000032"
const RUN_SHARED_2 = "00000000-0000-4000-8000-000000000033"
const RUN_OTHER_SHARED = "00000000-0000-4000-8000-000000000034"
/** The inner run a use-case node starts: it names no workflow. */
const RUN_USE_CASE = "00000000-0000-4000-8000-000000000035"
/** Each run is the reader's (a run's jobs are its owner's); its workflow is whose. */
const RUNS: Row[] = [
  { id: RUN_OWN, user_id: READER, workflow_id: OWN_WF },
  { id: RUN_SHARED, user_id: READER, workflow_id: SHARED_WF },
  { id: RUN_TEAM, user_id: READER, workflow_id: TEAM_WF },
  { id: RUN_SHARED_2, user_id: READER, workflow_id: SHARED_WF },
  { id: RUN_OTHER_SHARED, user_id: READER, workflow_id: OTHER_SHARED_WF },
  { id: RUN_USE_CASE, user_id: READER, workflow_id: null },
]
/** What the reader may do with each workflow: own theirs, view the team's (a workspace it is shared in), nothing on a share link's. */
const ACCESS: Record<string, string> = { [OWN_WF]: "own", [TEAM_WF]: "view", [SHARED_WF]: "none", [OTHER_SHARED_WF]: "none" }

const WORDS = "task failed: [400] the prompt 'a red fox at dawn, in the creator's style' was flagged"

let nextJob = 0
/** A failed job of the reader's: of `run`, or with no run (null). */
function failed(run: string | null, over: Row = {}): Row {
  nextJob += 1
  return {
    id: `00000000-0000-4000-8000-${String(100 + nextJob).padStart(12, "0")}`,
    user_id: READER,
    status: "failed",
    progress: 0,
    job_type: "generate-image",
    input_data: { type: "generate-image", prompt: "a lighthouse" },
    output_data: null,
    error_message: "The image model declined the prompt. Try different wording.",
    error_detail: WORDS,
    error_hint: null,
    created_at: "2026-11-11T10:00:00Z",
    started_at: "2026-11-11T10:00:01Z",
    completed_at: "2026-11-11T10:00:09Z",
    credits: 40,
    provider: "kie",
    provider_cost: 0.04,
    display_cost: 0.05,
    credits_actual: null,
    reconcile_attempts: 0,
    source: null,
    source_detail: null,
    session_id: null,
    usage_log_id: null,
    workflow_execution_id: run,
    ...over,
  }
}

function setProfile(profile: unknown): void {
  if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

function project(row: Row, select: string): Row {
  const out: Row = {}
  for (const raw of select.split(",").map((c) => c.trim()).filter(Boolean)) {
    const alias = /^(\w+):(\w+)->>?(\w+)$/.exec(raw)
    if (alias) {
      const src = row[alias[2]!]
      const v = src && typeof src === "object" ? (src as Row)[alias[3]!] : undefined
      out[alias[1]!] = v === undefined ? null : v
    } else if (raw in row) {
      out[raw] = row[raw]
    }
  }
  return out
}

/** Reads made, by table; and whether the runs table fails. */
const reads: Record<string, number> = {}
let runsFail = false

/** A table holding `rows`: a chain that records its select and applies eq / in / is. */
function table(name: string, rows: Row[]): unknown {
  reads[name] = (reads[name] ?? 0) + 1
  let select = ""
  const filters: Array<(row: Row) => boolean> = []
  const result = () => {
    if (name === "workflow_executions" && runsFail) return { data: null, error: { message: "boom" } }
    return { data: rows.filter((row) => filters.every((f) => f(row))).map((row) => project(row, select)), error: null }
  }
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(result())
      if (prop === "single" || prop === "maybeSingle") {
        return () => {
          const r = result()
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: "none" }) })
        }
      }
      if (prop === "select") return (s: string) => { select = s; return proxy }
      if (prop === "eq") return (col: string, v: unknown) => { filters.push((row) => !(col in row) || row[col] === v); return proxy }
      if (prop === "in") return (col: string, vs: unknown[]) => { filters.push((row) => vs.includes(row[col])); return proxy }
      if (prop === "is") return (col: string, v: unknown) => { filters.push((row) => (row[col] ?? null) === v); return proxy }
      return () => proxy
    },
  })
  return proxy
}

function seed(jobs: Row[]): void {
  vi.mocked(supabase.from).mockImplementation((name: string) => {
    if (name === "jobs") return table(name, jobs) as never
    if (name === "workflow_executions") return table(name, RUNS) as never
    if (name === "usage_logs") return table(name, []) as never
    throw new Error(`unexpected table ${name}`)
  })
}

let app: FastifyInstance

interface Surface {
  name: string
  ask: (ids: string[], headers: Record<string, string>) => Promise<LightMyRequestResponse>
  /** The answered jobs, in the order asked. */
  pick: (body: { data?: unknown; jobs?: unknown }, ids: string[]) => Row[]
  /** Whether one request reads several jobs. */
  many: boolean
}
const byIds = (rows: unknown, ids: string[]): Row[] => ids.map((id) => (rows as Row[]).find((r) => r.id === id)!).filter(Boolean)
const SURFACES: Surface[] = [
  { name: "GET /v1/jobs/:id", many: false, ask: ([id], headers) => app.inject({ method: "GET", url: `/v1/jobs/${id}`, headers }), pick: (b) => [b.data as Row] },
  { name: "GET /v1/jobs/:id/status", many: false, ask: ([id], headers) => app.inject({ method: "GET", url: `/v1/jobs/${id}/status`, headers }), pick: (b) => [b.data as Row] },
  { name: "GET /v1/jobs/status?ids=", many: true, ask: (ids, headers) => app.inject({ method: "GET", url: `/v1/jobs/status?ids=${ids.join(",")}`, headers }), pick: (b, ids) => byIds(b.jobs, ids) },
  { name: "POST /v1/jobs/batch-status", many: true, ask: (ids, headers) => app.inject({ method: "POST", url: "/v1/jobs/batch-status", headers, payload: { jobIds: ids } }), pick: (b, ids) => byIds(b.data, ids) },
  { name: "GET /v1/jobs (list)", many: true, ask: (_ids, headers) => app.inject({ method: "GET", url: "/v1/jobs", headers }), pick: (b, ids) => byIds(b.data, ids) },
]

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(async () => {
  vi.clearAllMocks()
  for (const key of Object.keys(reads)) delete reads[key]
  runsFail = false
  mockWorkflowAccess.mockImplementation(async (_user: string, workflowId: string) => ACCESS[workflowId] ?? "none")
  config.EDITION = "business"
  setProfile(undefined)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = READER
    req.userRole = req.headers["x-test-role"] === "admin" ? "admin" : undefined
  })
  await app.register(async (i) => { await jobRoutes(i) })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

describe.each(SURFACES)("$name", (surface) => {
  /** The jobs as `role` reads them, the jobs table holding exactly `jobs`. */
  async function read(jobs: Row[], role: Role = "user"): Promise<Row[]> {
    seed(jobs)
    for (const key of Object.keys(reads)) delete reads[key]
    mockWorkflowAccess.mockClear()
    const ids = jobs.map((j) => String(j.id))
    const res = await surface.ask(ids, { "x-test-role": role })
    expect(res.statusCode).toBe(200)
    const out = surface.pick(res.json(), ids)
    expect(out).toHaveLength(jobs.length)
    return out
  }
  /** The same job with no run: what every read answered before the rule, key for key. */
  const withoutRun = (job: Row): Row => ({ ...job, workflow_execution_id: null })

  it("the creator reads the words on a run of their own workflow, the answer byte for byte a job's with no run", async () => {
    const job = failed(RUN_OWN)
    const [shown] = await read([job])
    expect(shown!.error_detail).toBe(WORDS)
    expect(reads.workflow_executions).toBe(1)
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(1)
    expect(shown).not.toHaveProperty("workflow_execution_id")
    const [single] = await read([withoutRun(job)])
    expect(shown).toStrictEqual(single)
  })

  it("a person who ran someone else's shared workflow reads the run's job without them: error_detail null, every other key as the creator's", async () => {
    const job = failed(RUN_SHARED)
    const [withheld] = await read([job])
    expect(withheld).toHaveProperty("error_detail", null)
    expect(JSON.stringify(withheld)).not.toContain("red fox")
    expect(withheld).not.toHaveProperty("workflow_execution_id")
    const [single] = await read([withoutRun(job)])
    expect(withheld).toStrictEqual({ ...single, error_detail: null })
  })

  it("a workspace member the workflow is shared with reads them, as the creator does", async () => {
    const [shown] = await read([failed(RUN_TEAM)])
    expect(shown!.error_detail).toBe(WORDS)
    expect(mockWorkflowAccess).toHaveBeenCalledWith(READER, TEAM_WF)
  })

  it("an admin reads them on any run's job, with no lookup", async () => {
    const [shown] = await read([failed(RUN_SHARED)], "admin")
    expect(shown!.error_detail).toBe(WORDS)
    expect(shown).not.toHaveProperty("workflow_execution_id")
    expect(reads.workflow_executions).toBeUndefined()
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a job with no run is its owner's, with no lookup", async () => {
    const [shown] = await read([failed(null)])
    expect(shown!.error_detail).toBe(WORDS)
    expect(reads.workflow_executions).toBeUndefined()
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a run that names no workflow (a use-case node's inner run) is judged as a job with no run: its owner reads them", async () => {
    const [shown] = await read([failed(RUN_USE_CASE)])
    expect(shown!.error_detail).toBe(WORDS)
    expect(reads.workflow_executions).toBe(1)
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a run's job with no words, or on a deployment that keeps the words for admins, looks nothing up", async () => {
    await read([failed(RUN_SHARED, { error_detail: null })])
    expect(reads.workflow_executions).toBeUndefined()
    setProfile({ jobs: { errorDetail: "admin" } })
    const [withheld] = await read([failed(RUN_OWN)])
    expect(withheld).toHaveProperty("error_detail", null)
    expect(reads.workflow_executions).toBeUndefined()
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a run that cannot be read withholds the words", async () => {
    runsFail = true
    const [withheld] = await read([failed(RUN_OWN)])
    expect(withheld).toHaveProperty("error_detail", null)
  })

  if (surface.many) {
    it("many jobs: one read of their runs, one lookup per distinct workflow, each job judged by its own run", async () => {
      const jobs = [failed(RUN_SHARED), failed(RUN_SHARED_2), failed(RUN_OWN), failed(RUN_OTHER_SHARED), failed(null), failed(RUN_TEAM, { error_detail: null })]
      const out = await read(jobs)
      expect(out.map((j) => j.error_detail)).toEqual([null, null, WORDS, null, WORDS, null])
      expect(reads.workflow_executions).toBe(1)
      // SHARED_WF (two runs), OWN_WF, OTHER_SHARED_WF; the team run carries no words.
      expect(mockWorkflowAccess).toHaveBeenCalledTimes(3)
      for (const job of out) expect(job).not.toHaveProperty("workflow_execution_id")
    })
  }
})
