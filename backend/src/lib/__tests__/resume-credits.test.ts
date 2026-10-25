// @test-units-by-name prices only the node types it names (tighten-episode's run and the steps of its chain), never every node
/**
 * A continued run's up-front credit check prices a use-case node that will
 * RESUME a failed attempt at what that resume charges (decided 2026-10-18):
 * the steps the attempt's run did not complete plus the run's fee, the figure
 * the continue route checks and holds (routes/use-case-continue.ts) — never as
 * the fresh run (whole chain and fee) it will not make. A node the run will
 * not resume, or whose resume cannot be told before the run starts, is priced
 * as a fresh run. Real estimate (the base prices), real decision (the
 * engine's `attemptStillApplies`, the continue route's
 * `resolveUseCaseContinuation`); only the database is in memory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  toStoredInlineGraph,
} from "@nodaro/render-rules"

const USER = "00000000-0000-4000-8000-000000000001"
const ATTEMPT = "00000000-0000-4000-8000-0000000000aa"
const REC_URL = "https://r2/ep.mp4"

const db = vi.hoisted(() => ({
  jobs: {} as Record<string, Record<string, unknown>>,
  inner: null as unknown,
  innerSource: null as unknown,
  /** The newest generation of the attempt's lineage (`_chainOf`), when one was made. */
  newest: null as { id: string; status: string } | null,
  balance: 0,
}))

vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
vi.mock("@/ee/billing/credits.js", async (orig) => {
  const actual = await orig<typeof import("@/ee/billing/credits.js")>()
  return {
    ...actual,
    // The run estimate at the base prices (no price-table read), with every option the run's passes.
    estimateRunSetCredits: async (
      nodes: Parameters<typeof actual.estimateRunSetCredits>[0],
      edges: Parameters<typeof actual.estimateRunSetCredits>[1],
      runNodeIds: ReadonlySet<string>,
      pricedElsewhereNodeIds?: ReadonlySet<string>,
    ) =>
      actual.CreditsService.estimateWorkflowBaseCredits(nodes, edges, {
        runNodeIds,
        ...(pricedElsewhereNodeIds && pricedElsewhereNodeIds.size > 0 ? { pricedElsewhereNodeIds } : {}),
      }),
    // The same figures, the hold the price (no UGC part here).
    estimateRunSetFigures: async (
      nodes: Parameters<typeof actual.estimateRunSetFigures>[0],
      edges: Parameters<typeof actual.estimateRunSetFigures>[1],
      runNodeIds: ReadonlySet<string>,
      pricedElsewhereNodeIds?: ReadonlySet<string>,
    ) => {
      const credits = await actual.CreditsService.estimateWorkflowBaseCredits(nodes, edges, {
        runNodeIds,
        ...(pricedElsewhereNodeIds && pricedElsewhereNodeIds.size > 0 ? { pricedElsewhereNodeIds } : {}),
      })
      return { credits, hold: credits }
    },
    checkRunSetCredits: async (_user: string, required: number) => ({ sufficient: db.balance >= required, required, available: db.balance }),
    // Its static methods are not own enumerable properties: inherit them.
    CreditsService: class extends actual.CreditsService {
      static override async checkBalanceCovers(_user: string, required: number) {
        return { ok: db.balance >= required, balance: db.balance } as never
      }
    },
  }
})
vi.mock("@/lib/execution-inline-graph.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/execution-inline-graph.js")>()),
  loadInlineGraph: async () => db.inner,
  findExecutionIdForWrapper: async () => null,
  loadExecutionForWrapper: async (id: string) => (id === "exec-0" ? { id, userId: USER, inlineGraph: db.inner } : null),
}))
vi.mock("@/services/workflow-engine/run-continuation.js", async (orig) => ({
  ...(await orig<typeof import("@/services/workflow-engine/run-continuation.js")>()),
  loadContinuationSource: async (id: string) => (id === "exec-0" ? db.innerSource : null),
}))
/** The `jobs` rows the reads ask for: a wrapper by id; the newest generation of its run, when one was made. */
vi.mock("@/lib/supabase.js", () => {
  const query = () => {
    const eqs: Array<[string, unknown]> = []
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (eqs.push([col, v]), q),
      // `deleted_at` is null on every row here: none is in the Trash.
      is: () => q,
      in: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        if (eqs.some(([col]) => col.startsWith("input_data->>"))) {
          const ofChain = eqs.some(([col, v]) => col === "input_data->>_chainOf" && v === ATTEMPT)
          return { data: ofChain ? db.newest : null, error: null }
        }
        const id = eqs.find(([col]) => col === "id")?.[1] as string | undefined
        return { data: (id && db.jobs[id]) ?? null, error: null }
      },
    }
    return q
  }
  return { supabase: { from: () => query() } }
})

import { renderFinalCredits } from "../render-final-run.js"
import { resolveUseCaseContinuation } from "../use-case/continuation.js"
import { fromFailedCover } from "../use-case/continue-credits.js"
import { continuationInputOverrides, type ContinuationSource } from "../../services/workflow-engine/run-continuation.js"
import { CreditsService } from "../../ee/billing/credits.js"

/** Tighten Episode, review off, captions on: the run A failed at its render. */
const tData = { reviewBeforeRender: false, captions: true }
const settings = resolveTightenEpisodeSettings(tData, "video")
const inner = toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: REC_URL, kind: "video", durationSec: 3600 } }), settings)
const innerSource = {
  id: "exec-0", userId: USER, workflowId: null, status: "failed", appVersionId: null, inlineGraphHash: inner.hash, inputOverrides: null,
  nodeStates: Object.fromEntries(
    inner.nodes.map((n) => [
      n.id,
      n.id === "uc-render" ? { status: "failed" } : n.id === "uc-captions" ? { status: "skipped" } : { status: "completed" },
    ]),
  ),
}
const attemptWrapper = {
  id: ATTEMPT, user_id: USER, status: "failed", provider: "use-case", job_type: "tighten-episode",
  input_data: { type: "tighten-episode", mode: "run", _executionId: "exec-0", _feeCredits: 10, settings, mediaUrl: REC_URL, durationSec: 3600 },
}

/** The saved workflow: the recording, T, and a priced node after it. */
const nodes = [
  { id: "rec", type: "upload-video", data: { url: REC_URL, metadata: { durationSeconds: 3600 } } },
  { id: "t", type: "tighten-episode", data: { ...tData } },
  { id: "up", type: "video-upscale", data: {} },
]
const edges = [
  { source: "rec", target: "t", sourceHandle: "video", targetHandle: "media" },
  { source: "t", target: "up", sourceHandle: "media", targetHandle: null },
]

/**
 * B: a continue-from-failed of A that left T out and completed. Its state of
 * T is the seed carrying A's attempt; the recording handed on its output.
 */
const runB = (tState: Record<string, unknown> = { status: "skipped", failedAttemptJobId: ATTEMPT }): ContinuationSource =>
  ({
    id: "exec-b", userId: USER, workflowId: "wf-1", status: "completed", appVersionId: null, inputOverrides: null,
    nodeStates: { rec: { status: "completed", output: { videoUrl: REC_URL } }, t: tState },
  }) as unknown as ContinuationSource

const quote = (opts: {
  readonly runNodeIds: readonly string[]
  readonly source?: ContinuationSource | null
  readonly overrides?: Record<string, Record<string, unknown>>
  readonly graph?: { nodes: typeof nodes; edges: typeof edges }
}) =>
  renderFinalCredits({
    userId: USER,
    nodes: opts.graph?.nodes ?? nodes,
    edges: opts.graph?.edges ?? edges,
    runNodeIds: opts.runNodeIds,
    overrides: opts.overrides,
    surface: {},
    ...(opts.source !== undefined ? { continuation: { source: async () => opts.source ?? null, sentOverrides: opts.overrides } } : {}),
  })

/** What the continue route checks and holds to resume the attempt: its own funnel, on its own plan. */
async function whatTheResumeCharges(): Promise<number> {
  const plan = await resolveUseCaseContinuation({ nodeType: "tighten-episode", jobId: ATTEMPT, userId: USER, mode: "from-failed" })
  if (!plan.ok) throw new Error(`the attempt cannot be continued: ${plan.code}`)
  db.balance = Number.MAX_SAFE_INTEGER
  const cover = await fromFailedCover({
    userId: USER,
    graph: plan.graph,
    nodeIds: plan.nodeIds,
    overrides: continuationInputOverrides(plan.source, undefined),
    feeCredits: plan.feeCredits,
    webFreeMode: false,
  })
  if (!cover?.ok) throw new Error("not covered")
  return cover.totalCredits
}

const base = (runNodeIds: readonly string[], elsewhere?: readonly string[]) =>
  CreditsService.estimateWorkflowBaseCredits(nodes, edges, {
    runNodeIds: new Set(runNodeIds),
    ...(elsewhere ? { pricedElsewhereNodeIds: new Set(elsewhere) } : {}),
  })

beforeEach(() => {
  db.jobs = { [ATTEMPT]: structuredClone(attemptWrapper) }
  db.inner = structuredClone(inner)
  db.innerSource = structuredClone(innerSource)
  db.newest = null
  db.balance = 0
})

describe("a use-case node that resumes a failed attempt is priced at that resume", () => {
  it("the review's lineage: a run of [T, after it] continuing B prices T at its steps left and its fee, the figure its resume charges", async () => {
    const charges = await whatTheResumeCharges()
    // The resume runs the render and the captions, and holds the run's fee again (the failed run's was refunded).
    expect(charges).toBeGreaterThan(10)
    const fresh = await quote({ runNodeIds: ["t", "up"] })
    const resumed = await quote({ runNodeIds: ["t", "up"], source: runB() })
    // What follows T is priced exactly as before: T still runs.
    const after = base(["t", "up"], ["t"])
    expect(after).toBe(base(["t", "up"]) - base(["t"]))
    expect(after).toBeGreaterThan(0)
    expect(resumed!.estimatedCredits).toBe(after + charges)
    expect(resumed!.estimatedCredits).toBeLessThan(fresh!.estimatedCredits)
  })

  it("a payer who can cover the run it will make is not refused for the fresh run it will not", async () => {
    const charges = await whatTheResumeCharges()
    db.balance = base(["t", "up"], ["t"]) + charges
    expect((await quote({ runNodeIds: ["t", "up"] }))!.sufficient).toBe(false)
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.sufficient).toBe(true)
    db.balance -= 1
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.sufficient).toBe(false)
  })

  it("a continue-from-failed's T, failed in the run it continues, is priced the same way", async () => {
    const charges = await whatTheResumeCharges()
    const failedA = runB({ status: "failed", jobId: ATTEMPT })
    expect((await quote({ runNodeIds: ["t", "up"], source: failedA }))!.estimatedCredits).toBe(base(["t", "up"], ["t"]) + charges)
  })
})

describe("a node whose attempt was already continued elsewhere is priced at 0", () => {
  // A1 failed; the user continued it directly (POST /v1/tighten-episode/continue),
  // and then runs [T, after it] continuing B, whose state of T carries A1. The
  // engine's resume is answered already_running, naming that continuation; it
  // waits on it and hands on its result, charging nothing for T.
  it.each(["completed", "running"])("a direct continuation that is %s: only what follows T is priced", async (status) => {
    db.newest = { id: "00000000-0000-4000-8000-0000000000bb", status }
    const plan = await resolveUseCaseContinuation({ nodeType: "tighten-episode", jobId: ATTEMPT, userId: USER, mode: "from-failed" })
    expect(plan).toMatchObject({ ok: false, code: "already_running", jobId: db.newest.id })
    const after = base(["t", "up"], ["t"])
    const resumed = await quote({ runNodeIds: ["t", "up"], source: runB() })
    expect(resumed!.estimatedCredits).toBe(after)
    db.balance = after
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.sufficient).toBe(true)
    // Priced as the fresh run it will not make, the same payer would be refused.
    expect((await quote({ runNodeIds: ["t", "up"] }))!.sufficient).toBe(false)
  })
})

describe("a node that runs fresh is priced as a fresh run", () => {
  const freshPrice = async () => (await quote({ runNodeIds: ["t", "up"] }))!.estimatedCredits

  it("no failed attempt on its state: its whole chain and its fee", async () => {
    expect((await quote({ runNodeIds: ["t", "up"], source: runB({ status: "skipped" }) }))!.estimatedCredits).toBe(await freshPrice())
    expect(await freshPrice()).toBe(base(["t", "up"]))
  })

  it("a setting the run changes (the engine then runs it fresh)", async () => {
    const overrides = { t: { planTier: "premium" } }
    const fresh = (await quote({ runNodeIds: ["t", "up"], overrides }))!.estimatedCredits
    expect((await quote({ runNodeIds: ["t", "up"], source: runB(), overrides }))!.estimatedCredits).toBe(fresh)
  })

  it("a recording the run hands on anew (an upload pointed at another file)", async () => {
    const overrides = { rec: { url: "https://r2/fixed.mp4" } }
    const fresh = (await quote({ runNodeIds: ["rec", "t", "up"], overrides }))!.estimatedCredits
    expect((await quote({ runNodeIds: ["rec", "t", "up"], source: runB(), overrides }))!.estimatedCredits).toBe(fresh)
  })

  it("an input wired from a node the run executes: what it hands on is not known up front", async () => {
    const graph = {
      nodes: [nodes[0]!, { id: "trim", type: "trim-video", data: {} }, ...nodes.slice(1)],
      edges: [
        { source: "rec", target: "trim", sourceHandle: "video", targetHandle: null },
        { source: "trim", target: "t", sourceHandle: "video", targetHandle: "media" },
        edges[1]!,
      ],
    }
    const source = runB()
    ;(source.nodeStates as Record<string, unknown>).trim = { status: "completed", output: { videoUrl: REC_URL } }
    const fresh = (await quote({ runNodeIds: ["trim", "t", "up"], graph }))!.estimatedCredits
    expect((await quote({ runNodeIds: ["trim", "t", "up"], graph, source }))!.estimatedCredits).toBe(fresh)
    // Left out of the run, the same node hands on its seed: decided, and resumed.
    expect((await quote({ runNodeIds: ["t", "up"], graph, source }))!.estimatedCredits).toBeLessThan(
      (await quote({ runNodeIds: ["t", "up"], graph }))!.estimatedCredits,
    )
  })

  it("an attempt whose run cannot be continued (gone, or not failed) is priced fresh, as the engine falls back", async () => {
    db.jobs = {}
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.estimatedCredits).toBe(await freshPrice())
    db.jobs = { [ATTEMPT]: { ...structuredClone(attemptWrapper), status: "completed" } }
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.estimatedCredits).toBe(await freshPrice())
  })

  it("a run that costs nothing is never refused, even on an overdrawn balance", async () => {
    db.balance = -5
    const free = await quote({ runNodeIds: ["rec"], source: runB() })
    expect(free).toMatchObject({ estimatedCredits: 0, sufficient: true })
    expect(free!.message).toBeUndefined()
    expect((await quote({ runNodeIds: ["t", "up"], source: runB() }))!.sufficient).toBe(false)
  })

  it("a source with no states to read prices the node fresh", async () => {
    expect((await quote({ runNodeIds: ["t", "up"], source: null }))!.estimatedCredits).toBe(await freshPrice())
  })

  it("a source whose read fails prices the node fresh, never a 500", async () => {
    const fresh = await freshPrice()
    const failing = renderFinalCredits({
      userId: USER,
      nodes,
      edges,
      runNodeIds: ["t", "up"],
      overrides: undefined,
      surface: {},
      continuation: {
        source: async () => {
          throw new Error("executions unreadable")
        },
        sentOverrides: undefined,
      },
    })
    await expect(failing).resolves.toMatchObject({ estimatedCredits: fresh })
  })
})
