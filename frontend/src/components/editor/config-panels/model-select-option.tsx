"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useLocalizeModelDescription } from "@/lib/i18n/labels"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { formatCreditBadge, formatPerSecondCreditBadge } from "./model-options"

export function ModelSelectOption({
  value,
  label,
  desc,
  tooltip,
  perSecond,
  creditId,
}: {
  value: string
  label: string
  desc: string
  /** The credit identifier to price this row by, when it differs from the
   *  Select `value`. Rows whose value is not itself a model id (a Choose Best
   *  strategy id, priced by its creditCostKey — tiered by judge model) pass it
   *  here; model rows leave it unset and are priced by `value`. */
  creditId?: string
  /** When set, overrides the hover-tooltip content on the right side of the
   *  dropdown row. The inline description below the label still renders
   *  unchanged — caller uses this to surface model-specific capabilities
   *  (durations / resolutions / ratios) without forcing the user to re-read
   *  the same marketing copy in two places. */
  tooltip?: string
  /** Opt-in: this provider bills per second (per-second lip-sync). Show a
   *  "~N CR/s" rate (from the `:15s` bucket ÷15) instead of the bare ceiling,
   *  which would otherwise read as an alarming flat price. */
  perSecond?: boolean
}) {
  // Both hooks run unconditionally (Rules of Hooks). When not per-second the
  // second call resolves the same id as the first (cached, no extra fetch).
  const localizeDesc = useLocalizeModelDescription()
  const priceId = creditId ?? value
  const baseCredits = useModelCredits(priceId)
  const perSecondCredits = useModelCredits(perSecond ? `${priceId}:15s` : priceId)
  const badge = perSecond
    ? formatPerSecondCreditBadge(perSecondCredits)
    : formatCreditBadge(priceId, baseCredits)

  return (
    <SelectItemWithMeta
      value={value}
      badge={badge}
      description={localizeDesc(desc)}
      tooltip={tooltip ? localizeDesc(tooltip) : tooltip}
    >
      {label}
    </SelectItemWithMeta>
  )
}
