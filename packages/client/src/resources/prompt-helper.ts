import type { NodaroClient } from "../client.js"
import type {
  WizardQuestion,
  WizardSelection,
  RecommendedModel,
  WizardNodeContext,
} from "@nodaro/shared"

// Re-export the canonical wizard types (SSOT in @nodaro/shared).
export type { WizardQuestion, WizardOption, WizardSelection, RecommendedModel, WizardNodeContext } from "@nodaro/shared"

interface CommonInput {
  nodeType: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  llmModel?: string
  nodeContext?: WizardNodeContext
  userPreference?: string
  /** Associates this call with a workflow execution. Read server-side before Zod. */
  workflowId?: string
}

export interface AnalyzeInput extends CommonInput {
  /** The user's rough idea. Omit to build questions from scratch. */
  prompt?: string
}
export interface AnalyzeResult {
  jobId: string
  questions: WizardQuestion[]
}

export interface GenerateInput extends CommonInput {
  /** The chosen answers from analyze. */
  selections: WizardSelection[]
  /** The user's original rough idea, woven into the generated prompt. */
  originalPrompt?: string
}

export interface EnhanceInput extends CommonInput {
  /** The rough idea to improve one-shot. Omit to build from scratch. */
  prompt?: string
}

export interface PromptResult {
  jobId: string
  prompt: string
  recommendedModel?: RecommendedModel
}

/**
 * AI Prompt Wizard — help write/improve prompts for generation nodes.
 *
 * - `analyze` -> guided questions, `generate` -> prompt from selections (the
 *   2-step human flow), or `enhance` -> one-shot "improve this prompt".
 *
 * All three delegate to `POST /v1/prompt-helper/wizard`. Throws `NodaroError`
 * on 4xx/5xx (e.g. `validation_error`, `malformed_response`).
 */
export class PromptHelperResource {
  constructor(private client: NodaroClient) {}

  analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    return this.client.request("POST", "/v1/prompt-helper/wizard", { body: { action: "analyze", ...input } })
  }

  generate(input: GenerateInput): Promise<PromptResult> {
    return this.client.request("POST", "/v1/prompt-helper/wizard", { body: { action: "generate", ...input } })
  }

  enhance(input: EnhanceInput): Promise<PromptResult> {
    return this.client.request("POST", "/v1/prompt-helper/wizard", { body: { action: "enhance", ...input } })
  }
}
