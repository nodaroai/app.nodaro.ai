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
 * What it prints instead is the node's CHARGED price — what a run costs on
 * Nodaro Cloud, never a price-table row before the pricing settings apply:
 * the `NODE_REGISTRY` figure (or, when a node declares none, the price table's
 * row for its type — the fallback `getEnrichedRegistry()` applies), re-priced
 * by `chargedDescriptor` exactly as `GET /v1/nodes` re-prices it, but through
 * `statedPrices()` — the server's price-table rule at the hosted deployment's
 * settings, the rule the public docs are held to (`ee/billing/docs-pricing.ts`).
 * A band keeps its derivation, each end charged id by id. Plus, always, where
 * the live price is: an admin can reprice a row at runtime, and
 * `/v1/credits/model-cost` serves what a run is charged right now.
 *
 * `NODE_REGISTRY` + `STATIC_CREDIT_COSTS` deliberately, never
 * `getEnrichedRegistry()` itself: the enriched one reads `hasCredits()`, which
 * would make the generated markdown depend on the EDITION env var and hand
 * `gen:skills:check` a drift nobody could explain.
 */
import { STATIC_CREDIT_COSTS } from "../../../src/ee/billing/credits.js"
import { statedPrices } from "../../../src/ee/billing/stated-prices.js"
import { NODE_REGISTRY, chargedDescriptor } from "../../../src/lib/node-registry.js"

/** node type → the charged figure `/v1/nodes` advertises for it on Nodaro Cloud, where there is one. */
function nodeCreditCosts(): ReadonlyMap<string, number | string> {
  const prices = statedPrices()
  return new Map(
    NODE_REGISTRY.flatMap((d) => {
      const row = STATIC_CREDIT_COSTS[d.type]
      const declared = d.creditCost ?? (typeof row === "number" ? row : undefined)
      if (declared === undefined) return []
      const cost = chargedDescriptor({ ...d, creditCost: declared }, prices).creditCost
      return cost === undefined ? [] : [[d.type, cost] as [string, number | string]]
    }),
  )
}

let costs: ReadonlyMap<string, number | string> | null = null

const LIVE_PRICE =
  "the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`)"

export function renderCreditCostLine(nodeType: string): string {
  const cost = (costs ??= nodeCreditCosts()).get(nodeType)
  if (cost === undefined) {
    // Input, parameter, trigger and layout nodes run no job at all; anything
    // else that lands here is priced by whatever registers it at runtime.
    return `**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise ${LIVE_PRICE}.`
  }
  return `**Credit cost:** \`${cost}\` charged on Nodaro Cloud — ${LIVE_PRICE}; \`GET /v1/nodes\` gives this node's figure live.`
}
