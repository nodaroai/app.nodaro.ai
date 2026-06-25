"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { formatCreditBadge, formatPerSecondCreditBadge } from "./model-options"

export function ModelSelectOption({
  value,
  label,
  desc,
  tooltip,
  perSecond,
}: {
  value: string
  label: string
  desc: string
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
  const baseCredits = useModelCredits(value)
  const perSecondCredits = useModelCredits(perSecond ? `${value}:15s` : value)
  const badge = perSecond
    ? formatPerSecondCreditBadge(perSecondCredits)
    : formatCreditBadge(value, baseCredits)

  return (
    <SelectItemWithMeta
      value={value}
      badge={badge}
      description={desc}
      tooltip={tooltip}
    >
      {label}
    </SelectItemWithMeta>
  )
}
