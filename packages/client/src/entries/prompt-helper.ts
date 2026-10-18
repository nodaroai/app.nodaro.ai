/**
 * `@nodaro/sdk/prompt-helper` — the `prompt-helper` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type { WizardQuestion, WizardOption, WizardSelection, RecommendedModel, WizardNodeContext } from "@nodaro/prompts/doctrine"

export { PromptHelperResource } from "../resources/prompt-helper.js"

export type {
  AnalyzeInput,
  AnalyzeResult,
  GenerateInput,
  EnhanceInput,
  PromptResult,
} from "../resources/prompt-helper.js"
