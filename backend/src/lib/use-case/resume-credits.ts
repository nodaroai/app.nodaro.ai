/**
 * What a use-case node of a continued run charges when it RESUMES a failed
 * attempt instead of running fresh (decided 2026-10-18) — for the run's
 * up-front credit check, so a run that fits is never refused on the price of
 * a fresh run it will not make.
 *
 * The node resumes by the engine's own rule, asked here the way the engine
 * asks it (use-case-node.ts): the attempt the continued run's state of it
 * records (`failedAttemptJobIdOf`), held to the inputs the node will run with
 * (`attemptStillApplies`, over the inputs resolved from this run's seeds —
 * `continuationSeeds`, `resolveNodeInputs`). Its price is what the continue
 * route checks and holds for it (routes/use-case-continue.ts): the steps that
 * attempt's run did not complete, plus the run's fee — the failed run's fee
 * was refunded, so it is held again (one fee per run overall). A newer failed
 * generation of that run is followed, as the engine follows it.
 *
 * Anything that cannot be decided before the run starts prices the node as a
 * fresh run (its chain and fee), never lower:
 *  - an input wired from a node this run executes (other than a source or a
 *    parameter node, whose value is its data): what it hands on is not known;
 *  - a node fanned out over a list (each item is a run of its own, fresh);
 *  - a node carrying a continuation of its own (`useCaseContinue`: the
 *    expansion prices it);
 *  - any read that fails, and any refusal of the continuation but one: a
 *    continuation of that run already under way or completed is priced 0,
 *    since the engine waits on it and pays nothing for it.
 * Never imported statically by the run route: render-final-run.ts loads it
 * only for a continuation, and it reaches the engine through it.
 */
import { CONTINUATION_SUPERSEDED, withRunOverrides, withWiredSettings } from "@nodaro/shared/nodes"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import { planFanOut } from "@nodaro/shared/workflow"
import { bypassTeleports, isUseCaseNodeType, type UseCaseNodeType } from "@nodaro/render-rules"
import { hasCredits } from "../config.js"
import { continuationSeeds, continuationInputOverrides, type ContinuationSource } from "../../services/workflow-engine/run-continuation.js"
import { failedAttemptJobIdOf } from "../../services/workflow-engine/failed-attempt.js"
import { getListFanOutForNode, resolveNodeInputs } from "../../services/workflow-engine/input-resolver.js"
import { isSourceNode } from "../../services/workflow-engine/execution-graph.js"
import { MAX_GENERATION_HOPS, attemptStillApplies } from "../../services/workflow-engine/use-case-node.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../../services/workflow-engine/types.js"
import { RENDER_FINAL_ALREADY_RUNNING } from "../render-final-codes.js"
import { resolveUseCaseContinuation } from "./continuation.js"
import { fromFailedStepCredits } from "./continue-credits.js"

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }

/** The node carries a continuation of one of its own runs (`useCaseContinue`): the request it makes has no resume to decide. */
function continuesOwnRun(data: unknown): boolean {
  const cont = (data as { useCaseContinue?: { jobId?: unknown } | null } | null | undefined)?.useCaseContinue
  return !!cont && typeof cont.jobId === "string"
}

/**
 * What the continue route charges to resume the attempt `jobId` (its steps
 * left and its fee), following newer failed generations as the engine does.
 * A continuation of that run already under way or completed (one made outside
 * this lineage, say by a direct continue) charges 0: the engine waits on it
 * and hands on its result, paying nothing for a wrapper it did not start
 * (use-case-request.ts, `kind: "running"`). `null` for any other refusal (the
 * node then runs fresh or fails — priced as fresh, the upper bound).
 */
async function resumeCredits(type: UseCaseNodeType, jobId: string, userId: string): Promise<number | null> {
  let attempt = jobId
  for (let hop = 0; hop <= MAX_GENERATION_HOPS; hop++) {
    const plan = await resolveUseCaseContinuation({ nodeType: type, jobId: attempt, userId, mode: "from-failed" })
    if (plan.ok) {
      const steps = await fromFailedStepCredits({
        graph: plan.graph,
        nodeIds: plan.nodeIds,
        overrides: continuationInputOverrides(plan.source, undefined),
      })
      return steps + (hasCredits() ? plan.feeCredits : 0)
    }
    if (plan.code === RENDER_FINAL_ALREADY_RUNNING && plan.jobId) return 0
    if (plan.code !== CONTINUATION_SUPERSEDED || !plan.jobId) return null
    attempt = plan.jobId
  }
  return null
}

/**
 * Each use-case node of the run that will resume a failed attempt, with what
 * that resume charges. A node left out is priced as a fresh run by the
 * caller's estimate. Never throws: a node whose decision fails is left out.
 */
export async function resumedUseCaseCredits(input: {
  readonly userId: string
  /** The saved graph (not yet merged with the overrides). */
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly runNodeIds: readonly string[]
  /** The merged overrides the orchestrator applies (the earlier run's pin, the sent ones over it). */
  readonly overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
  /** The overrides SENT with the run (seeded from, as the orchestrator seeds). */
  readonly sentOverrides: Readonly<Record<string, Record<string, unknown>>> | undefined
  /** The execution the run is seeded from, with its states. */
  readonly source: ContinuationSource
}): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const runSet = new Set(input.runNodeIds)
    const states = input.source.nodeStates ?? {}
    const nodes = withRunOverrides(
      input.nodes.map((n) => ({ ...n, type: n.type ?? "", data: { ...((n.data ?? {}) as Record<string, unknown>) } })),
      input.overrides,
    ) as unknown as SimpleNode[]
    const candidates = nodes.flatMap((n) => {
      if (!runSet.has(n.id) || !isUseCaseNodeType(n.type) || continuesOwnRun(n.data)) return []
      const attempt = failedAttemptJobIdOf(states[n.id])
      return attempt ? [{ node: n, attempt }] : []
    })
    if (candidates.length === 0) return out

    const edges = input.edges.map((e, i) => ({ id: `e${i}`, ...e })) as SimpleEdge[]
    const byId = new Map(nodes.map((n) => [n.id, n] as const))
    // Wires as the run reads them (a Teleport pair hands on what entered it).
    const wires = bypassTeleports(nodes, edges)
    // A source or parameter node's value is its data: known whether or not the run executes it.
    const known = (id: string) => {
      const type = byId.get(id)?.type ?? ""
      return !runSet.has(id) || isSourceNode(type) || PARAMETER_NODE_TYPES.has(type)
    }
    const seeds = continuationSeeds(nodes, input.source, runSet, input.sentOverrides)
    const seeded: Record<string, NodeExecutionState> = Object.fromEntries(seeds)

    for (const { node, attempt } of candidates) {
      try {
        if (!wires.filter((w) => w.target === node.id).every((w) => known(w.source))) continue
        const fanOut = planFanOut(
          getListFanOutForNode(node, edges, seeded, nodes),
          node.type,
          withWiredSettings(node, nodes, edges).data as Record<string, unknown>,
        )
        if (fanOut) continue
        const resolved = resolveNodeInputs(node, edges, seeded, nodes)
        if ((await attemptStillApplies(attempt, node, resolved, input.userId)) !== true) continue
        const credits = await resumeCredits(node.type as UseCaseNodeType, attempt, input.userId)
        if (credits !== null) out.set(node.id, credits)
      } catch {
        // Undecided: the caller prices the node as a fresh run.
      }
    }
  } catch {
    // The setup failed: every node is left out, priced as a fresh run.
  }
  return out
}
