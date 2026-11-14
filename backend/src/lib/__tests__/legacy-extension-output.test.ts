// @test-units-by-name reads the node types it names (extend-video, video-upscale, generate-video)
/**
 * An Extend or Upscale Video node saved before its own run's output task was
 * recorded apart (`outputKieTaskId`) may hold that OUTPUT in `kieTaskId` — a
 * server run overwrote the task it worked on with it. Wired to no source that
 * fits (always so for an MCP-built node), the graph alone cannot tell it from
 * the node's input. The database can: the saved task is the provider task of
 * a completed job of this node's own type, made by this node in a run of THIS
 * workflow, for the user running it, whose own input was another task. Then
 * the run reads the node as recorded apart — its output handed on, its input
 * the job's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

/** Every call the lookup makes on the supabase chain, and what the read answers. */
const db = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
}))
vi.mock("../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "in", "eq", "is"]) {
    chain[m] = (...args: unknown[]) => {
      db.calls.push([m, args])
      return chain
    }
  }
  chain.limit = async (...args: unknown[]) => {
    db.calls.push(["limit", args])
    return { data: db.rows, error: db.error }
  }
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(["from", [table]])
        return chain
      },
    },
  }
})

import { fetchLegacyOutputJobs, withLegacyExtensionOutputs, type LegacyOutputJob } from "../legacy-extension-output.js"

const USER = "user-a"
const WORKFLOW = "wf-1"
const SCOPE = { userId: USER, workflowId: WORKFLOW }

type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }

const extension = (data: Record<string, unknown> = {}, id = "x"): Node => ({ id, type: "extend-video", data: { provider: "veo-extend", prompt: "keep going", ...data } })
const job = (over: Partial<LegacyOutputJob> = {}): LegacyOutputJob => ({
  userId: USER,
  status: "completed",
  jobType: "extend-video",
  taskId: "task-ext-own",
  nodeId: "x",
  workflowId: WORKFLOW,
  inputTask: "task-gen",
  deletedAt: null,
  ...over,
})
const fetching = (rows: readonly LegacyOutputJob[]) => vi.fn(async () => rows)

beforeEach(() => {
  db.calls = []
  db.rows = []
  db.error = null
})

describe("an extension saved before outputs were recorded apart", () => {
  it("a saved kieTaskId that is its own completed extension's task: recorded as its output, and its input is that job's", async () => {
    const legacy = extension({ kieTaskId: "task-ext-own" })
    const nodes = [legacy]
    const fetchJobs = fetching([job()])
    const out = await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs })
    expect(fetchJobs).toHaveBeenCalledWith(SCOPE, ["task-ext-own"])
    expect(out[0]!.data).toEqual({ provider: "veo-extend", prompt: "keep going", kieTaskId: "task-gen", outputKieTaskId: "task-ext-own" })
    // Never mutated: a copy.
    expect(legacy.data.kieTaskId).toBe("task-ext-own")
    expect(out).not.toBe(nodes)
  })

  it("a node of the same id in ANOTHER workflow made that job: never matched (node ids are unique only within a workflow)", async () => {
    // Workflow B's unwired `extend-video-1` holds T1 to continue workflow A's extension T1, which A's `extend-video-1` made.
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    for (const other of [job({ workflowId: "wf-other" }), job({ workflowId: null })]) {
      expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([other]) })).toBe(nodes)
    }
    // A run with no workflow (an inline graph) asks nothing.
    const fetchJobs = fetching([job()])
    expect(await withLegacyExtensionOutputs(nodes, [], { userId: USER, workflowId: undefined }, { fetchJobs })).toBe(nodes)
    expect(fetchJobs).not.toHaveBeenCalled()
  })

  it("one that ran again since (its newest output recorded apart) keeps that output and runs on its input, not its older output", async () => {
    // A server run after outputs were recorded apart wrote `outputKieTaskId` and left the old output in `kieTaskId`.
    const synced = extension({ kieTaskId: "task-ext-own", outputKieTaskId: "task-ext-newest" })
    const out = await withLegacyExtensionOutputs([synced], [], SCOPE, { fetchJobs: fetching([job()]) })
    expect(out[0]!.data).toEqual({ provider: "veo-extend", prompt: "keep going", kieTaskId: "task-gen", outputKieTaskId: "task-ext-newest" })
    // The same shape holding a generation's task (its real input) is unchanged.
    const input = [extension({ kieTaskId: "task-gen", outputKieTaskId: "task-ext-newest" })]
    expect(await withLegacyExtensionOutputs(input, [], SCOPE, { fetchJobs: fetching([job({ taskId: "task-gen", jobType: "generate-video", nodeId: "g", inputTask: null })]) })).toBe(input)
  })

  it("a node that deliberately continues from its own output (kieTaskId = outputKieTaskId) is never asked about", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own", outputKieTaskId: "task-ext-own" })]
    const fetchJobs = fetching([job()])
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs })).toBe(nodes)
    expect(fetchJobs).not.toHaveBeenCalled()
  })

  it("a saved kieTaskId that is a GENERATION's task (an input) is unchanged", async () => {
    const nodes = [extension({ kieTaskId: "task-gen" })]
    const out = await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([job({ taskId: "task-gen", jobType: "generate-video", inputTask: null })]) })
    expect(out).toBe(nodes)
  })

  it("an input task some VEO upscale ran on (its provider task IS its input) is unchanged", async () => {
    const nodes = [extension({ kieTaskId: "task-gen" })]
    const upscaled = job({ taskId: "task-gen", jobType: "video-upscale", inputTask: "task-gen", nodeId: "u" })
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([upscaled]) })).toBe(nodes)
    // Not even on an upscale node of that name: a job whose provider task is its own input made no output.
    const upscale: Node = { id: "u", type: "video-upscale", data: { provider: "veo-1080p", kieTaskId: "task-gen" } }
    expect(await withLegacyExtensionOutputs([upscale], [], SCOPE, { fetchJobs: fetching([upscaled]) })).toEqual([upscale])
  })

  it("another node's extension (an MCP call continuing an extension by its task) is that node's input, unchanged", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    for (const other of [job({ nodeId: "someone-else" }), job({ nodeId: null })]) {
      expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([other]) })).toBe(nodes)
    }
  })

  it("never on a job that is not this user's, not completed, in the Trash, or of another node type", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    for (const row of [job({ userId: "user-b" }), job({ status: "failed" }), job({ deletedAt: "2026-11-01T00:00:00Z" }), job({ jobType: "video-upscale" })]) {
      expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([row]) }), JSON.stringify(row)).toBe(nodes)
    }
  })

  it("jobs that disagree on the input leave the node as stored", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: fetching([job(), job({ inputTask: "task-other" })]) })).toBe(nodes)
  })

  it("an extension job that recorded no input task: its output is recorded, and it holds no input (refused at build, never run on its own output)", async () => {
    const out = await withLegacyExtensionOutputs([extension({ kieTaskId: "task-ext-own" })], [], SCOPE, { fetchJobs: fetching([job({ inputTask: null })]) })
    expect(out[0]!.data).toEqual({ provider: "veo-extend", prompt: "keep going", outputKieTaskId: "task-ext-own" })
  })

  it("asks nothing for a node the graph already reads: one wired to a source that fits, one with no task", async () => {
    const fetchJobs = fetching([job()])
    const gen: Node = { id: "g", type: "generate-video", data: { provider: "veo3.1", kieTaskId: "task-gen" } }
    const wire: Edge = { id: "g->x", source: "g", target: "x", sourceHandle: "video", targetHandle: "video" }
    const graphs: Array<[Node[], Edge[]]> = [
      [[gen, extension({ kieTaskId: "task-ext-own" })], [wire]],
      [[extension({})], []],
      [[gen], []],
    ]
    for (const [nodes, edges] of graphs) {
      expect(await withLegacyExtensionOutputs(nodes, edges, SCOPE, { fetchJobs })).toBe(nodes)
    }
    expect(fetchJobs).not.toHaveBeenCalled()
    // A source that does NOT fit (another model's clip) leaves the node a candidate.
    const kling: Node = { id: "g", type: "generate-video", data: { provider: "kling-3.0", kieTaskId: "task-kling" } }
    await withLegacyExtensionOutputs([kling, extension({ kieTaskId: "task-ext-own" })], [wire], SCOPE, { fetchJobs })
    expect(fetchJobs).toHaveBeenCalledTimes(1)
  })

  it("a lookup that fails, or a user that is not known, leaves the graph as stored", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    const failing = vi.fn(async () => { throw new Error("db down") })
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs: failing })).toBe(nodes)
    const fetchJobs = fetching([job()])
    expect(await withLegacyExtensionOutputs(nodes, [], { userId: "", workflowId: WORKFLOW }, { fetchJobs })).toBe(nodes)
    expect(fetchJobs).not.toHaveBeenCalled()
  })

  it("asks once, for a bounded number of tasks", async () => {
    const nodes = Array.from({ length: 80 }, (_, i) => extension({ kieTaskId: `task-${i}` }, `x${i}`))
    const fetchJobs = fetching([])
    await withLegacyExtensionOutputs(nodes, [], SCOPE, { fetchJobs })
    expect(fetchJobs).toHaveBeenCalledTimes(1)
    const asked = (fetchJobs.mock.calls[0] as unknown as [unknown, string[]])[1]
    expect(asked.length).toBeLessThanOrEqual(50)
  })
})

describe("the database read itself (fetchLegacyOutputJobs)", () => {
  /** A row as PostgREST answers the select. */
  const row = (over: Record<string, unknown> = {}) => ({
    user_id: USER, status: "completed", job_type: "extend-video", provider_task_id: "task-ext-own", deleted_at: null,
    node_id: "x", input_task: "task-gen", execution: { workflow_id: WORKFLOW }, ...over,
  })

  it("filters on the owner, completion, the task consumer types, the Trash and THIS workflow's runs, in the query, before its limit", async () => {
    db.rows = [row()]
    const jobs = await fetchLegacyOutputJobs(SCOPE, ["task-ext-own", "task-2"])
    expect(db.calls[0]).toEqual(["from", ["jobs"]])
    const select = String((db.calls.find(([m]) => m === "select")![1] as unknown[])[0])
    // The workflow a job's run belongs to, through the keyed embed (jobs ⇄ workflow_executions has two keys).
    expect(select).toContain("execution:workflow_executions!workflow_execution_id!inner(workflow_id)")
    expect(select).toContain("node_id:input_data->>node_id")
    expect(select).toContain("input_task:input_data->>kieTaskId")
    const filters = db.calls.filter(([m]) => m !== "from" && m !== "select" && m !== "limit")
    expect(filters).toEqual(expect.arrayContaining([
      ["in", ["provider_task_id", ["task-ext-own", "task-2"]]],
      ["eq", ["user_id", USER]],
      ["eq", ["status", "completed"]],
      ["in", ["job_type", ["extend-video", "video-upscale"]]],
      ["is", ["deleted_at", null]],
      ["eq", ["execution.workflow_id", WORKFLOW]],
    ]))
    expect(db.calls.at(-1)).toEqual(["limit", [200]])
    expect(jobs).toEqual([{ userId: USER, status: "completed", jobType: "extend-video", taskId: "task-ext-own", nodeId: "x", workflowId: WORKFLOW, inputTask: "task-gen", deletedAt: null }])
  })

  it("the rows it answers are checked again in code: another workflow's row is never matched", async () => {
    db.rows = [row({ execution: { workflow_id: "wf-other" } })]
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE)).toBe(nodes)
    db.rows = [row()]
    expect((await withLegacyExtensionOutputs(nodes, [], SCOPE))[0]!.data.kieTaskId).toBe("task-gen")
  })

  it("a read that reaches its row cap, or fails, leaves the graph as stored", async () => {
    const nodes = [extension({ kieTaskId: "task-ext-own" })]
    db.rows = Array.from({ length: 200 }, () => row())
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE)).toBe(nodes)
    db.rows = [row()]
    db.error = { message: "timeout" }
    expect(await withLegacyExtensionOutputs(nodes, [], SCOPE)).toBe(nodes)
  })
})
