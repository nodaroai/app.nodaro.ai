"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { COMPOSITION_EFFECTS } from "@nodaro-shared/composition-effects"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface CompositionEffectsPickerProps {
  readonly value: string
  readonly onValueChange: (id: string) => void
  readonly className?: string
}

export const CompositionEffectsPicker = memo(function CompositionEffectsPicker({
  value,
  onValueChange,
  className,
}: CompositionEffectsPickerProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMPOSITION_EFFECTS
    return COMPOSITION_EFFECTS.filter(
      (e) => e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search composition effect"
          placeholder="Search composition trick"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No composition effect matches &quot;{query}&quot;
        </div>
      )}

      <div role="radiogroup" aria-label="Composition Effect" className="grid grid-cols-2 gap-1.5">
        {filtered.map((entry) => {
          const selected = entry.id === value
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={entry.description}
              onClick={() => onValueChange(entry.id)}
              className={cn(
                "group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <span
                className={cn(
                  "text-[11.5px] font-semibold leading-tight truncate w-full",
                  selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              >
                {entry.label}
              </span>
              <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2">
                {entry.description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
