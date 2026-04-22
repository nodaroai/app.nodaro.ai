"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  FRAMINGS,
  FRAMING_CATEGORY_ORDER,
  FRAMING_CATEGORY_LABELS,
  type Framing,
  type FramingCategory,
} from "@nodaro-shared/framing"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { FramingPreview } from "./framing-preview"

interface FramingPickerProps {
  readonly value: string
  readonly onValueChange: (framingId: string) => void
  readonly className?: string
}

export const FramingPicker = memo(function FramingPicker({
  value,
  onValueChange,
  className,
}: FramingPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<FramingCategory, Framing[]>()
    for (const framing of FRAMINGS) {
      if (q && !framing.label.toLowerCase().includes(q) && !framing.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(framing.category) ?? []
      list.push(framing)
      byCategory.set(framing.category, list)
    }
    return FRAMING_CATEGORY_ORDER
      .map((cat) => ({ category: cat, framings: byCategory.get(cat) ?? [] }))
      .filter((section) => section.framings.length > 0)
  }, [query])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search framings"
          placeholder="Search framings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {grouped.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No framings match "{query}"
        </div>
      )}

      {grouped.map(({ category, framings }) => (
        <div key={category} className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
            {FRAMING_CATEGORY_LABELS[category]}
          </div>
          <div role="radiogroup" aria-label={FRAMING_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
            {framings.map((framing) => {
              const selected = framing.id === value
              return (
                <button
                  key={framing.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={framing.description}
                  onClick={() => onValueChange(framing.id)}
                  className={cn(
                    "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                    selected
                      ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                      : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                  )}
                >
                  <FramingPreview framingId={framing.id} className="w-full aspect-square" />
                  <span
                    className={cn(
                      "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center truncate",
                      selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                    )}
                  >
                    {framing.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
})
