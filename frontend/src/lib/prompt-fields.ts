/**
 * Prompt-field registry — RE-EXPORT. The data + helpers live in
 * `@nodaro/prompts` (`node-prompt-fields.ts`) so the backend, the `/v1/nodes`
 * registry, the totality tests and the docs tooling read the SAME list the
 * editor does. Keep importing from `@/lib/prompt-fields` in frontend code; this
 * module exists so the 12 existing call sites and `prompt-fields.test.ts` are
 * untouched. Pure re-export — no React/lucide imports (app-runtime-bundle safe).
 */
export {
  NODE_PROMPT_FIELDS,
  getPromptFields,
  nodeHasPromptField,
  getSnippetMedia,
  nodeHasInlinePrompt,
  nodeSupportsPromptAffixes,
  PROMPT_AFFIX_NODE_TYPES,
  PROMPT_AFFIX_CORE_FIELD_OVERRIDES,
  promptAffixCoreField,
  promptFieldCarriesAffixes,
} from "@nodaro/prompts"
export type { PromptFieldSpec, PromptIconKind } from "@nodaro/prompts"
