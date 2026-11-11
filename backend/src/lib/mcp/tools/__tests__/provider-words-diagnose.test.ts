/**
 * diagnose_run's `providerReason` under the deployment's `jobs.errorDetail`
 * setting (lib/provider-words.ts). Off (no surface profile): the provider's
 * words ride each failure, from the job's `error_detail`, else the node
 * state's `errorDetail`. "admin": an MCP session is never an admin reader, so
 * every failure reads as one the provider said nothing about — no
 * `providerReason` key, whichever of the two the words came from.
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

const { registerDiagnose } = await import("../diagnose.js")
const { supabase } = await import("../../../supabase.js")

const JOB_WORDS = "task failed: [400] Request blocked: The uploaded image may contain protected or restricted IP content."
const STATE_WORDS = "task failed: [422] the reference clip is longer than the model accepts."
const SENTENCE = "The video model declined one of your pictures as possibly copyrighted. Try a different picture."

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

/** The deployment keeps the provider's words for its admins. */
function wordsForAdminsOnly(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
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
 * in one batch (`.in()`), or a single job by id when no execution matches.
 */
function mockSupabase(opts: { execution?: unknown; jobSingle?: unknown; jobsBatch?: unknown[] }): void {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === "projects" || table === "workflows") {
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q
      q.maybeSingle = () => Promise.resolve({ data: table === "projects" ? { id: "mcp-project" } : null, error: null })
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
 * A failed run: `n1`'s words come from its job's `error_detail`, `n2`'s only
 * from its node state's `errorDetail` (it has no job), and `n3`'s state names a
 * job that carries none, so the state's words are the fallback.
 */
function failedRun(words: boolean) {
  return {
    execution: {
      id: "exec1",
      status: "failed",
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

describe("diagnose_run on a run — providerReason", () => {
  it("the owner reads the job's words, else the node state's, when the setting is off", async () => {
    mockSupabase(failedRun(true))
    const nodes = byNode((await diagnose("exec1")).out)
    expect(nodes.n1?.providerReason).toBe(JOB_WORDS)
    expect(nodes.n2?.providerReason).toBe(STATE_WORDS)
    expect(nodes.n3?.providerReason).toBe(STATE_WORDS)
  })

  it("with the setting at admin no failure carries them, from the job or from the node state", async () => {
    wordsForAdminsOnly()
    mockSupabase(failedRun(true))
    const withheld = await diagnose("exec1")
    const nodes = byNode(withheld.out)
    expect(Object.keys(nodes).sort()).toEqual(["n1", "n2", "n3"])
    for (const failure of Object.values(nodes)) expect(failure).not.toHaveProperty("providerReason")
    expect(withheld.result.content[0]?.text).not.toContain(JOB_WORDS)
    expect(withheld.result.content[0]?.text).not.toContain(STATE_WORDS)

    // Exactly the answer for the same run with no words anywhere.
    mockSupabase(failedRun(false))
    const none = await diagnose("exec1")
    expect(withheld.out).toEqual(none.out)
  })
})

describe("diagnose_run on a single job — providerReason", () => {
  it("the owner reads the job's words when the setting is off", async () => {
    mockSupabase(failedJob(JOB_WORDS))
    const { out } = await diagnose("job-x")
    expect(out.kind).toBe("job")
    expect(out.failures[0]?.providerReason).toBe(JOB_WORDS)
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
