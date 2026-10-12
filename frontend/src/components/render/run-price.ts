/**
 * A render run button's price, after its label (Render final, Update preview — on the render
 * node's bar, the review's buttons and banners, the Clip Pack's footer, an app's review): one
 * reading, so every surface marks the same figure the same way.
 */
import { hasCredits } from "@/lib/edition"
import { creditUnits } from "@/lib/credit-units"
import type { MessageKey } from "@/lib/i18n"
import { ugcPriceNoteKey, type UgcPriceState } from "@/components/editor/workflow-editor/ugc-run-estimate"

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

/**
 * " · {credits}" on a credit edition with a price to show — marked as an estimate while a UGC
 * part's figure is not the server's checked one (`unchecked`: still checking, could not be
 * checked, an older answer, a saved script's length unread), the reason on the button's title
 * (`runPriceTitle`). `approx` quotes it as approximate (≈), as the Clip Pack's footer does.
 */
export function runPriceSuffix(t: Translate, credits: number, unchecked?: UgcPriceState, opts: { readonly approx?: boolean } = {}): string {
  if (!hasCredits() || credits <= 0) return ""
  const n = `${opts.approx ? "≈" : ""}${creditUnits(credits)}`
  return ` · ${unchecked ? t("renderFinal.priceEstimate", { n }) : n}`
}

/** Why a run button's price is marked as an estimate, for its title; undefined when it is not. */
export function runPriceTitle(t: Translate, unchecked?: UgcPriceState): string | undefined {
  return unchecked ? t(ugcPriceNoteKey(unchecked)) : undefined
}
