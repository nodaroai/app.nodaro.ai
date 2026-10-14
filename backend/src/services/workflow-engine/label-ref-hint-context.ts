import type { HintEdgeLike, HintGraphContext, HintNodeLike } from "@nodaro/shared/types"

/**
 * Parameter pickers whose `{Label}` text on the SERVER is composed from the
 * graph wired into them.
 *
 * WHY THIS SET EXISTS. A prompt that places a picker by label (`{Motion}`) does
 * not go through the cinematography collector, which already passes the graph
 * for `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`. It resolves to text the server
 * derives in three other places: the orchestrator's parameter pre-completion
 * and the sub-workflow handler's (both store `nodeStates[id].output.text`), and
 * the parameter fallback in `buildNodeRefMap`. Those used to call
 * `getParameterPromptHint(node)` with no graph. For character-motion that drops
 * the target / partner names AND the minor-age floor, so a server run shipped an
 * adult-only move for a minor Character. The editor had already dropped that
 * move, because it composes the `{Label}` value with the graph
 * (`extractNodeOutput` in the frontend execution-graph.ts).
 *
 * WHAT IS IN IT, AND WHY. This set stays exactly equal in spirit to
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES` (and a test pins it as a SUBSET):
 * a type composed by label but not on the execution path — or the reverse —
 * would disagree with itself depending on how the prompt happened to place it.
 * Character-motion came first, then camera-motion — whose server `{Label}` text
 * was context-free until it was admitted, so a `{Cam}` ref disagreed with both
 * the editor and the cinematography path. Transition and character-fx joined
 * both sets in a later signed-off change: they already composed from
 * the graph in the config panel's injection preview, on the canvas card, and on
 * the frontend `{Label}` path, so the server was the only surface still
 * dropping a wired `startState` / `endState` / `target`.
 *
 * THIS CHANGES EXISTING WORKFLOWS, ON PURPOSE, WITHIN A MEASURED BOUND. Tal
 * signed off on the bound: a picker with NOTHING wired to its own handles emits
 * byte-identical text with and without the graph, because the composers are
 * called with empty clause arrays on both paths. So a workflow that wires
 * nothing is untouched, and a workflow that wires something starts emitting the
 * text its own preview has always shown. The bound is a test, not a claim:
 * `packages/prompts/src/__tests__/graph-composed-unwired-identity.test.ts`
 * walks every transition and character-fx catalog entry in both hint modes,
 * under two unwired graph shapes, and carries a wired positive control so it
 * cannot silently become vacuous.
 *
 * ADD A NEW GRAPH-COMPOSED PICKER TO BOTH SETS — here and
 * `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES` — when it ships. Its `{Label}` text
 * then matches the editor and the cinematography path from its first release,
 * and no existing workflow's prompt changes.
 */
export const LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "camera-motion",
  "character-motion",
  "transition",
  "character-fx",
])

/**
 * The graph context to hand `getParameterPromptHint` when the server derives a
 * parameter node's `{Label}` text. Returns `{ nodes, edges }` for a type in
 * `LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES`, and `undefined` for every other
 * type, which keeps its historical context-free text. Pass the graph the node
 * lives in: a sub-workflow passes its SUB-graph.
 */
export function labelRefHintContext(
  node: HintNodeLike | undefined,
  nodes: ReadonlyArray<HintNodeLike>,
  edges: ReadonlyArray<HintEdgeLike>,
): HintGraphContext | undefined {
  if (!node?.type || !LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES.has(node.type)) return undefined
  return { nodes, edges }
}
