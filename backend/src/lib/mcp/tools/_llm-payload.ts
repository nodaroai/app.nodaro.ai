/**
 * The LLM knobs' MCP args → route body mapping (`llmPayloadFields`), apart
 * from their schema (`./_llm-fields.ts`). A LEAF: the schema's descriptions
 * carry a price (`_credit-hint.ts` → the billing modules), and a billing
 * module that only maps args (`ee/lib/ugc-quote.ts`) imports this instead, so
 * the two never import each other in a loop. `./_llm-fields.ts` re-exports it.
 */
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
