/**
 * A render run button's price, after its label (Render final, Update preview — on the render
 * node's bar, the review's buttons and banners, the Clip Pack's footer, an app's review): one
 * reading, so every surface marks the same figure the same way.
 */
import { hasCredits } from "@/lib/edition"
import { creditUnits } from "@/lib/credit-units"
import type { MessageKey } from "@/lib/i18n"
import { ugcPriceNoteKey, type UgcPriceState } from "@/components/editor/workflow-editor/ugc-run-estimate"
import type { RunUnpriced } from "@/components/editor/workflow-editor/run-unpriced"

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

/**
 * " · {credits}" on a credit edition with a price to show — `≈` before an estimate, the one
 * convention of every run price (Execute, Run from here, Run up to here): a UGC part's figure
 * not the server's checked one (`unchecked`: still checking, could not be checked, an older
 * answer, a saved script's length unread — the reason on the button's title, `runPriceTitle`),
 * or an approximate figure (`approx`: a metered LLM call's estimate, the Clip Pack's footer).
 * A run holding a node the server refuses to price (`unpriced`, `llm_model_unpriced`) quotes no
 * figure — the one it has leaves that node out — but says it is not priced yet, the server's
 * sentence on the title.
 */
export function runPriceSuffix(
  t: Translate,
  credits: number,
  unchecked?: UgcPriceState,
  opts: { readonly approx?: boolean; readonly unpriced?: RunUnpriced } = {},
): string {
  if (!hasCredits()) return ""
  if (opts.unpriced) return ` · ${t("renderFinal.priceNotPricedYet")}`
  if (credits <= 0) return ""
  return ` · ${unchecked || opts.approx ? "≈" : ""}${creditUnits(credits)}`
}

/** Why a run button's price is marked (an estimate, or not priced yet), for its title; undefined when it is not. */
export function runPriceTitle(t: Translate, unchecked?: UgcPriceState, unpriced?: RunUnpriced): string | undefined {
  if (unpriced && hasCredits()) return unpriced.message
  return unchecked ? t(ugcPriceNoteKey(unchecked)) : undefined
}
