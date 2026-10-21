// @registry-enumerates prices the credit ids a model is billed under (its operations' ids) through the price lookups — credit ids, not node types, so not a @registry-lookup
import { buildLlmCreditIdentifier, getLlmModel, llmPriceKey, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { isTierBilledLlmFeature } from "@nodaro/render-rules"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { speechUnitRowServed } from "../../lib/speech-credits.js"
import { llmMeteredPricing } from "../../lib/config.js"
import { PriceNotConfiguredError, getChargedPriceTable, meteredLlmPriceKey, meteredLlmQuote } from "./credits.js"

/**
 * LLM steps that are never billed as calls of their own: `translate` runs
 * inside a media node's fixed price (the image-to-image prompt translation),
 * so it is listed at its tier id as before, never per model.
 */
const EMBEDDED_LLM_FEATURES: ReadonlySet<string> = new Set(["translate"])

/**
 * Does a call of `operation` bill per model while metered pricing is on? Not
 * for the features still billed at their tier row (`TIER_BILLED_LLM_FEATURES`,
 * `@nodaro/render-rules` — Workflow Copilot's own ceilings, Content Recipe /
 * Ideas until their plugin meters) nor for an embedded step.
 */
const billsPerModel = (operation: string): boolean => !isTierBilledLlmFeature(operation) && !EMBEDDED_LLM_FEATURES.has(operation)

/** The feature a catalog operation bills under: Choose Best's judge bills as `reduce:pick-best-llm`. */
const billedFeatureOf = (operation: string): string => (operation === "pick-best-llm" ? "reduce:pick-best-llm" : operation)

/**
 * The id an LLM operation on `modelId` is priced at: its metered price key
 * (`llmPriceKey`, quoted at the model's typical-usage estimate) while metered
 * pricing is on, else today's tier id. The rollback lists the tier ids exactly
 * as before.
 */
function llmOperationIdentifier(operation: string, modelId: string, metered: boolean): string {
  return metered && billsPerModel(operation)
    ? llmPriceKey(billedFeatureOf(operation), modelId)
    : buildLlmCreditIdentifier(operation, modelId)
}

/** Catalog identifiers are not always billing identifiers (notably text models). */
export function deploymentPriceDefinitions(modelId: string) {
  if (getLlmModel(modelId)) {
    const metered = llmMeteredPricing()
    return { baseIdentifier: llmOperationIdentifier("llm-chat", modelId, metered), basis: "llm-chat-default-settings" as const,
      // A metered key has no pricing row of its own: its switches (enabled, tier restriction) are its
      // feature's bare row, the one the metered reservation checks (`pricingWithOverride`). Its price is
      // an ESTIMATE (the typical call; charged its actual usage): `estimate` marks it, absent under the rollback.
      ...(metered ? { rowIdentifier: "llm-chat", estimate: true as const } : {}),
      variants: Object.keys(LLM_FEATURE_DEFAULTS).map(operation => ({
        identifier: llmOperationIdentifier(operation, modelId, metered), operation, note: "Default reasoning and standard mode",
        ...(metered && billsPerModel(operation) ? { estimate: true as const } : {}),
      })) }
  }
  return { baseIdentifier: modelId, basis: "base-tariff" as const,
    // A speech unit row is a rate the server charges only while length pricing is on; off, it is not listed (it would price as price_not_configured).
    variants: (MODEL_CATALOG[modelId]?.pricing ?? []).filter(({ identifier }) => speechUnitRowServed(identifier)).map(({ identifier, note }) => ({ identifier, ...(note ? { note } : {}) })) }
}

/**
 * Resolve once per billing identifier; all values include runtime price
 * overrides. A metered LLM price key is quoted at its estimate from the
 * charged price table (`meteredLlmQuote`) — `price` (a single-row lookup)
 * prices it nowhere — and a model with no rate on its lane is
 * `PriceNotConfiguredError`, listed as missing, never 0.
 */
export async function resolveDeploymentPrices(ids: readonly string[], price: (id: string) => Promise<number>) {
  const definitions = new Map(ids.map(id => [id, deploymentPriceDefinitions(id)]))
  const identifiers = [...new Set([...definitions.values()].flatMap(d => [d.baseIdentifier, ...d.variants.map(v => v.identifier)]))]
  let table: ReturnType<typeof getChargedPriceTable> | undefined
  const priceOf = async (id: string): Promise<number> => {
    if (!meteredLlmPriceKey(id)) return price(id)
    const quote = meteredLlmQuote(await (table ??= getChargedPriceTable()), id)
    if (quote?.kind !== "estimate") throw new PriceNotConfiguredError(id)
    return quote.credits
  }
  const results = await Promise.allSettled(identifiers.map(priceOf))
  // The `model_pricing` rows a caller reads a model's switches and metadata from: the priced ids, and
  // a metered model's feature row (`rowIdentifier`).
  const rowIdentifiers = [...new Set([...identifiers, ...[...definitions.values()].flatMap((d) => ("rowIdentifier" in d && d.rowIdentifier ? [d.rowIdentifier] : []))])]
  return { definitions, identifiers, rowIdentifiers, prices: new Map(identifiers.map((id, index) => [id, results[index]!])) }
}
