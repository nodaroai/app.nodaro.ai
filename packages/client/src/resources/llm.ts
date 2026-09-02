import type { NodaroClient } from "../client.js"

/**
 * Structured LLM output — `POST /v1/llm/structured` and its asynchronous
 * twin. The platform supplies the model lane, forced JSON-Schema output with
 * validation and error-fed retries, the job row and the credit lifecycle; the
 * caller supplies its own system prompt and schema (an app-owned vocabulary
 * the platform cannot know — Nodaro Studio's production plan is the first).
 */
export interface LlmStructuredInput {
  /** The system prompt (≤ 100,000 chars). */
  system: string
  /** The user turn (1–100,000 chars). */
  input: string
  /** A JSON Schema OBJECT (`type: "object"`, ≤ 64 KB, ≤ 20 levels) in the
   *  keyword subset the server converts — see the API guide. */
  jsonSchema: Record<string, unknown>
  /** Names the forced-output tool the provider sees (≤ 64 chars). */
  schemaName?: string
  llmModel?: string
  reasoningEffort?: string
  /** Invalid answers fed back with their error before the call fails (0–3, default 2). */
  maxRetries?: number
  /** Your app's slug — attribution only; `jobs.list({ origin })` finds the rows. */
  origin?: string
  advancedMode?: boolean
  temperature?: number
  maxTokens?: number
}

export interface LlmStructuredResult<T = unknown> {
  jobId: string
  output: T
  usage: { inputTokens: number; outputTokens: number }
}

export interface LlmStructuredJobInput extends LlmStructuredInput {
  /** Display label stored on the job (≤ 120 chars) — a run list's row title. */
  label?: string
  /** Draft FROM this video: the platform analyzes it first (`POST
   *  /v1/video-analysis`, a separate job you own) and appends the analysis
   *  to `input` before the LLM call. */
  videoUrl?: string
  /** Analysis options, handed to the analysis route unchanged (its tiers). */
  videoAnalysis?: { llmModel?: string; selectionMode?: "choose" | "combine" }
}

/** `output_data` of an `llm-structured` job as it progresses: `stage` while
 *  running (`analyzing` only for movie runs), then the result. */
export interface LlmStructuredJobOutput<T = unknown> {
  stage?: "analyzing" | "drafting"
  output?: T
  inputTokens?: number
  outputTokens?: number
  analysisJobId?: string
  analysisCredits?: number
}

export class LlmResource {
  constructor(private client: NodaroClient) {}

  /**
   * Synchronous forced-schema completion (`POST /v1/llm/structured`). A call
   * can run several minutes — longer than the client's default 60 s
   * `timeoutMs`; construct the client with a larger `timeoutMs` for this
   * call, or use {@link LlmResource.structuredJob}.
   */
  structured<T = unknown>(input: LlmStructuredInput): Promise<LlmStructuredResult<T>> {
    return this.client.request<LlmStructuredResult<T>>("POST", "/v1/llm/structured", { body: input })
  }

  /**
   * The same call as a job (`POST /v1/llm/structured/jobs`): answers `{ jobId }`
   * at once. Poll `jobs.getStatus(jobId)` — `output_data` is an
   * {@link LlmStructuredJobOutput}; `error_message` says why a run failed.
   * `jobs.list({ type: "llm-structured", origin })` finds every run later.
   * Throws `NotFoundError` on a platform that predates the route.
   */
  structuredJob(input: LlmStructuredJobInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/llm/structured/jobs", { body: input })
  }
}
