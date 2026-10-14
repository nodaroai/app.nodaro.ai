import { REPEAT_PLACEHOLDER, decodeProviderItem, type FanOutPlan } from "@nodaro/shared/workflow"
import { resolveNodeInputs } from "../services/workflow-engine/input-resolver.js"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  ResolvedInputs,
} from "../services/workflow-engine/types.js"
import { overrideInputWithListItem } from "./list-item-override.js"

/**
 * The inputs of ONE fan-out iteration — the single place the orchestrator turns
 * "iteration k of this plan" into resolved inputs, so the pairing rules are
 * testable without a queue, a database or a provider.
 *
 *   - every wire is resolved on the iteration's ROW (`plan.rows[k]`), not on its
 *     iteration number: with Repeat xN the copies of a row share that row, and a
 *     row the driving list skipped (empty cell) keeps its number for the others;
 *   - the driving item is then applied as an override through the handle the
 *     driving list is wired to (`plan.targetHandle`).
 *
 * Repeat / provider sentinels carry no value — the normal upstream inputs stand.
 */
export function resolveFanOutIterationInputs(
  node: SimpleNode,
  plan: FanOutPlan,
  k: number,
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: SimpleNode[],
  triggerData?: Record<string, unknown>,
): ResolvedInputs {
  const inputs = resolveNodeInputs(node, edges, nodeStates, allNodes, triggerData, plan.rows[k] ?? k)
  const item = plan.items[k]
  if (item === REPEAT_PLACEHOLDER) return inputs
  // Provider-fanout sentinel — the provider swap happens at the executeNode call
  // site; here we just avoid touching prompt/media inputs.
  if (decodeProviderItem(item) !== undefined) return inputs
  overrideInputWithListItem(inputs, item, { nodeType: node.type, targetHandle: plan.targetHandle })
  return inputs
}
