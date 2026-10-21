/**
 * How the server prices LLM calls this session, as its price answers last said:
 * per model (`metered` — a metered price key answered as an estimate, or refused
 * as a model with no rate) or at the tier rows (`tier` — the tier-pricing
 * rollback, which answers a metered price key `missing`). `unknown` until an
 * answer has said either; a surface then shows wording true in both modes.
 *
 * The LATEST answer wins, so a rollback (or its end) mid-session is followed by
 * the next answer that asks for a metered key. It is a store, not a read of the
 * remembered estimates: copy that differs between the two modes (the effort
 * labels) re-renders the moment an answer changes it.
 */
import { useSyncExternalStore } from "react"
import { LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS } from "@nodaro/shared/llm-models"
import { isTierBilledLlmFeature } from "@nodaro/render-rules"

export type LlmPricingMode = "unknown" | "metered" | "tier"

let mode: LlmPricingMode = "unknown"
const listeners = new Set<() => void>()

function setMode(next: LlmPricingMode): void {
  if (next === mode) return
  mode = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The pricing mode the last answer showed, outside React. */
export function llmPricingMode(): LlmPricingMode {
  return mode
}

/** Is the server pricing LLM calls per model, as far as its answers have said? */
export function meteredPricingSeen(): boolean {
  return mode === "metered"
}

/** The pricing mode, re-rendering the caller when an answer changes it. */
export function useLlmPricingMode(): LlmPricingMode {
  return useSyncExternalStore(subscribe, llmPricingMode, () => "unknown")
}

const MODEL_IDS: ReadonlySet<string> = new Set(LLM_MODEL_IDS)
const DIRECT_SUFFIX = ":direct"

/**
 * The features whose price key the server meters (its `METERED_LLM_FEATURES`
 * reading of the shared registry): every LLM feature but the tier-billed ones
 * (`isTierBilledLlmFeature`) and the bare judge id, plus Choose Best's judge
 * under its node's own feature. Longest first, as the server matches them. A
 * feature left out here only means its answer says nothing about the mode —
 * never that it says "tier".
 */
const METERED_FEATURES_LONGEST_FIRST: readonly string[] = [
  ...Object.keys(LLM_FEATURE_DEFAULTS).filter((f) => f !== "pick-best-llm" && !isTierBilledLlmFeature(f)),
  "reduce:pick-best-llm",
].sort((a, b) => b.length - a.length)

/**
 * Is `id` a metered LLM price key (`llmPriceKey`: `<feature>:<model>[:direct]`)
 * — a feature the server meters, then a registry model id — exactly the ids
 * the server answers as estimates while it prices per model? A tier id
 * (`llm-chat:premium`), an unknown feature, and any other composite
 * (`gpt-image:high`) is not.
 */
export function isMeteredLlmPriceKey(id: string): boolean {
  const feature = METERED_FEATURES_LONGEST_FIRST.find((f) => id.startsWith(`${f}:`))
  if (!feature) return false
  const rest = id.slice(feature.length + 1)
  return MODEL_IDS.has(rest) || (rest.endsWith(DIRECT_SUFFIX) && MODEL_IDS.has(rest.slice(0, -DIRECT_SUFFIX.length)))
}

/**
 * Learn the mode from a price answer: any estimate, or any metered key refused
 * for having no rate, means per-model pricing; otherwise a metered key answered
 * `missing` means the tier rollback. An answer that says neither leaves it.
 */
export function notePricingAnswer(answer: {
  readonly estimates?: readonly string[]
  readonly refused?: readonly string[]
  readonly missing?: readonly string[]
}): void {
  if ((answer.estimates?.length ?? 0) > 0 || (answer.refused?.length ?? 0) > 0) setMode("metered")
  else if (answer.missing?.some(isMeteredLlmPriceKey)) setMode("tier")
}

/** Tests only: back to the state before any answer. */
export function forgetLlmPricingMode(): void {
  setMode("unknown")
}
