"use client"

import { SelectItemWithMeta } from "@/components/ui/select"
import { useModelCredits } from "@/hooks/use-model-credits"

export function ModelSelectOption({ value, label, desc }: { value: string; label: string; desc: string }) {
  const credits = useModelCredits(value)
  return (
    <SelectItemWithMeta
      value={value}
      badge={credits > 0 ? `${credits} CR` : undefined}
      description={desc}
    >
      {label}
    </SelectItemWithMeta>
  )
}
