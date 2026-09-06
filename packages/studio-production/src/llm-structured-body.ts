/**
 * The body of `POST /v1/llm/structured`, as this package needs to build it.
 *
 * Structurally identical to the SDK's `LlmStructuredInput` — deliberately a
 * COPY rather than an import, because the SDK consumes this package. A type
 * test in `packages/client` pins the two together, so a field added to the
 * wire lands here or the build fails.
 */
export interface LlmStructuredBody {
  /** The system prompt (≤ 100,000 chars). */
  system: string
  /** The user turn (1–100,000 chars). */
  input: string
  /** A JSON Schema OBJECT (`type: "object"`, ≤ 64 KB, ≤ 20 levels) in the
   *  keyword subset the server converts. */
  jsonSchema: Record<string, unknown>
  /** Names the forced-output tool the provider sees (≤ 64 chars). */
  schemaName?: string
  llmModel?: string
  reasoningEffort?: string
  /** Invalid answers fed back with their error before the call fails (0–3, default 2). */
  maxRetries?: number
  /** The calling app's slug — attribution only; `jobs.list({ origin })` finds the rows. */
  origin?: string
  advancedMode?: boolean
  temperature?: number
  maxTokens?: number
}
