/**
 * A RUN'S JOBS on the MCP job reads (lib/provider-words.ts, decided
 * 2026-11-11): get_job, wait_for_job, list_jobs (scope mine), get_asset and
 * diagnose_run on a job id. A job that belongs to a workflow run is judged by
 * the run's workflow: the session's user — who started the run — reads its
 * provider words only when they can open that workflow. A person who ran
 * someone else's shared workflow does not; the workflow's creator and a
 * workspace member it is shared with do; a job with no run is its owner's, as
 * before. (An MCP session is never an admin reader; the REST reads cover the
 * admin.) The lookup is made only for a run's job that carries words.
 *
 * get_asset also answers someone else's public job without their user id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, type ToolCallResult } from "./_helpers.js"
import { config } from "../../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const { mockWorkflowAccess } = vi.hoisted(() => ({ mockWorkflowAccess: vi.fn() }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../workflow-access.js")>()),
  workflowAccess: mockWorkflowAccess,
}))
vi.mock("../../../gallery-moderation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gallery-moderation.js")>()
  return { ...actual, loadGalleryModeration: async () => actual.OWNER_VIEW_MODERATION }
})
vi.mock("../../../job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))
vi.mock("../../../job-run-steps.js", () => ({ runStepsOf: async () => ({ steps: new Map(), incomplete: new Set<string>() }) }))
vi.mock("../../../concurrency-lanes/queue-info.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../concurrency-lanes/queue-info.js")>()),
  queueInfoFor: async () => new Map(),
}))
// wait_for_job's loop: the job has ended (its row is read afterwards).
vi.mock("../_wait-for-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_wait-for-job.js")>()),
  waitForJob: async () => ({ status: "failed", jobType: "generate-image", error: "failed", outputUrl: null, outputData: null, errorHint: null }),
}))

const { registerJobs } = await import("../jobs.js")
const { registerGallery } = await import("../gallery.js")
const { registerDiagnose } = await import("../diagnose.js")
const { supabase } = await import("../../../supabase.js")

type Row = Record<string, unknown>

const READER = "00000000-0000-4000-8000-000000000001"
const CREATOR = "00000000-0000-4000-8000-000000000003"
const OWN_WF = "00000000-0000-4000-8000-000000000020"
const SHARED_WF = "00000000-0000-4000-8000-000000000021"
const TEAM_WF = "00000000-0000-4000-8000-000000000022"
const RUN_OWN = "00000000-0000-4000-8000-000000000030"
const RUN_SHARED = "00000000-0000-4000-8000-000000000031"
const RUN_TEAM = "00000000-0000-4000-8000-000000000032"
const RUNS: Row[] = [
  { id: RUN_OWN, user_id: READER, workflow_id: OWN_WF },
  { id: RUN_SHARED, user_id: READER, workflow_id: SHARED_WF },
  { id: RUN_TEAM, user_id: READER, workflow_id: TEAM_WF },
]
const ACCESS: Record<string, string> = { [OWN_WF]: "own", [TEAM_WF]: "view", [SHARED_WF]: "none" }
const WORDS = "task failed: [400] the prompt 'a red fox at dawn, in the creator's style' was flagged"

let nextJob = 0
function failed(run: string | null, over: Row = {}): Row {
  nextJob += 1
  return {
    id: `11111111-1111-4111-8111-${String(nextJob).padStart(12, "0")}`,
    user_id: READER,
    status: "failed",
    progress: 0,
    job_type: "generate-image",
    input_data: { type: "generate-image", provider: "nano-banana", prompt: "a cat" },
    output_data: null,
    error_message: "The image model declined the prompt. Try different wording.",
    error_detail: WORDS,
    error_hint: null,
    created_at: "2026-11-11T10:00:00Z",
    started_at: "2026-11-11T10:00:01Z",
    completed_at: "2026-11-11T10:00:20Z",
    credits: 12,
    credits_actual: null,
    usage_log_id: null,
    workflow_execution_id: run,
    ...over,
  }
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

/** The run rule's reads of the runs (`id, workflow_id`) — diagnose_run's own read of a run by its id is not one. */
const reads: Record<string, number> = {}

/** A table holding `rows`: records its select and applies eq / in / is (a column the row lacks passes). */
function table(name: string, rows: Row[]): unknown {
  let select = ""
  const filters: Array<(row: Row) => boolean> = []
  const matched = () => rows.filter((row) => filters.every((f) => f(row))).map((row) => project(row, select))
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res({ data: matched(), error: null })
      if (prop === "maybeSingle") return () => Promise.resolve({ data: matched()[0] ?? null, error: null })
      if (prop === "single") return () => Promise.resolve(matched()[0] ? { data: matched()[0], error: null } : { data: null, error: { message: "none" } })
      if (prop === "select") {
        return (s: string) => {
          select = s
          if (name === "workflow_executions" && s === "id, workflow_id") reads[name] = (reads[name] ?? 0) + 1
          return proxy
        }
      }
      if (prop === "eq") return (col: string, v: unknown) => { filters.push((row) => !(col in row) || row[col] === v); return proxy }
      if (prop === "neq") return (col: string, v: unknown) => { filters.push((row) => !(col in row) || row[col] !== v); return proxy }
      if (prop === "in") return (col: string, vs: unknown[]) => { filters.push((row) => vs.includes(row[col])); return proxy }
      if (prop === "is") return (col: string, v: unknown) => { filters.push((row) => (row[col] ?? null) === v); return proxy }
      return () => proxy
    },
  })
  return proxy
}

function seed(jobs: Row[]): void {
  for (const key of Object.keys(reads)) delete reads[key]
  mockWorkflowAccess.mockClear()
  vi.mocked(supabase.from).mockImplementation((name: string) => {
    if (name === "jobs") return table(name, jobs) as never
    if (name === "workflow_executions") return table(name, RUNS) as never
    return table(name, []) as never
  })
}

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(() => {
  vi.clearAllMocks()
  mockWorkflowAccess.mockImplementation(async (_user: string, workflowId: string) => ACCESS[workflowId] ?? "none")
  config.EDITION = "business"
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

afterEach(() => {
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

function server() {
  const session = () => newSession({ userId: READER, scopes: ["jobs:read", "assets:read"] as Scope[], clientName: "Claude" })
  const s = buildServer()
  registerJobs({ server: s, session: session(), fastify: Fastify() })
  registerGallery({ server: s, session: session(), fastify: Fastify() })
  registerDiagnose({ server: s, session: session() } as Parameters<typeof registerDiagnose>[0])
  return s
}

const textOf = (r: ToolCallResult): string => (r.content as Array<{ text: string }>)[0]!.text

/** Each job read: what the session reads of one job — its words as served, and every text it answered. */
interface Read { words: unknown; text: string }
const READS: Array<{ name: string; read: (job: Row) => Promise<Read> }> = [
  {
    name: "get_job",
    read: async (job) => {
      const r = await callTool(server(), "get_job", { job_id: job.id })
      const data = (JSON.parse(textOf(r)) as { data: Row }).data
      expect(data).not.toHaveProperty("workflow_execution_id")
      expect((r.structuredContent as Row).errorDetail).toBe(data.error_detail)
      return { words: data.error_detail, text: textOf(r) + JSON.stringify(r.structuredContent) }
    },
  },
  {
    name: "wait_for_job",
    read: async (job) => {
      const r = await callTool(server(), "wait_for_job", { job_id: job.id, timeout_s: 1 })
      return { words: (r.structuredContent as Row).errorDetail, text: textOf(r) + JSON.stringify(r.structuredContent) }
    },
  },
  {
    name: "list_jobs (mine)",
    read: async (job) => {
      const r = await callTool(server(), "list_jobs", { types: ["generate-image"] })
      const [row] = (JSON.parse(textOf(r)) as { data: Row[] }).data
      expect(row).not.toHaveProperty("workflow_execution_id")
      return { words: row!.error_detail, text: textOf(r) }
    },
  },
  {
    name: "get_asset",
    read: async (job) => {
      const r = await callTool(server(), "get_asset", { job_id: job.id })
      return { words: (r.structuredContent as Row).errorDetail, text: textOf(r) + JSON.stringify(r.structuredContent) }
    },
  },
  {
    name: "diagnose_run (a job id)",
    read: async (job) => {
      const r = await callTool(server(), "diagnose_run", { id: job.id })
      const body = JSON.parse(textOf(r)) as { kind: string; failures: Array<{ providerReason?: string }> }
      expect(body.kind).toBe("job")
      return { words: body.failures[0]?.providerReason ?? null, text: textOf(r) }
    },
  },
]

describe.each(READS)("$name", ({ read }) => {
  it("the workflow's creator reads the words on a run of their own workflow", async () => {
    const job = failed(RUN_OWN)
    seed([job])
    expect((await read(job)).words).toBe(WORDS)
    expect(reads.workflow_executions).toBe(1)
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(1)
  })

  it("a person who ran someone else's shared workflow never reads them", async () => {
    const job = failed(RUN_SHARED)
    seed([job])
    const got = await read(job)
    expect(got.words ?? null).toBeNull()
    expect(got.text).not.toContain("red fox")
  })

  it("a workspace member the workflow is shared with reads them", async () => {
    const job = failed(RUN_TEAM)
    seed([job])
    expect((await read(job)).words).toBe(WORDS)
  })

  it("a job with no run is its owner's, with no lookup", async () => {
    const job = failed(null)
    seed([job])
    expect((await read(job)).words).toBe(WORDS)
    expect(reads.workflow_executions ?? 0).toBe(0)
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a run's job with no words looks nothing up", async () => {
    const job = failed(RUN_SHARED, { error_detail: null })
    seed([job])
    await read(job)
    expect(reads.workflow_executions ?? 0).toBe(0)
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })
})

describe("get_asset: whose id it answers", () => {
  it("someone else's public job answers without their user id; your own keeps yours", async () => {
    const theirs = failed(null, { user_id: CREATOR, status: "completed", error_detail: null, output_data: { imageUrl: "https://cdn.example/a.png" } })
    seed([theirs])
    const other = JSON.parse(textOf(await callTool(server(), "get_asset", { job_id: theirs.id }))) as { data: Row }
    expect(other.data).not.toHaveProperty("user_id")
    expect(other.data.id).toBe(theirs.id)
    expect(JSON.stringify(other)).not.toContain(CREATOR)

    const mine = failed(RUN_OWN, { status: "completed", error_detail: null, output_data: { imageUrl: "https://cdn.example/b.png" } })
    seed([mine])
    const own = JSON.parse(textOf(await callTool(server(), "get_asset", { job_id: mine.id }))) as { data: Row }
    expect(own.data.user_id).toBe(READER)
    expect(own.data).not.toHaveProperty("workflow_execution_id")
  })
})
