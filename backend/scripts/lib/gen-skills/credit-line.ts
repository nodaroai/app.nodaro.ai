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
import { STATIC_CREDIT_COSTS, meteredLlmDefaultKeyOfType, meteredLlmOptionKeyOfType } from "../../../src/ee/billing/credits.js"
import { parseMeteredLlmId } from "../../../src/ee/billing/metered-llm-id.js"
import { hostedStatedPrices } from "../../../src/ee/billing/stated-prices.js"
import { NODE_REGISTRY, UNPRICED_CREDIT_COST, chargedDescriptor } from "../../../src/lib/node-registry.js"

/** A node's advertised figure, whether it is a metered LLM estimate (`≈`), and the feature its LLM call is priced under. */
interface NodeCreditFigure {
  readonly cost: number | string
  readonly estimate: boolean
  /** The metered LLM feature of the node's call (its default one, or the one it offers — Choose Best's judge). */
  readonly llmFeature?: string
}

/** The metered feature a node of `type` prices its LLM call under, whatever the switch says. */
function llmFeatureOf(type: string): string | undefined {
  const key = meteredLlmDefaultKeyOfType(type) ?? meteredLlmOptionKeyOfType(type)
  return key ? parseMeteredLlmId(key)?.feature : undefined
}

/**
 * node type → the charged figure `/v1/nodes` advertises for it on Nodaro Cloud, where there is one.
 * Priced as the hosted deployment prices (`hostedStatedPrices`): a metered LLM node at its
 * default model's estimate, whatever the edition or rollback switch of the process generating.
 */
function nodeCreditCosts(): ReadonlyMap<string, NodeCreditFigure> {
  const prices = hostedStatedPrices()
  return new Map(
    NODE_REGISTRY.flatMap((d) => {
      const row = STATIC_CREDIT_COSTS[d.type]
      const declared = d.creditCost ?? (typeof row === "number" ? row : undefined)
      if (declared === undefined) return []
      const charged = chargedDescriptor({ ...d, creditCost: declared }, prices)
      if (charged.creditCost === undefined) return []
      const llmFeature = llmFeatureOf(d.type)
      return [[d.type, { cost: charged.creditCost, estimate: charged.estimate === true, ...(llmFeature ? { llmFeature } : {}) }] as [string, NodeCreditFigure]]
    }),
  )
}

let costs: ReadonlyMap<string, NodeCreditFigure> | null = null

const LIVE_PRICE =
  "the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`)"

/**
 * Where an LLM call's price on ANY model is quoted: its metered price key
 * `<feature>:<model id>` (`llmPriceKey`, `@nodaro/shared/llm-models`), which
 * the model-cost lookup and MCP `list_models`' `priceIds` answer as an estimate.
 */
const llmLivePrice = (feature: string): string =>
  `a call on any model is quoted by \`GET /v1/credits/model-cost?model=${feature}:<model id>\` (MCP: \`list_models\` with \`priceIds: ["${feature}:<model id>"]\`)`

export function renderCreditCostLine(nodeType: string): string {
  const figure = (costs ??= nodeCreditCosts()).get(nodeType)
  if (figure === undefined) {
    // Input, parameter, trigger and layout nodes run no job at all; anything
    // else that lands here is priced by whatever registers it at runtime.
    return `**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise ${LIVE_PRICE}.`
  }
  if (figure.cost === UNPRICED_CREDIT_COST) {
    // A metered LLM node whose default model has no price yet: a run on it is refused, so no figure.
    return `**Credit cost:** unpriced on Nodaro Cloud — its default model has no price yet, so a run on it is refused (\`llm_model_unpriced\`); ${figure.llmFeature ? llmLivePrice(figure.llmFeature) : LIVE_PRICE}.`
  }
  if (figure.estimate) {
    // A metered LLM node: charged per token at its model's rate, so the figure is its default
    // model's typical call — an estimate, never a fixed price.
    return `**Credit cost:** \`≈${figure.cost}\` typical on Nodaro Cloud (an estimate on the default model: an LLM call is charged per token at its model's rate) — ${figure.llmFeature ? llmLivePrice(figure.llmFeature) : LIVE_PRICE}; \`GET /v1/nodes\` gives this node's figure live.`
  }
  return `**Credit cost:** \`${figure.cost}\` charged on Nodaro Cloud — ${LIVE_PRICE}; \`GET /v1/nodes\` gives this node's figure live.`
}
