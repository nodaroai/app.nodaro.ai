/**
 * The run-time skip for a node with nothing to work on.
 *
 * A scheduled "feed → combine → write → speak" run with no new posts used to
 * FAIL: the feed completes with `text: ""`, Combine Text passes "" on, the
 * resolver drops the empty wire, the writer sends `userInput: ""` and the
 * route answers `400 Too small` — and the whole run is marked failed although
 * nothing went wrong. The rule here, decided 2026-10-05:
 *
 *   A TEXT-REQUIRING node (`TEXT_REQUIRED_NODE_TYPES`, @nodaro/prompts) is
 *   skipped with `skipReason: "empty_input"` when the text it would actually
 *   send is empty AND at least one of its wired inputs came from a node that,
 *   IN THIS RUN, completed with nothing on the wire or was itself skipped.
 *
 * Both halves matter. "Would send" is answered by the executor's own prompt
 * rule (`computeNodeSendText`), so a typed prompt or a `{Ref}` that resolves
 * still runs. "In this run" excludes a saved-data seed (`fromSavedData`): a
 * node outside a partial run, a frozen node, a source — stale saved results
 * never make a run read as "nothing new", and an unconfigured node with no
 * wire at all still fails loudly, as it should. A fan-out is never evaluated:
 * its items are non-empty by construction. Downstream propagation (a node
 * whose every incoming edge comes from a dead node) is the router-gating
 * rule, generalized in `execution-graph.ts :: computeGatedIds`.
 *
 * Reads only run-time state (never a node's saved data) — pinned by
 * saved-data-fallback-sites.test.ts.
 */
import { TEXT_REQUIRED_NODE_TYPES, computeNodeSendText } from "@nodaro/prompts"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "./types.js"
import { getListFanOutForNode, getNodeOutput, resolveNodeInputs } from "./input-resolver.js"
import { NODE_MAPPABLE_FIELDS, resolveFieldMappings } from "./resolve-field-mappings.js"
import { buildNodeRefMap } from "./payload-builder.js"
import { savedDataAllowed } from "./saved-data.js"

export interface EmptyInputSkipArgs {
  /** The nodes about to run. */
  readonly level: readonly SimpleNode[]
  readonly nodes: SimpleNode[]
  readonly edges: SimpleEdge[]
  readonly nodeStates: Record<string, NodeExecutionState>
  readonly triggerData?: Record<string, unknown>
  /** Nodes already gated out of this run (router-inactive, or skipped at run time). */
  readonly deadIds: ReadonlySet<string>
}

const present = (s: string | undefined): boolean => typeof s === "string" && s.trim().length > 0

/** A source that, IN THIS RUN, put nothing on this wire: gated, skipped at run time, or completed with an empty primary output. Never a saved-data seed. */
function producedNothingThisRun(
  source: SimpleNode,
  sourceHandle: string | null | undefined,
  args: EmptyInputSkipArgs,
): boolean {
  if (args.deadIds.has(source.id)) return true
  const state = args.nodeStates[source.id]
  // No state, or a seed: the run did not produce this value, so it cannot be "nothing new".
  if (!state || savedDataAllowed(state)) return false
  if (state.status === "skipped") return true
  if (state.status !== "completed") return false
  const output = getNodeOutput(source, sourceHandle, args.nodeStates, args.triggerData, { nodes: args.nodes, edges: args.edges })
  return !present(output)
}

/** The ids in `level` to skip for want of input, by the rule above. */
export function computeEmptyInputSkipIds(args: EmptyInputSkipArgs): Set<string> {
  const { level, nodes, edges, nodeStates, triggerData, deadIds } = args
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const skipped = new Set<string>()
  for (const node of level) {
    if (!TEXT_REQUIRED_NODE_TYPES.has(node.type)) continue
    if (deadIds.has(node.id)) continue
    if (nodeStates[node.id]?.status === "completed") continue
    const incoming = edges.filter((e) => e.target === node.id)
    if (incoming.length === 0) continue
    // A fan-out is never evaluated — its items are non-empty by construction.
    const fanOut = getListFanOutForNode(node, edges, nodeStates, nodes, triggerData)
    if (fanOut && fanOut.items.length > 0) continue
    const starved = incoming.some((e) => {
      const source = byId.get(e.source)
      return source !== undefined && producedNothingThisRun(source, e.sourceHandle, args)
    })
    if (!starved) continue
    // What the node would send — the executor's own resolution, mirrored:
    // inputs, then field mappings and `{}` injection, then the prompt rule.
    const inputs = resolveNodeInputs(node, edges, nodeStates, nodes, triggerData)
    const mappable = NODE_MAPPABLE_FIELDS[node.type]
    const data = mappable?.length
      ? resolveFieldMappings(node.data, nodeStates, nodes, inputs.prompt, mappable, node.id, edges)
      : node.data
    const refMap = buildNodeRefMap(node.id, { nodes, edges, nodeStates })
    const text = computeNodeSendText(node.type, data, {
      override: inputs.overridePrompt,
      wired: inputs.prompt,
      wiredSystemPrompt: inputs.systemPrompt,
      refMap,
    })
    if (text !== undefined && !present(text)) skipped.add(node.id)
  }
  return skipped
}
