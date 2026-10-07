/**
 * A run with nothing new ends COMPLETED, not failed — REAL orchestrator path.
 *
 * Two Telegram feeds that found no posts → Combine Text → Generate Text →
 * Text to Speech. Before 2026-10-05 the writer sent `userInput: ""`, the route
 * answered 400 and the whole run was marked failed. The rule
 * (`empty-input-skips.ts` + the generalized gate) skips the writer and the
 * speech behind it with `skipReason: "empty_input"`, the run completes with
 * every node accounted for, and nothing downstream is ever dispatched.
 *
 * Harness mirrors trigger-run-scope-orchestrator.test.ts (leaf I/O only).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  let feedText: Record<string, string> = {}
  const executeNode = vi.fn(async (node: { id: string; type: string }) => {
    executeNodeCalls.push(node.id)
    if (node.type === "telegram-channel-feed") {
      const text = feedText[node.id] ?? ""
      return { output: { text, generatedText: text, count: text ? 1 : 0 }, creditsUsed: 0 }
    }
    if (node.type === "combine-text") {
      const joined = Object.values(feedText).filter((t) => t.length > 0).join("\n\n---\n\n")
      return { output: { text: joined }, creditsUsed: 0 }
    }
    if (node.type === "llm-chat") return { output: { text: "An article." }, creditsUsed: 0 }
    return { output: { audioUrl: "https://x.mp3" }, creditsUsed: 0 }
  })

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const executionUpdates: Array<Record<string, unknown>> = []

  let workflowRow: Record<string, unknown> | null = null
  const execSelectRow = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn((patch: Record<string, unknown>) => {
        if (table === "workflow_executions") executionUpdates.push(patch)
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => makeChain(table, columns).select(columns),
    update: (patch: Record<string, unknown>) => makeChain(table).update(patch),
    insert: () => makeChain(table).insert(),
  }))

  return {
    executeNode,
    executeNodeCalls,
    updateExecutionWithRetry,
    executionUpdates,
    from,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
    setFeedText: (texts: Record<string, string>) => {
      feedText = texts
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
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
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

function makeJob(): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "feed1", type: "telegram-channel-feed", data: { label: "Tech", channel: "technews", limit: 5 } },
      { id: "feed2", type: "telegram-channel-feed", data: { label: "World", channel: "worldnews", limit: 5 } },
      { id: "combine", type: "combine-text", data: { label: "All posts", separator: "\n\n---\n\n" } },
      { id: "llm", type: "llm-chat", data: { label: "Writer", systemPrompt: "Write news." } },
      { id: "tts", type: "text-to-speech", data: { label: "Voice", provider: "elevenlabs-v3" } },
    ],
    edges: [
      { id: "e1", source: "feed1", target: "combine", sourceHandle: "text", targetHandle: "text" },
      { id: "e2", source: "feed2", target: "combine", sourceHandle: "text", targetHandle: "text" },
      { id: "e3", source: "combine", target: "llm", sourceHandle: "text", targetHandle: "prompt" },
      { id: "e4", source: "llm", target: "tts", sourceHandle: "text", targetHandle: "prompt" },
    ],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

type Terminal = { status?: string; node_states?: Record<string, { status: string; skipReason?: string }>; completed_nodes?: number; total_nodes?: number; error_message?: string }

/** The terminal write (status completed or failed), from either write path. */
function terminalWrite(): Terminal | undefined {
  const retried = mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Terminal)
  const all = [...retried, ...(mocks.executionUpdates as Terminal[])]
  return all.find((u) => u?.status === "completed" || u?.status === "failed")
}

const dispatched = () => [...mocks.executeNodeCalls].sort()

describe("orchestrator — a run with nothing new ends completed, with the starved nodes skipped", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeCalls.length = 0
    mocks.executionUpdates.length = 0
  })

  it("no new posts: the writer and the speech behind it are skipped for want of input, nothing fails, every node is accounted for", async () => {
    mocks.setFeedText({ feed1: "", feed2: "" })
    await processWorkflowExecution(makeJob())
    expect(dispatched()).toEqual(["combine", "feed1", "feed2"])
    const end = terminalWrite()
    expect(end?.status).toBe("completed")
    expect(end?.error_message ?? null).toBeNull()
    expect(end?.node_states?.llm).toMatchObject({ status: "skipped", skipReason: "empty_input" })
    expect(end?.node_states?.tts).toMatchObject({ status: "skipped", skipReason: "empty_input" })
    expect(end?.node_states?.combine?.status).toBe("completed")
    expect(end?.completed_nodes).toBe(end?.total_nodes)
  })

  it("one feed with news: the writer runs and the speech follows", async () => {
    mocks.setFeedText({ feed1: "", feed2: "Big launch today" })
    await processWorkflowExecution(makeJob())
    expect(dispatched()).toEqual(["combine", "feed1", "feed2", "llm", "tts"])
    const end = terminalWrite()
    expect(end?.status).toBe("completed")
    expect(end?.node_states?.llm?.status).toBe("completed")
    expect(end?.node_states?.tts?.status).toBe("completed")
  })
})
