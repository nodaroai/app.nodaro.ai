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
 * Spread `LLM_MCP_FIELDS` into a tool's `inputSchema` and map the args with
 * `llmPayloadFields(args)`. Adding a knob to the routes now means editing one
 * place instead of hunting every tool that should have carried it.
 */
import { z } from "zod"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS } from "@nodaro/shared"

/** MCP-facing schema fragment. Snake_case for the advanced trio matches the
 *  surrounding MCP convention; `llmModel` keeps its existing camelCase spelling
 *  because renaming it would break callers already passing it. */
export const LLM_MCP_FIELDS = {
  llmModel: z
    .enum(LLM_MODEL_IDS as [string, ...string[]])
    .optional()
    .describe("LLM model id. Defaults to this feature's configured model."),
  reasoning_effort: z
    .enum(LLM_REASONING_EFFORTS)
    .optional()
    .describe("Reasoning effort (model-dependent; xhigh/max bill one tier up; on a Claude model any effort runs on Anthropic's own API and bills one rung up as well)."),
  advanced_mode: z
    .boolean()
    .optional()
    .describe(
      "Gemini and Claude models. Runs on the provider's own API so temperature, max tokens and the full reasoning range apply. Bills one credit rung up (a premium model moves to premium-direct); any other model returns 400 advanced_mode_unsupported. On a Claude model any reasoning_effort already runs this way.",
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

/** Args as MCP delivers them — a structural mirror of `LLM_MCP_FIELDS` so a
 *  tool can accept a wider args object and still pass it here. */
export interface LlmMcpArgs {
  llmModel?: string
  reasoning_effort?: string
  advanced_mode?: boolean
  temperature?: number
  max_tokens?: number
}

/**
 * Snake_case MCP args → the camelCase body the routes parse.
 *
 * Absent keys are OMITTED rather than sent as `undefined`: these payloads are
 * JSON-serialised on the way to the route, and an explicit `advancedMode: null`
 * reads differently from a field that was never sent.
 */
export function llmPayloadFields(args: LlmMcpArgs): Record<string, unknown> {
  return {
    ...(args.llmModel ? { llmModel: args.llmModel } : {}),
    ...(args.reasoning_effort ? { reasoningEffort: args.reasoning_effort } : {}),
    ...(args.advanced_mode ? { advancedMode: true } : {}),
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    ...(args.max_tokens !== undefined ? { maxTokens: args.max_tokens } : {}),
  }
}
