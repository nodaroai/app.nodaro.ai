"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { MODEL_CREDIT_RANGES } from "./model-options"

export function ModelSelectOption({ value, label, desc }: { value: string; label: string; desc: string }) {
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
    >
      {label}
    </SelectItemWithMeta>
  )
}
