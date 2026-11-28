// frontend/src/lib/unit-price-ids.ts — the editor's one door to the node units'
// price ids (each unit's price-id.ts, the "price-ids" aggregate; tools/units/README.md
// "A unit priced by its settings"), a reviewed composer
// (tools/units/registry-composers.json). A unit whose backend price.ee.ts names
// the id a run reserves from the node's data (`creditId`) states the same rule
// here, so the editor's Run button, config panel and run estimate quote the row
// the server reserves. getModelIdentifier and estimateNodeCredits read it.
// @registry-lookup answers for the one node type it is given (unitCreditIdOf(node.type, data))
import { UNIT_PRICE_IDS } from "@/nodes/_generated/price-ids"

/**
 * The credit id a run of node `type` reserves for `data`, or undefined when the
 * type names none here (a legacy node, a flat-priced unit — which reserves its
 * type's own row — or an unknown type). A lookup by the node type.
 * `wiredInputs` (the node's inputs that carry a wire, when the caller has the
 * edges) is handed to the rule; a rule priced by its settings alone ignores it.
 */
export function unitCreditIdOf(
  type: string | null | undefined,
  data: Readonly<Record<string, unknown>> | null | undefined,
  wiredInputs?: ReadonlySet<string>,
): string | undefined {
  const rule = typeof type === "string" ? UNIT_PRICE_IDS[type] : undefined
  return rule ? rule(data ?? {}, wiredInputs) : undefined
}

/** The ids of node `nodeId`'s inputs that carry a wire, from the canvas's edges; undefined without the edges or the node's id. */
export function wiredInputsOf(
  nodeId: string | undefined,
  edges: ReadonlyArray<{ readonly target: string; readonly targetHandle?: string | null }> | undefined,
): ReadonlySet<string> | undefined {
  if (!nodeId || !edges) return undefined
  return new Set(edges.flatMap((e) => (e.target === nodeId && e.targetHandle ? [e.targetHandle] : [])))
}
