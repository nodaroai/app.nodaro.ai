/**
 * Prompt pre/post text ("affixes") — the PUBLIC node-data contract.
 *
 * Every AI prompt node may carry two optional strings that are wrapped around
 * its run-time prompt: `promptPrefix` goes before, `promptSuffix` after. Both
 * support `{Node Label}` references and plain-text snippets exactly like the
 * main prompt. They are settings (edited in the node's config panel, captured
 * by presets, settable through workflow JSON / `inputOverrides`), never shown
 * on the node face or to published-app end users.
 *
 * Only the KEYS + TYPE live here (what the SDK/API contract needs). The wrap
 * behaviour (`applyPromptAffixes`) lives in `@nodaro/prompts` next to
 * `resolvePrompt` — see the spec's IP-placement note.
 */
export const PROMPT_PREFIX_KEY = "promptPrefix" as const
export const PROMPT_SUFFIX_KEY = "promptSuffix" as const

export interface PromptAffixFields {
  /** Text placed BEFORE the node's prompt at run time. Supports {Node Label} refs. */
  readonly promptPrefix?: string
  /** Text placed AFTER the node's prompt at run time. Supports {Node Label} refs. */
  readonly promptSuffix?: string
}

/** The affix pair read off node data (blank / non-string values are omitted). */
export interface PromptAffixes {
  readonly prefix?: string
  readonly suffix?: string
}

function nonBlank(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined
}

/** Read `{ prefix, suffix }` off a node's `data`. Never throws; unknown shapes → `{}`. */
export function readPromptAffixes(data: Record<string, unknown>): PromptAffixes {
  const prefix = nonBlank(data[PROMPT_PREFIX_KEY])
  const suffix = nonBlank(data[PROMPT_SUFFIX_KEY])
  return {
    ...(prefix !== undefined ? { prefix } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
  }
}
