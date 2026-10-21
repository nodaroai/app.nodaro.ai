/**
 * An estimate or a listing that meets a metered LLM model with no price on its
 * lane (R49, fail closed): the estimator throws `LlmUnpricedModelError`
 * (`ee/billing/llm-metered.ts`) rather than quote a tier row or 0, and every
 * surface that asked answers the ONE refusal the run itself would give —
 * `400 validation_error / llm_model_unpriced` (`sendLlmModelUnpriced`).
 *
 * Core: the error is recognised by its name (core never imports `ee/`
 * statically), and the reply is loaded on demand.
 */
import type { FastifyReply } from "fastify"
import { withRunOverrides } from "@nodaro/shared/nodes"
import { hasCredits, llmMeteredPricing } from "./config.js"

/** The estimator's refusal of an unpriced metered model, recognised without importing `ee/`. */
export interface LlmUnpricedError extends Error {
  readonly code: "llm_model_unpriced"
  readonly modelId: string
}

export function isLlmUnpricedError(err: unknown): err is LlmUnpricedError {
  return err instanceof Error && err.name === "LlmUnpricedModelError"
}

/** Answer `err` with the unpriced-model 400 when it is one; false (nothing sent) otherwise. */
export async function replyIfLlmUnpriced(reply: FastifyReply, err: unknown): Promise<boolean> {
  if (!isLlmUnpricedError(err)) return false
  const { sendLlmModelUnpriced } = await import("../ee/billing/llm-unpriced-reply.js")
  sendLlmModelUnpriced(reply, err as never)
  return true
}

/** The user-facing sentence for it (the same one the 400 carries), for a surface that is not an HTTP reply. */
export async function llmUnpricedMessage(err: LlmUnpricedError): Promise<string> {
  const { llmModelUnpricedMessage } = await import("../ee/billing/llm-unpriced-reply.js")
  return llmModelUnpricedMessage(err as never)
}

/** The graph a run pre-check reads (the estimator's node and edge shapes, structurally). */
type RunGraphNode = { id?: string; type?: string; data?: unknown; parentId?: string | null }
type RunGraphEdge = { source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }

/** What a run executes, beyond its saved graph: the node ids it runs, and the per-node data it overrides. */
export interface RunScope {
  readonly runNodeIds?: ReadonlySet<string> | readonly string[]
  /** Per-node data the run merges over the saved graph (`inputOverrides`): a model a run sets is the model it runs. */
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/**
 * The unpriced metered LLM call a run of this graph would be refused at (R51),
 * or null — asked BEFORE a run entry point enqueues anything, so no fixed node
 * runs and is charged ahead of it. Null on an edition without credits.
 */
export async function unpricedLlmOfRun(
  nodes: ReadonlyArray<RunGraphNode>,
  edges: ReadonlyArray<RunGraphEdge> | undefined,
  scope: RunScope = {},
): Promise<LlmUnpricedError | null> {
  if (!hasCredits()) return null
  const { unpricedMeteredLlmOfRun } = await import("../ee/billing/credits.js")
  const typed = nodes.flatMap((n) => (typeof n.type === "string" ? [{ ...n, id: n.id ?? "", type: n.type, data: (n.data ?? {}) as Record<string, unknown> }] : []))
  const run = withRunOverrides(typed, scope.overrides)
  const ids = scope.runNodeIds === undefined ? undefined : new Set(scope.runNodeIds)
  return unpricedMeteredLlmOfRun(run, (edges ?? []).flatMap((e) => (typeof e.target === "string" ? [{ ...e, target: e.target }] : [])), ids) as LlmUnpricedError | null
}

/** Refuse a run (`400 llm_model_unpriced`) that would meet an unpriced metered LLM call; false (nothing sent) otherwise. */
export async function refuseIfRunUnpriced(
  reply: FastifyReply,
  nodes: ReadonlyArray<RunGraphNode>,
  edges: ReadonlyArray<RunGraphEdge> | undefined,
  scope: RunScope = {},
): Promise<boolean> {
  const err = await unpricedLlmOfRun(nodes, edges, scope)
  return err ? replyIfLlmUnpriced(reply, err) : false
}

/** A graph a sub-workflow node in the run will execute (`loadNestedRunGraphs`), structurally. */
interface NestedRunGraphLike {
  readonly nodes: ReadonlyArray<RunGraphNode>
  readonly edges: ReadonlyArray<RunGraphEdge>
  readonly subWorkflowPath: readonly string[]
}

/**
 * The orchestrator's run-start refusal (R51): the message to fail the
 * execution with when the run — the nodes it executes, and every graph a
 * sub-workflow node in it will load — meets an unpriced metered LLM call; null
 * when it may start. Asked BEFORE any node dispatches, so the lanes with no
 * route of their own (a webhook, a Telegram message, a schedule, a plugin
 * trigger, a component's inner run) refuse before a fixed node upstream of the
 * call has run and charged. `nodes` already carries the run's overrides.
 */
export async function unpricedLlmRunPreflight(
  runNodeIds: ReadonlyArray<string>,
  nodes: ReadonlyArray<RunGraphNode>,
  edges: ReadonlyArray<RunGraphEdge>,
  nestedGraphs: ReadonlyArray<NestedRunGraphLike> = [],
  /**
   * The graphs reached through a component node (`componentRunGraphs`), read only when the run and
   * its sub-workflows price clean: a component runs as its own execution, which refuses at its own
   * start, but only after the parent's nodes upstream of it have run and charged.
   */
  componentGraphs?: () => Promise<ReadonlyArray<{ readonly nodes: ReadonlyArray<RunGraphNode>; readonly edges: ReadonlyArray<RunGraphEdge>; readonly path: readonly string[] }>>,
): Promise<string | null> {
  if (!hasCredits()) return null
  const top = await unpricedLlmOfRun(nodes, edges, { runNodeIds })
  if (top) return llmUnpricedMessage(top)
  for (const graph of nestedGraphs) {
    const hit = await unpricedLlmOfRun(graph.nodes, graph.edges)
    if (hit) return `${await llmUnpricedMessage(hit)} Found inside Sub-workflow node ${graph.subWorkflowPath.join(" → ")}.`
  }
  // Read only while metered pricing is on (under the rollback every model is priced). A read that
  // fails leaves the component to its own run's check.
  let components: Awaited<ReturnType<NonNullable<typeof componentGraphs>>> = []
  try {
    if (componentGraphs && llmMeteredPricing()) components = await componentGraphs()
  } catch (err) {
    console.warn(`[llm-unpriced-preflight] component graphs not read — left to each component's run: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const graph of components) {
    const hit = await unpricedLlmOfRun(graph.nodes, graph.edges)
    if (hit) return `${await llmUnpricedMessage(hit)} Found inside Component node ${graph.path.join(" → ")}.`
  }
  return null
}
