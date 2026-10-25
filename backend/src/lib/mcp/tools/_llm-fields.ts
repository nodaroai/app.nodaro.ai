/**
 * The LLM knobs every MCP tool backed by an LLM route should expose, written
 * down once.
 *
 * Every one of these routes accepts `llmModel` / `reasoningEffort` / the
 * advanced trio, but each MCP tool re-declares its own subset by hand — which
 * is how `image_to_text` ended up with no model selector at all (MCP callers
 * were silently pinned to the feature default, with no way to reach a stronger
 * vision model or the direct lane) while three near-identical copies of the
 * advanced fields lived in `prompt-helper.ts`.
 *
 * Spread `llmMcpFields(<feature>)` into a tool's `inputSchema` and map the args
 * with `llmPayloadFields(args)`. Adding a knob to the routes now means editing
 * one place instead of hunting every tool that should have carried it.
 *
 * PRICING: an LLM call is charged per token at the model's rate on the lane
 * that serves it (metered pricing) — never a tier price, so the copy names no
 * rung. `llmMcpFields` adds the feature's typical figure on its default model
 * (`estimateHint`), derived at registration.
 */
import { z } from "zod"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS, PICKABLE_LLM_MODELS, getLlmModel } from "@nodaro/shared/llm-models"
import { estimateHint, llmFeatureDefaultModel, type MeteredLlmFeature } from "./_credit-hint.js"

/** MCP-facing schema fragment. Snake_case for the advanced trio matches the
 *  surrounding MCP convention; `llmModel` keeps its existing camelCase spelling
 *  because renaming it would break callers already passing it. */
export const LLM_MCP_FIELDS = {
  // Accepts every registered id (a caller naming a retired model keeps working,
  // as the routes do) but ADVERTISES only the pickable ones: the `enum` meta
  // replaces the list in the published JSON schema and the generated docs.
  llmModel: z
    .enum(LLM_MODEL_IDS as [string, ...string[]])
    .meta({ enum: PICKABLE_LLM_MODELS.map((m) => m.id) })
    .optional()
    .describe("LLM model id. Defaults to this feature's configured model."),
  reasoning_effort: z
    .enum(LLM_REASONING_EFFORTS)
    .optional()
    .describe(
      "Reasoning effort (model-dependent). A higher effort usually spends more output tokens, and the call is charged per token. On a Claude model any effort runs on Anthropic's own API, charged at that lane's rate (docs/pricing/llm-models.md).",
    ),
  advanced_mode: z
    .boolean()
    .optional()
    .describe(
      "Gemini and Claude models. Runs on the provider's own API so temperature, max tokens and the full reasoning range apply, charged per token at that lane's rate (docs/pricing/llm-models.md); any other model returns 400 advanced_mode_unsupported. On a Claude model any reasoning_effort already runs this way.",
    ),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("Sampling temperature. Only honoured when advanced_mode is true."),
  max_tokens: z
    .number()
    .int()
    .min(1)
    .max(32768)
    .optional()
    .describe("Output token cap. Only honoured when advanced_mode is true."),
}

/**
 * {@link LLM_MCP_FIELDS} for a tool fronting a metered LLM `feature`: its
 * `llmModel` names the feature's default model and what a typical call on it
 * is charged (`≈N`, an estimate — the call is charged per token).
 */
export function llmMcpFields(feature: MeteredLlmFeature): typeof LLM_MCP_FIELDS {
  const defaultModel = llmFeatureDefaultModel(feature)
  const name = getLlmModel(defaultModel)?.displayName ?? defaultModel
  return {
    ...LLM_MCP_FIELDS,
    llmModel: LLM_MCP_FIELDS.llmModel.describe(
      `LLM model id. Defaults to ${name} (\`${defaultModel}\`). Charged per token at the model's rate: ${estimateHint(feature, defaultModel)} (every model: docs/pricing/llm-models.md).`,
    ),
  }
}

export { llmPayloadFields, type LlmMcpArgs } from "./_llm-payload.js"
