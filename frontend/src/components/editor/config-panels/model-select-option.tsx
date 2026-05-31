"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { formatCreditBadge } from "./model-options"

export function ModelSelectOption({
  value,
  label,
  desc,
  tooltip,
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
}) {
  const badge = formatCreditBadge(value, useModelCredits(value))

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
