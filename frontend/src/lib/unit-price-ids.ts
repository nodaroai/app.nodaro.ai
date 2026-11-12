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
 */
export function unitCreditIdOf(type: string | null | undefined, data: Readonly<Record<string, unknown>> | null | undefined): string | undefined {
  const rule = typeof type === "string" ? UNIT_PRICE_IDS[type] : undefined
  return rule ? rule(data ?? {}) : undefined
}
