/**
 * The `**Credit cost:**` line of a node's generated skill header.
 *
 * It used to print the FRONTEND `NODE_DEFINITIONS.creditCost` — a hand-typed
 * number nothing at runtime reads, and so a number no reprice ever touched.
 * After the ×10 re-denomination it told every `get_node_skill` caller that
 * add-captions costs 2 (it is 30, or 50 for a kinetic render) and transcribe 3,
 * across all ~198 generated skills. That field is no longer reachable from the
 * generator at all — it is not carried on `NodeDef` any more — so the header
 * cannot drift back onto it.
 *
 * What it prints instead is the node's LIST price: the `NODE_REGISTRY` figure
 * a node declares, or the price table's base for the node type when it
 * declares none (the same fallback `getEnrichedRegistry()` applies). Plus,
 * always, where the CHARGED price is: `model_pricing` is edited by an admin at
 * runtime and a price can sit above its base, so `GET /v1/nodes` and
 * `/v1/credits/model-cost` serve what a run is charged — a figure no
 * generated file can know.
 *
 * `NODE_REGISTRY` + `STATIC_CREDIT_COSTS` deliberately, never
 * `getEnrichedRegistry()` itself: the enriched one reads `hasCredits()`, which
 * would make the generated markdown depend on the EDITION env var and hand
 * `gen:skills:check` a drift nobody could explain.
 */
import { STATIC_CREDIT_COSTS } from "../../../src/ee/billing/credits.js"
import { NODE_REGISTRY } from "../../../src/lib/node-registry.js"

/** node type → the figure `/v1/nodes` advertises for it, where there is one. */
const NODE_CREDIT_COSTS: ReadonlyMap<string, number | string> = new Map(
  NODE_REGISTRY.flatMap((d) => {
    const cost = d.creditCost ?? STATIC_CREDIT_COSTS[d.type]
    return cost === undefined || typeof cost === "boolean"
      ? []
      : [[d.type, cost] as [string, number | string]]
  }),
)

const LIVE_PRICE =
  "the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`)"

export function renderCreditCostLine(nodeType: string): string {
  const cost = NODE_CREDIT_COSTS.get(nodeType)
  if (cost === undefined) {
    // Input, parameter, trigger and layout nodes run no job at all; anything
    // else that lands here is priced by whatever registers it at runtime.
    return `**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise ${LIVE_PRICE}.`
  }
  return `**Credit cost:** \`${cost}\` at list price — ${LIVE_PRICE}; \`GET /v1/nodes\` gives this node's charged figure.`
}
