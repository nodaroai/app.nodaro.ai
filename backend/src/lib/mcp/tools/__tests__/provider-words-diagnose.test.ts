/**
 * diagnose_run's `providerReason` under the deployment's `jobs.errorDetail`
 * setting (lib/provider-words.ts), and by who reads it. A run's words can
 * quote the prompt of the workflow it executed, so they go only to a reader
 * who can open that workflow (lib/provider-words-readers.ts): its creator, or
 * a collaborator it is shared with — never the person who ran someone else's
 * share link or published app, though the run is theirs.
 *
 * Off (no surface profile): such a reader reads the words, from the job's
 * `error_detail`, else the node state's `errorDetail`. "admin": an MCP session
 * is never an admin reader, so every failure reads as one the provider said
 * nothing about — no `providerReason` key — and no access lookup is made. A
 * single job's words are its owner's: the caller's own job, as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"
import { config } from "../../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))
// The access seam runs its real rule — without the organizations plugin, the
// creator alone, read from `workflows.user_id` — unless a test answers for a
// collaborator the workflow is shared with.
vi.mock("../../../workflow-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../workflow-access.js")>()
  return { ...actual, workflowAccess: vi.fn(actual.workflowAccess) }
})

const { registerDiagnose } = await import("../diagnose.js")
const { supabase } = await import("../../../supabase.js")
const { workflowAccess } = await import("../../../workflow-access.js")
const accessLookup = vi.mocked(workflowAccess)

const JOB_WORDS = "task failed: [400] Request blocked: The uploaded image may contain protected or restricted IP content."
const STATE_WORDS = "task failed: [422] the reference clip is longer than the model accepts."
const SENTENCE = "The video model declined one of your pictures as possibly copyrighted. Try a different picture."

/** The caller's own workflow: they created it. */
const OWN_WORKFLOW = { id: "wf-1", user_id: "u1" }
/** Someone else's workflow: the caller ran it through its share link or published app. */
const THEIR_WORKFLOW = { id: "wf-1", user_id: "creator-2" }

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

/** The deployment keeps the provider's words for its admins. */
function wordsForAdminsOnly(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

/** Every `workflows` read: the columns it selected and its `.eq` filters. */
let workflowReads: Array<{ select: string; eq: Record<string, unknown> }> = []

beforeEach(() => {
  vi.clearAllMocks()
  // Back to the real rule, with no answer left queued by an earlier test.
  accessLookup.mockReset()
  workflowReads = []
  // The same edition in both modes: only the profile differs between them.
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

/**
 * Per table, as diagnose.test.ts: the execution by id, the failed nodes' jobs
 * in one batch (`.in()`), or a single job by id when no execution matches. The
 * run's workflow answers every read whose `.eq` filters it matches: the access
 * read asks by id alone, the resume hint's also by the caller.
 */
function mockSupabase(opts: { execution?: unknown; jobSingle?: unknown; jobsBatch?: unknown[]; workflow?: Record<string, unknown> }): void {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === "projects") {
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q
      q.maybeSingle = () => Promise.resolve({ data: { id: "mcp-project" }, error: null })
      return q
    }
    if (table === "workflows") {
      const read = { select: "", eq: {} as Record<string, unknown> }
      workflowReads.push(read)
      const q: Record<string, unknown> = {}
      q.select = (cols: string) => { read.select = cols; return q }
      q.eq = (col: string, v: unknown) => { read.eq[col] = v; return q }
      for (const m of ["order", "limit"]) q[m] = () => q
      q.maybeSingle = () => {
        const row = opts.workflow
        const found = row !== undefined && Object.entries(read.eq).every(([k, v]) => !(k in row) || row[k] === v)
        return Promise.resolve({ data: found ? row : null, error: null })
      }
      return q
    }
    if (table === "workflow_executions") {
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "not", "order", "limit"]) q[m] = () => q
      q.maybeSingle = () => Promise.resolve({ data: opts.execution ?? null, error: null })
      return q
    }
    if (table === "jobs") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: function isFilter() {
                return { is: isFilter, maybeSingle: () => Promise.resolve({ data: opts.jobSingle ?? null, error: null }) }
              },
            }),
          }),
          in: () => {
            const q = {
              eq: () => q,
              is: () => q,
              then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
                Promise.resolve({ data: opts.jobsBatch ?? [], error: null }).then(res, rej),
            }
            return q
          },
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

async function diagnose(id: string) {
  const server = buildServer()
  registerDiagnose({ server, session: newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" }), fastify: Fastify() })
  const result = await callTool(server, "diagnose_run", { id })
  expect(result.isError).toBeUndefined()
  return { result, out: JSON.parse(result.content[0]?.text ?? "{}") as Record<string, any> }
}

const byNode = (out: Record<string, any>) =>
  Object.fromEntries((out.failures as Array<{ nodeId: string }>).map((f) => [f.nodeId, f])) as Record<string, Record<string, unknown>>

/**
 * A failed run of the workflow `wf-1`, owned by `u1` (the caller): `n1`'s
 * words come from its job's `error_detail`, `n2`'s only from its node state's
 * `errorDetail` (it has no job), and `n3`'s state names a job that carries
 * none, so the state's words are the fallback.
 */
function failedRun(words: boolean, workflow: Record<string, unknown>) {
  return {
    workflow,
    execution: {
      id: "exec1",
      status: "failed",
      workflow_id: "wf-1",
      node_states: {
        n1: { status: "failed", nodeType: "image-to-video", jobId: "job-v", error: "node-level error" },
        n2: { status: "failed", nodeType: "generate-image", error: "boom", ...(words ? { errorDetail: STATE_WORDS } : {}) },
        n3: { status: "failed", nodeType: "generate-image", jobId: "job-i", error: "plain", ...(words ? { errorDetail: STATE_WORDS } : {}) },
      },
      error_message: "Execution failed",
    },
    jobsBatch: [
      { id: "job-v", error_message: SENTENCE, error_detail: words ? JOB_WORDS : null, input_data: { provider: "gemini-omni-flash" }, credits_actual: null },
      { id: "job-i", error_message: "Provider returned status 500", error_detail: null, input_data: { provider: "flux" }, credits_actual: null },
    ],
  }
}

function failedJob(words: string | null) {
  return {
    execution: null,
    jobSingle: {
      id: "job-x",
      status: "failed",
      job_type: "image-to-video",
      user_id: "u1",
      error_message: SENTENCE,
      error_detail: words,
      input_data: { provider: "gemini-omni-flash" },
      output_data: null,
      credits_actual: null,
    },
  }
}

/** The run reads exactly as the same run with no words anywhere: no `providerReason`, no words in the text. */
async function expectNoWords(workflow: Record<string, unknown>): Promise<void> {
  mockSupabase(failedRun(true, workflow))
  const withheld = await diagnose("exec1")
  const nodes = byNode(withheld.out)
  expect(Object.keys(nodes).sort()).toEqual(["n1", "n2", "n3"])
  for (const failure of Object.values(nodes)) expect(failure).not.toHaveProperty("providerReason")
  // The sentence still says what went wrong.
  expect(nodes.n1?.error).toBe(SENTENCE)
  expect(withheld.result.content[0]?.text).not.toContain(JOB_WORDS)
  expect(withheld.result.content[0]?.text).not.toContain(STATE_WORDS)

  mockSupabase(failedRun(false, workflow))
  const none = await diagnose("exec1")
  expect(withheld.out).toEqual(none.out)
}

describe("diagnose_run on a run — providerReason, with the setting off", () => {
  it("the workflow's creator reads the job's words, else the node state's", async () => {
    mockSupabase(failedRun(true, OWN_WORKFLOW))
    const nodes = byNode((await diagnose("exec1")).out)
    expect(nodes.n1?.providerReason).toBe(JOB_WORDS)
    expect(nodes.n2?.providerReason).toBe(STATE_WORDS)
    expect(nodes.n3?.providerReason).toBe(STATE_WORDS)
    // Asked once, of the run's workflow, by the workflow's id alone.
    expect(accessLookup).toHaveBeenCalledTimes(1)
    expect(accessLookup).toHaveBeenCalledWith("u1", "wf-1")
    expect(workflowReads).toContainEqual({ select: "user_id", eq: { id: "wf-1" } })
  })

  it("a person whose run executed someone else's workflow (a share link, a published app) reads none, from the job or from the node state", async () => {
    await expectNoWords(THEIR_WORKFLOW)
    // Asked, and answered by the workflow's creator: not the caller.
    expect(accessLookup).toHaveBeenCalledWith("u1", "wf-1")
    expect(await accessLookup.mock.results[0]?.value).toBe("none")
  })

  it("a collaborator the workflow is shared with (who can open it) reads them", async () => {
    accessLookup.mockResolvedValueOnce("view")
    mockSupabase(failedRun(true, THEIR_WORKFLOW))
    const nodes = byNode((await diagnose("exec1")).out)
    expect(accessLookup).toHaveBeenCalledTimes(1)
    expect(nodes.n1?.providerReason).toBe(JOB_WORDS)
    expect(nodes.n2?.providerReason).toBe(STATE_WORDS)
    expect(nodes.n3?.providerReason).toBe(STATE_WORDS)
  })

  it("a lookup that fails reads as a reader who cannot open the workflow: no words, even for its creator", async () => {
    accessLookup.mockRejectedValueOnce(new Error("connection reset"))
    await expectNoWords(OWN_WORKFLOW)
    expect(accessLookup).toHaveBeenCalledTimes(1)
  })

  it("no access lookup when no failed node has words: no read of the workflow's creator", async () => {
    mockSupabase(failedRun(false, OWN_WORKFLOW))
    const { out } = await diagnose("exec1")
    expect(out.failures).toHaveLength(3)
    expect(accessLookup).not.toHaveBeenCalled()
    // No `workflows` read asks who created it (the access read is by id alone,
    // as the first test shows); the resume hint's is scoped to the caller.
    expect(workflowReads.filter((read) => read.eq.user_id !== "u1")).toEqual([])
  })
})

describe("diagnose_run on a run — providerReason, with the setting at admin", () => {
  it("no failure carries them for the workflow's creator, from the job or from the node state, and no lookup is made", async () => {
    wordsForAdminsOnly()
    await expectNoWords(OWN_WORKFLOW)
    expect(accessLookup).not.toHaveBeenCalled()
  })

  it("nor for a collaborator or a person who ran someone else's workflow", async () => {
    wordsForAdminsOnly()
    await expectNoWords(THEIR_WORKFLOW)
    // A collaborator, were the lookup made: it is not.
    accessLookup.mockResolvedValue("view")
    await expectNoWords(THEIR_WORKFLOW)
    expect(accessLookup).not.toHaveBeenCalled()
  })
})

describe("diagnose_run on a single job — providerReason", () => {
  it("the owner reads the job's words when the setting is off, with no workflow lookup", async () => {
    mockSupabase(failedJob(JOB_WORDS))
    const { out } = await diagnose("job-x")
    expect(out.kind).toBe("job")
    expect(out.failures[0]?.providerReason).toBe(JOB_WORDS)
    expect(accessLookup).not.toHaveBeenCalled()
  })

  it("with the setting at admin the failure carries none", async () => {
    wordsForAdminsOnly()
    mockSupabase(failedJob(JOB_WORDS))
    const withheld = await diagnose("job-x")
    expect(withheld.out.kind).toBe("job")
    expect(withheld.out.failures).toHaveLength(1)
    expect(withheld.out.failures[0]).not.toHaveProperty("providerReason")
    expect(withheld.result.content[0]?.text).not.toContain(JOB_WORDS)

    mockSupabase(failedJob(null))
    const none = await diagnose("job-x")
    expect(withheld.out).toEqual(none.out)
  })
})
