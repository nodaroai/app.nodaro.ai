"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useLocalizeModelDescription } from "@/lib/i18n/labels"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useModelCreditRange } from "@/hooks/use-model-credit-range"
import { formatCreditBadge, formatPerSecondCreditBadge } from "./model-options"

export function ModelSelectOption({
  value,
  label,
  desc,
  tooltip,
  perSecond,
  perSecondCreditId,
  creditId,
  badge: badgeOverride,
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
  /** Opt-in: this provider bills per second, its 15-second price at
   *  `<id>:15s` (Video Depth). Shorthand for `perSecondCreditId={`${id}:15s`}`. */
  perSecond?: boolean
  /** Opt-in: this provider bills per second of its audio (lip-sync). The id
   *  whose price is a 15-second run — a bucketed model's `:15s` row, a
   *  per-second-rate model's 15-second quote (`lipSyncFifteenSecondCreditId`).
   *  Shows a "≈N CR/s" rate (÷15) instead of the bare ceiling, which would
   *  otherwise read as an alarming flat price. */
  perSecondCreditId?: string
  /** A badge the caller priced itself, shown instead of this row's own price
   *  (a Choose Best judge's metered estimate, `≈N CR`). Unset: priced as above. */
  badge?: string
}) {
  // A per-second row is priced by its 15-second id alone: a per-second-rate
  // model has no row of its own id to look up.
  const localizeDesc = useLocalizeModelDescription()
  const priceId = creditId ?? value
  const fifteenSecondId = perSecondCreditId ?? (perSecond ? `${priceId}:15s` : undefined)
  const credits = useModelCredits(fifteenSecondId ?? priceId)
  const range = useModelCreditRange(priceId)
  const badge = badgeOverride ?? (fifteenSecondId !== undefined
    ? formatPerSecondCreditBadge(credits)
    : formatCreditBadge(priceId, credits, range))

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
