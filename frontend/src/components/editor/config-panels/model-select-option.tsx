"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { MODEL_CREDIT_RANGES } from "./model-options"

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
  const credits = useModelCredits(value)
  const range = MODEL_CREDIT_RANGES[value]

  let badge: string | undefined
  if (range) {
    badge = `${range.min}-${range.max} CR`
  } else if (credits > 0) {
    badge = `${credits} CR`
  }

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
