/**
 * L2#5 — Tier parallelism cap, and the width a run dispatches at.
 *
 * `getParallelismLimit(tier)` in `orchestrator-worker.ts` decides "how many
 * node jobs can this user's workflow fan out concurrently within one execution
 * level" while concurrency lanes are not enforced. The contract:
 *
 *   - Cloud edition (`hasCredits()` true): `min(TIER_PARALLELISM[tier], env ceiling)`
 *   - Self-hosted (`hasCredits()` false): env ceiling, ignoring tier
 *   - Unknown tier: falls back to "free" tier's limit
 *
 * `dispatchWidth` is what a run actually uses: that limit (or a deployment
 * payer's grade) while lanes are not enforced, and `ORCHESTRATOR_DISPATCH_WIDTH`
 * once they are — the user's lanes then do the limiting, and a list fan-out
 * inside a level shares the one width instead of nesting a second limiter.
 *
 * Drift here causes resource over-fanout (overload Redis/BullMQ) or
 * starvation (paying users get free-tier parallelism).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../lib/concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import type { WakeTarget } from "../../lib/concurrency-lanes/gate.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only (the harness of llm-unpriced-preflight-orchestrator).
// ---------------------------------------------------------------------------

/** Settable per test: the edition, the profile's tier, and the dispatch width. */
const state = vi.hoisted(() => ({
  hasCredits: true,
  tier: "free",
  dispatchWidth: undefined as number | undefined,
  /** `workflow_executions.status` as a fresh control read (checkExecutionControl) finds it. */
  executionStatus: "running",
}))

const mocks = vi.hoisted(() => {
  let executeNodeImpl: (node: { id: string; type: string }, ...rest: unknown[]) => Promise<unknown> = async () => ({ output: { text: "x" }, creditsUsed: 0 })
  const executeNode = vi.fn(async (node: { id: string; type: string }, ...rest: unknown[]) => executeNodeImpl(node, ...rest))
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const executionUpdates: Array<Record<string, unknown>> = []
  let workflowRow: Record<string, unknown> | null = null
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const resolve = () => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: refs.tier() }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      if (table === "workflow_executions" && columns === "status") return { data: { status: refs.executionStatus() }, error: null }
      return { data: null, error: null }
    }
    const self = {
      eq: () => self,
      is: () => self,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }
  const refs = { tier: () => "free", executionStatus: () => "running" }
  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: (patch: Record<string, unknown>) => {
      if (table === "workflow_executions") executionUpdates.push(patch)
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  return {
    executeNode,
    updateExecutionWithRetry,
    executionUpdates,
    from,
    refs,
    setExecuteNode: (fn: typeof executeNodeImpl) => { executeNodeImpl = fn },
    setWorkflowRow: (row: Record<string, unknown>) => { workflowRow = row },
  }
})
mocks.refs.tier = () => state.tier
mocks.refs.executionStatus = () => state.executionStatus

vi.mock("@/lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")
  const config = Object.create(actual.config, {
    ORCHESTRATOR_DISPATCH_WIDTH: { get: () => state.dispatchWidth ?? actual.config.ORCHESTRATOR_DISPATCH_WIDTH },
  }) as typeof actual.config
  return {
    ...actual,
    config,
    hasCredits: () => state.hasCredits,
    isCloud: () => state.hasCredits,
    isCommunity: () => !state.hasCredits,
  }
})
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
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
vi.mock("@/ee/billing/credits.js", () => ({ unpricedMeteredLlmOfRun: () => null }))

// An inline use-case graph whose every node tries every one of its kind (a
// tries-every level): only the case that needs it sets `inline.graph`.
const inline = vi.hoisted(() => ({ graph: null as null | { nodes: unknown[]; edges: unknown[] } }))
vi.mock("@/lib/execution-inline-graph.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/execution-inline-graph.js")>("@/lib/execution-inline-graph.js")
  return { ...actual, loadInlineGraph: async () => (inline.graph ? { ...inline.graph, hash: "h" } : null) }
})
vi.mock("@nodaro/render-rules", async () => {
  const actual = await vi.importActual<typeof import("@nodaro/render-rules")>("@nodaro/render-rules")
  return {
    ...actual,
    usecaseTriesEvery: (g: { nodes: Array<{ id: string; type: string }> }) =>
      new Set(g.nodes.filter((n) => n.type !== "upload-video").map((n) => n.id)),
  }
})

// The gate's JS twin stands in for Redis: `lanesEnforced()` reads its flag, and
// a node call under the run's hold takes a slot of the user's provider lane.
const lanes = vi.hoisted(() => ({
  gate: null as unknown,
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
}))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => lanes.gate }))
vi.mock("@/lib/concurrency-lanes/sizes.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/concurrency-lanes/sizes.js")>("@/lib/concurrency-lanes/sizes.js")
  const { defaultLaneSizesForTier } = await import("@/lib/concurrency-lanes/defaults.js")
  return {
    ...actual,
    laneSizesFor: async (subject: { tier: string | null }) => defaultLaneSizesForTier(subject.tier ?? "free"),
    laneSettings: async () => ({ queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 }),
  }
})
vi.mock("@/lib/concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (_queues: string[], onWake: (targets: WakeTarget[]) => Promise<void>) => {
    lanes.onWake = onWake
    return () => {}
  },
}))

import { dispatchWidth, getParallelismLimit, processWorkflowExecution } from "../orchestrator-worker.js"
import { TIER_PARALLELISM } from "../../ee/billing/stripe-config.js"
import { config } from "../../lib/config.js"
import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { runHolding, type ConcurrencyHold } from "../../lib/concurrency-lanes/hold.js"
import { resetConcurrencySlotsForTests, withConcurrencySlot } from "../../lib/concurrency-lanes/slot.js"

const ENV_CEILING = config.MAX_CONCURRENT_NODES_PER_EXECUTION

let gate: ConcurrencyGate

beforeEach(async () => {
  state.hasCredits = true
  state.tier = "free"
  state.dispatchWidth = undefined
  state.executionStatus = "running"
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  lanes.gate = gate
  lanes.onWake = null
  resetConcurrencySlotsForTests()
  mocks.executeNode.mockClear()
  mocks.updateExecutionWithRetry.mockClear()
  mocks.executionUpdates.length = 0
  inline.graph = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Test 1 — TIER_PARALLELISM shape and monotonicity invariants.
// ---------------------------------------------------------------------------

describe("TIER_PARALLELISM constants", () => {
  it("includes all five known tiers", () => {
    expect(TIER_PARALLELISM.free).toBeDefined()
    expect(TIER_PARALLELISM.basic).toBeDefined()
    expect(TIER_PARALLELISM.standard).toBeDefined()
    expect(TIER_PARALLELISM.pro).toBeDefined()
    expect(TIER_PARALLELISM.business).toBeDefined()
  })

  it("each tier limit is a positive integer", () => {
    for (const [tier, limit] of Object.entries(TIER_PARALLELISM)) {
      expect(limit, `${tier} parallelism must be ≥ 1`).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(limit), `${tier} parallelism must be an integer`).toBe(true)
    }
  })

  it("higher tiers grant ≥ parallelism than lower tiers (monotonic)", () => {
    expect(TIER_PARALLELISM.basic).toBeGreaterThanOrEqual(TIER_PARALLELISM.free)
    expect(TIER_PARALLELISM.standard).toBeGreaterThanOrEqual(TIER_PARALLELISM.basic)
    expect(TIER_PARALLELISM.pro).toBeGreaterThanOrEqual(TIER_PARALLELISM.standard)
    expect(TIER_PARALLELISM.business).toBeGreaterThanOrEqual(TIER_PARALLELISM.pro)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — Cloud edition: limit = min(tier, ceiling).
// ---------------------------------------------------------------------------

describe("getParallelismLimit — cloud edition", () => {
  it.each(Object.keys(TIER_PARALLELISM))(
    'tier "%s" returns min(TIER_PARALLELISM, ENV_CEILING)',
    (tier) => {
      const expected = Math.min(TIER_PARALLELISM[tier], ENV_CEILING)
      expect(getParallelismLimit(tier)).toBe(expected)
    },
  )

  it("unknown tier defaults to free", () => {
    const expected = Math.min(TIER_PARALLELISM.free, ENV_CEILING)
    expect(getParallelismLimit("ULTRA_PREMIUM_DOES_NOT_EXIST")).toBe(expected)
  })

  it("undefined tier defaults to free", () => {
    const expected = Math.min(TIER_PARALLELISM.free, ENV_CEILING)
    expect(getParallelismLimit(undefined)).toBe(expected)
  })

  it("never exceeds the env ceiling for any tier (even hypothetical Infinity)", () => {
    for (const tier of Object.keys(TIER_PARALLELISM)) {
      expect(getParallelismLimit(tier)).toBeLessThanOrEqual(ENV_CEILING)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3 — Self-hosted: limit = env ceiling, tier ignored entirely.
// ---------------------------------------------------------------------------

describe("getParallelismLimit — self-hosted edition", () => {
  beforeEach(() => {
    state.hasCredits = false
  })

  it("returns the env ceiling regardless of tier", () => {
    expect(getParallelismLimit("free")).toBe(ENV_CEILING)
    expect(getParallelismLimit("business")).toBe(ENV_CEILING)
    expect(getParallelismLimit(undefined)).toBe(ENV_CEILING)
    expect(getParallelismLimit("nonexistent-tier")).toBe(ENV_CEILING)
  })
})

// ---------------------------------------------------------------------------
// Test 4 — dispatchWidth: today's limit while lanes are off, the engine's
// safety valve once they are on.
// ---------------------------------------------------------------------------

const personal = { payer: "user" as const, userId: "owner-1" }
const deployment = {
  payer: "deployment" as const,
  userId: "owner-1",
  payerId: "payer-1",
  entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "standard" },
}

describe("dispatchWidth", () => {
  it("with enforcement off changes nothing: every tier gets getParallelismLimit", async () => {
    for (const tier of Object.keys(TIER_PARALLELISM)) {
      expect(await dispatchWidth({ tier, billingContext: personal })).toBe(getParallelismLimit(tier))
    }
    expect(await dispatchWidth({ tier: undefined, billingContext: personal })).toBe(getParallelismLimit(undefined))
  })

  it("with enforcement off a deployment payer keeps its grade, clipped by the env ceiling", async () => {
    expect(await dispatchWidth({ tier: "free", billingContext: deployment })).toBe(Math.min(4, ENV_CEILING))
    const big = { ...deployment, entitlements: { ...deployment.entitlements, parallelism: 40 } }
    expect(await dispatchWidth({ tier: "free", billingContext: big })).toBe(ENV_CEILING)
  })

  it("with enforcement off a self-hosted run keeps the env ceiling", async () => {
    state.hasCredits = false
    expect(await dispatchWidth({ tier: "free", billingContext: personal })).toBe(ENV_CEILING)
  })

  it("with enforcement on every run dispatches ORCHESTRATOR_DISPATCH_WIDTH, whatever the tier or payer", async () => {
    await gate.setEnforced(true)
    expect(await dispatchWidth({ tier: "free", billingContext: personal })).toBe(50)
    expect(await dispatchWidth({ tier: "business", billingContext: personal })).toBe(50)
    expect(await dispatchWidth({ tier: "free", billingContext: deployment })).toBe(50)
    state.hasCredits = false
    expect(await dispatchWidth({ tier: "free", billingContext: personal })).toBe(50)
  })

  it("a gate that cannot be read counts as off (today's limit)", async () => {
    vi.spyOn(gate, "isEnforced").mockRejectedValue(new Error("redis down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await dispatchWidth({ tier: "free", billingContext: personal })).toBe(getParallelismLimit("free"))
  })
})

// ---------------------------------------------------------------------------
// Test 5 — the REAL orchestrator: how many nodes one run has in flight.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function imageNodes(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `img${i + 1}`, type: "generate-image", data: { prompt: `a cat ${i + 1}` } }))
}

function runJob(nodes: unknown[], edges: unknown[] = []): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({ nodes, edges, settings: {}, user_id: "owner-1" })
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: "owner-1", triggerType: "manual" },
  } as unknown as Job<WorkflowExecutionJob>
}

/** Every node call takes 20 ms; returns the peak number in flight at once. */
function trackInFlight(output: (node: { id: string; type: string }) => unknown = () => ({ output: { imageUrl: "https://cdn/x.png" }, creditsUsed: 0 })) {
  const seen = { now: 0, peak: 0, calls: 0 }
  mocks.setExecuteNode(async (node) => {
    seen.calls++
    seen.now++
    seen.peak = Math.max(seen.peak, seen.now)
    try {
      await sleep(20)
      return output(node)
    } finally {
      seen.now--
    }
  })
  return seen
}

const terminalStatus = () => {
  const all = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as { status?: string }), ...(mocks.executionUpdates as Array<{ status?: string }>)]
  return all.find((u) => u?.status === "completed" || u?.status === "failed")?.status
}

describe("orchestrator — nodes one run dispatches at once", () => {
  it("with enforcement off a free run dispatches 2 at once as today", async () => {
    state.tier = "free"
    const seen = trackInFlight()
    await processWorkflowExecution(runJob(imageNodes(6)))
    expect(seen.calls).toBe(6)
    expect(seen.peak).toBe(Math.min(TIER_PARALLELISM.free, ENV_CEILING))
    expect(seen.peak).toBe(2)
    expect(terminalStatus()).toBe("completed")
  })

  it("with enforcement off pro dispatches 6 as today", async () => {
    state.tier = "pro"
    const seen = trackInFlight()
    await processWorkflowExecution(runJob(imageNodes(10)))
    expect(seen.calls).toBe(10)
    expect(seen.peak).toBe(6)
    expect(terminalStatus()).toBe("completed")
  })

  it("with enforcement on a free run with 6 independent image nodes dispatches all 6 and the lane admits 2", async () => {
    await gate.setEnforced(true)
    state.tier = "free"
    // A released slot wakes its waiters at once (the wake message), not after the 5-s re-check.
    const release = gate.release.bind(gate)
    vi.spyOn(gate, "release").mockImplementation(async (leaseId, outcome) => {
      const wakes = await release(leaseId, outcome)
      await lanes.onWake?.(wakes)
      return wakes
    })
    const runHold: ConcurrencyHold = { role: "run", lane: "run", userId: "owner-1", payer: "user:owner-1", tier: "free", jobId: "exec-1", leaseId: null }
    const dispatched = { now: 0, peak: 0 }
    const admitted = { now: 0, peak: 0, total: 0 }
    const waited = new Set<string>()
    mocks.setExecuteNode(async (node) => {
      dispatched.now++
      dispatched.peak = Math.max(dispatched.peak, dispatched.now)
      try {
        return await runHolding(runHold, () =>
          withConcurrencySlot(
            { lane: "provider", provider: "kie", jobType: "generate-image", onWaiting: () => { waited.add(node.id) } },
            async () => {
              admitted.now++
              admitted.total++
              admitted.peak = Math.max(admitted.peak, admitted.now)
              try {
                await sleep(20)
                return { output: { imageUrl: `https://cdn/${node.id}.png` }, creditsUsed: 0 }
              } finally {
                admitted.now--
              }
            },
          ))
      } finally {
        dispatched.now--
      }
    })

    await processWorkflowExecution(runJob(imageNodes(6)))

    expect(dispatched.peak).toBe(6)
    expect(admitted.peak).toBe(2)
    expect(waited.size).toBe(4)
    expect(admitted.total).toBe(6)
    expect(terminalStatus()).toBe("completed")
  })

  // Upload → two Splits (5 parts each) and one plain Trim (the first level);
  // then two Trims over each part (the second level: 5 + 5 node calls).
  const PARTS = Array.from({ length: 5 }, (_, i) => `https://cdn/part-${i}.mp4`)
  const LIST_NODES = [
    { id: "up", type: "upload-video", data: { label: "Upload Video", url: "https://cdn/src.mp4" } },
    { id: "split1", type: "split-media", data: { label: "Split 1", chunkDuration: 10, minPartDuration: 4 } },
    { id: "split2", type: "split-media", data: { label: "Split 2", chunkDuration: 10, minPartDuration: 4 } },
    { id: "trim1", type: "trim-video", data: { label: "Trim 1", startTime: 0, endTime: 0, fieldMappings: {}, trimMode: "keep-first-seconds", keepFirstSeconds: 2 } },
    { id: "trim2", type: "trim-video", data: { label: "Trim 2", startTime: 0, endTime: 0, fieldMappings: {}, trimMode: "keep-first-seconds", keepFirstSeconds: 2 } },
    { id: "trim3", type: "trim-video", data: { label: "Trim 3", startTime: 0, endTime: 0, fieldMappings: {}, trimMode: "keep-first-seconds", keepFirstSeconds: 2 } },
  ]
  const LIST_EDGES = [
    { id: "e1", source: "up", target: "split1", sourceHandle: "video", targetHandle: "video" },
    { id: "e2", source: "up", target: "split2", sourceHandle: "video", targetHandle: "video" },
    { id: "e3", source: "split1", target: "trim1", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
    { id: "e4", source: "split2", target: "trim2", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
    { id: "e5", source: "up", target: "trim3", sourceHandle: "video", targetHandle: "in" },
  ]
  const listOutput = (node: { type: string }) => node.type === "split-media"
    ? { output: { videoUrl: PARTS[0], videoUrls: PARTS }, creditsUsed: 0 }
    : { output: { videoUrl: "https://cdn/trimmed.mp4" }, creditsUsed: 0 }

  it("a list fan-out inside a level does not multiply the width", async () => {
    await gate.setEnforced(true)
    state.dispatchWidth = 3
    const seen = trackInFlight(listOutput)
    await processWorkflowExecution(runJob(LIST_NODES, LIST_EDGES))
    expect(seen.calls).toBe(3 + 10)
    expect(seen.peak).toBe(3)
    expect(terminalStatus()).toBe("completed")
  })

  it("with enforcement on an item that waited for a slot does not start once its fan-out failed", async () => {
    await gate.setEnforced(true)
    state.dispatchWidth = 2
    // Second level: a plain Trim (holds a slot for 50 ms) and a fan-out whose items fail at once.
    // The fan-out's first item takes the other slot; its second waits for one and, once the
    // first has failed, must not start (fail-fast, as for an item never started).
    const calls: string[] = []
    mocks.setExecuteNode(async (node) => {
      calls.push(node.id)
      if (node.type === "split-media") return { output: { videoUrl: PARTS[0], videoUrls: PARTS }, creditsUsed: 0 }
      if (node.id === "trimEach") throw new Error("provider refused")
      await sleep(50)
      return { output: { videoUrl: "https://cdn/trimmed.mp4" }, creditsUsed: 0 }
    })
    await processWorkflowExecution(runJob(
      [
        LIST_NODES[0],
        LIST_NODES[1],
        { ...LIST_NODES[5], id: "trimPlain" },
        { ...LIST_NODES[3], id: "trimEach" },
      ],
      [
        LIST_EDGES[0],
        { id: "p", source: "split1", target: "trimPlain", sourceHandle: "video", targetHandle: "in" },
        { id: "q", source: "split1", target: "trimEach", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
      ],
    ))
    expect(calls).toEqual(["split1", "trimPlain", "trimEach"])
    expect(calls.filter((id) => id === "trimEach")).toHaveLength(1)
    const writes = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as { status?: string; error_message?: string }), ...(mocks.executionUpdates as Array<{ status?: string; error_message?: string }>)]
    expect(writes.find((u) => u.status === "failed")?.error_message).toBe("Node execution failed: trimEach: provider refused")
  })

  it("with enforcement on a tries-every node a Stop held back while it waited for a slot is skipped, not failed", async () => {
    await gate.setEnforced(true)
    state.dispatchWidth = 2
    // Second level, every node tries every one of its kind: a fan-out over 5 parts and two
    // plain Trims, two level workers. Trim A and the fan-out's first item take the two slots;
    // the fan-out's second item waits. Trim A ends at once: its slot goes to that item, and its
    // level worker starts Trim B, which passes its start check (no Stop yet) and waits for a
    // slot. Then the fan-out's first item sees a Stop (its poll sets ctx.cancelled) and ends:
    // its slot goes to Trim B, which a Stop held back — skipped, never run, never failed.
    const calls: string[] = []
    mocks.setExecuteNode(async (node, ...rest: unknown[]) => {
      calls.push(node.id)
      if (node.type === "split-media") return { output: { videoUrl: PARTS[0], videoUrls: PARTS }, creditsUsed: 0 }
      await sleep(node.id === "trimEach" ? 30 : 5)
      if (node.id === "trimEach") (rest[4] as { cancelled: boolean }).cancelled = true
      return { output: { videoUrl: "https://cdn/trimmed.mp4" }, creditsUsed: 0 }
    })
    inline.graph = {
      nodes: [
        LIST_NODES[0],
        LIST_NODES[1],
        { ...LIST_NODES[3], id: "trimEach" },
        { ...LIST_NODES[5], id: "trimA" },
        { ...LIST_NODES[5], id: "trimB" },
      ],
      edges: [
        LIST_EDGES[0],
        { id: "q", source: "split1", target: "trimEach", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
        { id: "a", source: "split1", target: "trimA", sourceHandle: "video", targetHandle: "in" },
        { id: "b", source: "split1", target: "trimB", sourceHandle: "video", targetHandle: "in" },
      ],
    }
    const job = runJob([], [])
    ;(job.data as unknown as Record<string, unknown>).inlineGraph = true
    await processWorkflowExecution(job)
    const ran = calls.filter((id) => id !== "split1")
    expect(ran).toContain("trimA")
    expect(ran).toContain("trimEach")
    expect(ran).not.toContain("trimB")
    const writes = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Record<string, unknown>), ...(mocks.executionUpdates as Array<Record<string, unknown>>)]
    const last = [...writes].reverse().find((u) => u.node_states !== undefined)?.node_states as Record<string, { status: string }>
    expect(last.trimB.status).toBe("skipped")
    expect(writes.some((u) => u.status === "failed")).toBe(false)
  })

  // The tries-every stage of the case above, with the Stop arriving in the
  // DATABASE while Trim B waits for its slot (a user's Stop, not a poll that
  // already saw it): Trim B passed its start check before the Stop, so only a
  // fresh read once it holds the slot keeps it from starting a paid step.
  it("with enforcement on a tries-every node asks for a Stop again, fresh, once it holds its slot", async () => {
    await gate.setEnforced(true)
    state.dispatchWidth = 2
    const calls: string[] = []
    mocks.setExecuteNode(async (node) => {
      calls.push(node.id)
      if (node.type === "split-media") return { output: { videoUrl: PARTS[0], videoUrls: PARTS }, creditsUsed: 0 }
      await sleep(node.id === "trimEach" ? 30 : 5)
      // The user's Stop lands while Trim B waits for the slot this item holds.
      if (node.id === "trimEach") state.executionStatus = "cancelled"
      return { output: { videoUrl: "https://cdn/trimmed.mp4" }, creditsUsed: 0 }
    })
    inline.graph = {
      nodes: [
        LIST_NODES[0],
        LIST_NODES[1],
        { ...LIST_NODES[3], id: "trimEach" },
        { ...LIST_NODES[5], id: "trimA" },
        { ...LIST_NODES[5], id: "trimB" },
      ],
      edges: [
        LIST_EDGES[0],
        { id: "q", source: "split1", target: "trimEach", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
        { id: "a", source: "split1", target: "trimA", sourceHandle: "video", targetHandle: "in" },
        { id: "b", source: "split1", target: "trimB", sourceHandle: "video", targetHandle: "in" },
      ],
    }
    const job = runJob([], [])
    ;(job.data as unknown as Record<string, unknown>).inlineGraph = true
    await processWorkflowExecution(job)
    expect(calls).toContain("trimA")
    expect(calls).not.toContain("trimB")
    const writes = [...mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => u as Record<string, unknown>), ...(mocks.executionUpdates as Array<Record<string, unknown>>)]
    const last = [...writes].reverse().find((u) => u.node_states !== undefined)?.node_states as Record<string, { status: string }>
    expect(last.trimB.status).toBe("skipped")
    expect(writes.some((u) => u.status === "failed")).toBe(false)
  })

  it("with enforcement on a node is marked running only once it holds a slot of the run's width", async () => {
    await gate.setEnforced(true)
    state.dispatchWidth = 2
    // Second level: a fan-out over 5 parts and two plain Trims. The fan-out's
    // items and one Trim hold the two slots; the other Trim's task has started
    // and waits for one. While it waits it must still read `pending`.
    const seenWhileWaiting: Record<string, string | undefined> = {}
    const started = new Set<string>()
    mocks.setExecuteNode(async (node, ...rest: unknown[]) => {
      if (node.type === "split-media") return { output: { videoUrl: PARTS[0], videoUrls: PARTS }, creditsUsed: 0 }
      const states = rest[3] as Record<string, { status: string }>
      started.add(node.id)
      // Its own state is `running` by the time it runs.
      expect(states[node.id]?.status).toBe("running")
      await sleep(node.id === "trimEach" ? 30 : 5)
      if (node.id === "trimEach") {
        for (const id of ["trimA", "trimB"]) if (!started.has(id)) seenWhileWaiting[id] = states[id]?.status
      }
      return { output: { videoUrl: "https://cdn/trimmed.mp4" }, creditsUsed: 0 }
    })
    await processWorkflowExecution(runJob(
      [LIST_NODES[0], LIST_NODES[1], { ...LIST_NODES[3], id: "trimEach" }, { ...LIST_NODES[5], id: "trimA" }, { ...LIST_NODES[5], id: "trimB" }],
      [
        LIST_EDGES[0],
        { id: "q", source: "split1", target: "trimEach", sourceHandle: "video", targetHandle: "in", data: { outputMode: "each" } },
        { id: "a", source: "split1", target: "trimA", sourceHandle: "video", targetHandle: "in" },
        { id: "b", source: "split1", target: "trimB", sourceHandle: "video", targetHandle: "in" },
      ],
    ))
    // One Trim waited for a slot behind the fan-out's items, and read `pending` meanwhile.
    expect(Object.values(seenWhileWaiting).length).toBeGreaterThan(0)
    for (const st of Object.values(seenWhileWaiting)) expect(st).toBe("pending")
    expect(terminalStatus()).toBe("completed")
  })

  it("with enforcement off a list fan-out keeps its own limiter as today", async () => {
    state.hasCredits = false
    const seen = trackInFlight(listOutput)
    await processWorkflowExecution(runJob(LIST_NODES, LIST_EDGES))
    expect(seen.calls).toBe(3 + 10)
    // Level limit 6 over two nodes, each fan-out its own limit of 6: all 10 at once.
    expect(seen.peak).toBe(10)
    expect(terminalStatus()).toBe("completed")
  })

  it("a run keeps the width it started with when enforcement flips mid-run", async () => {
    state.tier = "free"
    const isEnforced = vi.spyOn(gate, "isEnforced")
    const seen = { now: 0, peak: 0 }
    mocks.setExecuteNode(async (node) => {
      seen.now++
      seen.peak = Math.max(seen.peak, seen.now)
      try {
        if (node.id === "img1") await gate.setEnforced(true)
        await sleep(20)
        return { output: { imageUrl: "https://cdn/x.png" }, creditsUsed: 0 }
      } finally {
        seen.now--
      }
    })
    await processWorkflowExecution(runJob(imageNodes(6)))
    expect(seen.peak).toBe(2)
    expect(isEnforced).toHaveBeenCalledTimes(1)
  })
})
