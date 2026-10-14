/**
 * The photo influence set's guard (lib/__tests__/ugc-photo-sentinel-cases.ts) on a run by anyone
 * but the author — a share link's viewer, and a published app's runner (its snapshot read again as
 * published at pickup) — through the REAL orchestrator and the REAL sub-workflow runner, which
 * descends into every sub-workflow by its own recursion. For every case, with the runner's own
 * photo given as the run's input: (a) no `KILL` reaches the graph any node is dispatched with, at
 * any depth, nor the inputs it resolves; (b) no creator's request body carries `KILL`; (c) every
 * `KEEP` of the workflow reaches the run.
 *
 * Only leaf I/O is mocked (the harness of share-link-viewer-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { OrchestratorContext, SimpleNode, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNode = vi.fn(async (node: { id: string; type?: string }, inputs: unknown, _edges: unknown, _nodes: unknown, _states: unknown, ctx: unknown) => {
    // A sub-workflow node runs as the node executor runs it: the real sub-workflow runner.
    if (node.type === "sub-workflow") {
      const { executeSubWorkflow } = await import("../../services/workflow-engine/sub-workflow-handler.js")
      const result = await executeSubWorkflow(node as never, inputs as never, ctx as never, 0, new Set(), [])
      return { output: result.output, creditsUsed: result.creditsUsed }
    }
    return { output: { text: `${node.id} done` }, creditsUsed: 1 }
  })
  const workflows = new Map<string, Record<string, unknown>>()
  const apps = new Map<string, Record<string, unknown>>()
  const execSelectRow = { status: "queued", node_states: {} as Record<string, unknown> }
  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }
  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))
  return { executeNode, from, workflows, apps, execSelectRow }
})

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({ cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }) }))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 }) }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { ugcCreatorBody } from "@nodaro/shared/ugc"
import { processWorkflowExecution } from "../orchestrator-worker.js"
import { CONTROL_CASES, KEEP, KILL, SENTINEL_CASES, marked, type SentinelCase } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const RUNNER = "00000000-0000-4000-8000-0000000000c3"

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.workflows.clear()
  mocks.apps.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
})

/** The case as the author left it, their other workflows beside it; run by someone else, with the runner's own photo. */
async function run(c: SentinelCase, as: "viewer" | "app") {
  mocks.workflows.set("wf-1", { nodes: c.graph.nodes, edges: c.graph.edges, settings: c.settings, user_id: AUTHOR })
  for (const [id, graph] of Object.entries(c.workflows)) mocks.workflows.set(id, graph as never)
  // A published snapshot as the author's graph was: the run reads it as published at pickup.
  mocks.apps.set("app-1", { snapshot_nodes: c.graph.nodes, snapshot_edges: c.graph.edges, snapshot_settings: c.settings, creator_id: AUTHOR, publish_type: "app" })
  const job = as === "viewer" ? { shareLinkViewer: true } : { appVersionId: "app-1", triggerType: "app_run" }
  await processWorkflowExecution({
    data: { executionId: "exec-1", workflowId: "wf-1", triggerType: "manual", reviewerPresent: false, userId: RUNNER, inputOverrides: c.runnerGives ?? {}, ...job },
  } as unknown as Job<WorkflowExecutionJob>)
  return mocks.executeNode.mock.calls.map((call) => ({
    node: call[0] as unknown as SimpleNode,
    inputs: call[1] as { ugc?: { photo?: string } },
    graph: call[3] as unknown as SimpleNode[],
    ctx: call[5] as unknown as OrchestratorContext,
  }))
}

describe.each([
  ["a share link's viewer", "viewer"],
  ["a published app's runner", "app"],
] as const)("%s", (_who, as) => {
  it.each([...SENTINEL_CASES, ...CONTROL_CASES].map((c) => [c.name, c] as const))("%s: (a) no KILL in any graph or input a node is dispatched with; (b) nor in a creator's request; (c) every KEEP runs", async (_name, c) => {
    const dispatched = await run(c, as)
    expect(dispatched.length, "nodes were dispatched").toBeGreaterThan(0)
    for (const { node, inputs, graph } of dispatched) {
      expect(JSON.stringify(graph), `the graph ${node.id} ran in`).not.toContain(KILL)
      expect(JSON.stringify(inputs), `what ${node.id} was handed`).not.toContain(KILL)
      expect(JSON.stringify(node), node.id).not.toContain(KILL)
      if (node.type === "ugc-creator") {
        const body = ugcCreatorBody({ data: node.data as never, photoUrl: inputs.ugc?.photo })
        expect(JSON.stringify(body), `${node.id}'s request`).not.toContain(KILL)
      }
    }
    // The run's own graph: the one its top-level nodes are dispatched with.
    const top = dispatched.find(({ graph }) => graph.some((n) => n.id === "lone"))
    expect(top, "the run's own graph was dispatched").toBeDefined()
    for (const keep of marked(c, KEEP)) expect(JSON.stringify(top!.graph), keep).toContain(keep)
  })
})

describe("the run descends by its own recursion", () => {
  it("a node two sub-workflows down is dispatched, with the graph it sits in, emptied by its part of the run's set", async () => {
    const c = SENTINEL_CASES.find((x) => x.name === "two sub-workflows down and back up")!
    const dispatched = await run(c, "viewer")
    const mix = dispatched.find(({ node }) => node.id === "mix")
    expect(mix, "the node two levels down ran").toBeDefined()
    expect(mix!.graph.map((n) => n.id).sort()).toEqual(["in", "mix", "out", "own"])
    expect(mix!.ctx.ugcStripSet?.photo.get(JSON.stringify(["s1", "s2"]))).toEqual(new Set(["in", "mix", "out", "own"]))
  })
})
