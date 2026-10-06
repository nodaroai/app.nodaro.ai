import { buildLlmCreditIdentifier, getLlmModel, LLM_FEATURE_DEFAULTS, MODEL_CATALOG } from "@nodaro/shared"
import { speechUnitRowServed } from "../../lib/speech-credits.js"

/** Catalog identifiers are not always billing identifiers (notably text models). */
export function deploymentPriceDefinitions(modelId: string) {
  if (getLlmModel(modelId)) {
    return { baseIdentifier: buildLlmCreditIdentifier("llm-chat", modelId), basis: "llm-chat-default-settings" as const,
      variants: Object.keys(LLM_FEATURE_DEFAULTS).map(operation => ({
        identifier: buildLlmCreditIdentifier(operation, modelId), operation, note: "Default reasoning and standard mode",
      })) }
  }
  return { baseIdentifier: modelId, basis: "base-tariff" as const,
    // A speech unit row is a rate the server charges only while length pricing is on; off, it is not listed (it would price as price_not_configured).
    variants: (MODEL_CATALOG[modelId]?.pricing ?? []).filter(({ identifier }) => speechUnitRowServed(identifier)).map(({ identifier, note }) => ({ identifier, ...(note ? { note } : {}) })) }
}

/** Resolve once per billing identifier; all values include runtime price overrides. */
export async function resolveDeploymentPrices(ids: readonly string[], price: (id: string) => Promise<number>) {
  const definitions = new Map(ids.map(id => [id, deploymentPriceDefinitions(id)]))
  const identifiers = [...new Set([...definitions.values()].flatMap(d => [d.baseIdentifier, ...d.variants.map(v => v.identifier)]))]
  const results = await Promise.allSettled(identifiers.map(price))
  return { definitions, identifiers, prices: new Map(identifiers.map((id, index) => [id, results[index]!])) }
}
